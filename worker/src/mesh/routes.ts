// Mesh relay HTTP entry: the one place a request can reach MeshRelayRoom.
//
// WHY A FEATURE FLAG: this Worker deploys automatically from master. The relay must not go live by
// accident, so with MESH_RELAY_ENABLED anything other than the exact string "1" every relay path is
// answered by the ordinary router as an unknown path (404) and NO Durable Object is created or woken.
// wrangler.toml keeps it "0" in production; the test environment sets "1". A locked-down test relay
// goes online later, only after an independent review.
//
// WHY THIS RUNS BEFORE THE HONO ROUTER (same reason as the games rooms in index.ts): the CORS
// middleware would try to add headers to a WebSocket (101) response, which is immutable.
import type { Env } from "../types";
import { CLOSE_VERSION_REFUSED, MESH_MIN_PROTOCOL_VERSION, MESH_PROTOCOL_VERSION, ROOM_HEX, isHex } from "./protocol";

const PATH = /^\/mesh\/relay\/([^/]+)$/;

/** The relay's explicit mode (review finding 2). WHY explicit: before, an EMPTY allow-list meant "open to every
 *  room", so a typo or a dropped variable silently turned a locked-down test relay into a public one.
 *    "off"        nothing is reachable.
 *    "allowlist"  only rooms named in MESH_ALLOWED_ROOMS; empty or missing list = NO room (fails closed).
 *    "open"       the public relay. NOT IMPLEMENTED: it needs a global set/byte ceiling and a Worker-side proof of
 *                 key before an object is created (see the review's "Before the public"). It is refused here, so it
 *                 cannot be switched on by accident; it behaves exactly like "off".
 *    "test-open"  any well-formed room, no limiter required. Set ONLY in [env.test] (a test pins that production
 *                 config never contains it); the suite needs fresh random rooms.
 *  A missing mode is "allowlist" (closed with an empty list); any other word is "off". */
export type MeshMode = "off" | "allowlist" | "test-open";
export function meshMode(env: Pick<Env, "MESH_RELAY_MODE">): MeshMode {
  const raw = env.MESH_RELAY_MODE;
  if (raw === undefined) return "allowlist";
  if (raw === "allowlist" || raw === "test-open") return raw;
  return "off"; // includes "off", "open" (refused for now) and every typo
}

export function meshRelayEnabled(env: Pick<Env, "MESH_RELAY_ENABLED" | "MESH_RELAY_MODE">): boolean {
  return env.MESH_RELAY_ENABLED === "1" && meshMode(env) !== "off";
}

/** Whether a room may be reached at all. Allow-list mode with an empty list admits nothing (fails closed). */
export function roomAllowed(env: Pick<Env, "MESH_ALLOWED_ROOMS" | "MESH_RELAY_MODE">, room: string): boolean {
  const mode = meshMode(env);
  if (mode === "test-open") return true;
  if (mode !== "allowlist") return false;
  const list = (env.MESH_ALLOWED_ROOMS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes(room);
}

/** Per-address limit on creating a set, and on every upgrade (finding 4). Fails CLOSED: a limiter that errors, or no
 *  limiter at all, refuses, except in test-open mode. WHY its own key prefix: the platform counts per key, so
 *  "mesh-relay:*" keys can never share a counter with the analytics keys that use the same binding. WHY the same
 *  binding: a dedicated ratelimit namespace would need a new `unsafe.bindings` entry in wrangler.toml, which could fail
 *  the automatic deploy; a deploy-verified version would add its own namespace_id and a stricter simple limit. */
export interface RelayLimiter { limit(o: { key: string }): Promise<{ success: boolean }> }
export async function limiterAllows(limiter: RelayLimiter | undefined, mode: MeshMode, key: string): Promise<"ok" | "limited" | "unavailable"> {
  if (!limiter) return mode === "test-open" ? "ok" : "unavailable";
  try { return (await limiter.limit({ key })).success ? "ok" : "limited"; } catch { return "unavailable"; }
}

/** Returns a Response when the request is a relay request this module owns, or null to fall through to
 *  the normal router (which then answers 404 exactly as for any unknown path). */
export async function handleMeshRelayRequest(req: Request, env: Env): Promise<Response | null> {
  // Checked before anything else, including before the path is even parsed for a room.
  if (!meshRelayEnabled(env) || !env.MESH_RELAY) return null;
  const url = new URL(req.url);
  const m = PATH.exec(url.pathname);
  if (!m) return null;
  const room = m[1]!;
  // A malformed or unlisted room is indistinguishable from "no such path": no oracle, no object. This check is
  // the gate that keeps strangers from ever creating an object (the Worker cannot verify a signature for an existing
  // room without the object, so the allow-list is what stands in front of it).
  if (!isHex(room, ROOM_HEX) || !roomAllowed(env, room)) return null;
  if (req.method !== "GET" || req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return new Response("expected a websocket upgrade", { status: 426 });
  }

  // Version refusal BEFORE a Durable Object exists for this room (a refused client must not create
  // one): accept the socket here, close it with the refusal code and the reason the app shows.
  const vRaw = url.searchParams.get("v");
  const v = vRaw !== null && /^\d{1,6}$/.test(vRaw) ? Number(vRaw) : NaN;
  if (!(v >= MESH_MIN_PROTOCOL_VERSION && v <= MESH_PROTOCOL_VERSION)) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();
    server.close(CLOSE_VERSION_REFUSED, "This app and the relay speak different versions. Update YouCoded.");
    return new Response(null, { status: 101, webSocket: client });
  }

  // Per-address limit on EVERY upgrade, before any object is created or woken (finding 4). Unlisted rooms never get here.
  const ip = req.headers.get("CF-Connecting-IP") ?? "";
  const gate = await limiterAllows(env.EVENT_RATE_LIMITER as RelayLimiter | undefined, meshMode(env), `mesh-relay:upgrade:${ip || "unknown"}`);
  if (gate === "limited") return new Response("too many connections from this address", { status: 429 });
  if (gate === "unavailable") return new Response("relay unavailable", { status: 503 });

  const stub = env.MESH_RELAY.get(env.MESH_RELAY.idFromName(room));
  const fwd = new Request("https://mesh-relay.internal/connect", req);
  // WHY set (not append) and delete first: the room object trusts these headers; only this code may write them.
  for (const k of ["X-Mesh-Room", "X-Mesh-Aud", "X-Mesh-Ip"]) fwd.headers.delete(k);
  fwd.headers.set("X-Mesh-Room", room);
  // The name the device must have dialled; it signs it into the challenge answer (T5 C9).
  fwd.headers.set("X-Mesh-Aud", url.host);
  // Used only for the per-address set-creation limit and then discarded from the socket's state.
  fwd.headers.set("X-Mesh-Ip", req.headers.get("CF-Connecting-IP") ?? "");
  return stub.fetch(fwd);
}

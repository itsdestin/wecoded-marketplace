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

export function meshRelayEnabled(env: Pick<Env, "MESH_RELAY_ENABLED">): boolean {
  return env.MESH_RELAY_ENABLED === "1";
}

/** Optional allow-list ("during the build only an allow-list of test sets is accepted", design 5.6).
 *  Empty or unset means no restriction. Comma-separated room ids. */
export function roomAllowed(env: Pick<Env, "MESH_ALLOWED_ROOMS">, room: string): boolean {
  const raw = (env.MESH_ALLOWED_ROOMS ?? "").trim();
  if (!raw) return true;
  return raw.split(",").map((s) => s.trim()).includes(room);
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
  // A malformed or unlisted room is indistinguishable from "no such path": no oracle, no object.
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

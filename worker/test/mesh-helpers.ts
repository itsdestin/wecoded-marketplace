// Shared test client for the Mesh relay (src/mesh/). A real client lives in the app; this one
// speaks the same wire format (binary: u32 header length, JSON header, payload) and signs the
// challenge with WebCrypto Ed25519, independently of the relay's own code except for id hashing.
import { SELF, env, runInDurableObject } from "cloudflare:test";
import { packMessage, unpackMessage } from "../src/mesh/protocol";
import { bytesToHex, deviceIdFor, hexToBytes, relayAuthMessage, roomIdFor, rosterStatementMessage, randomHex } from "../src/mesh/auth";
import type { MeshRelayRoom } from "../src/mesh/relay-room";

export const HOST = "test.local";

export interface Device { name: string; kp: CryptoKeyPair; signKey: string; dev: string; room: string }

/** A fresh identity. `room` is the room this device would name if it were the FIRST device of a set. */
export async function newDevice(name = "dev"): Promise<Device> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const signKey = bytesToHex(new Uint8Array((await crypto.subtle.exportKey("raw", kp.publicKey)) as ArrayBuffer));
  return { name, kp, signKey, dev: await deviceIdFor(signKey), room: await roomIdFor(signKey) };
}

export async function sign(d: Device, msg: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, d.kp.privateKey, msg)));
}

export interface Msg { h: any; payload: Uint8Array }

export class Conn {
  /** The device this connection signed in as (set by auth()); roster helpers sign as it. */
  as: Device | null = null;
  inbox: Msg[] = [];
  private taken = 0;
  closeInfo: { code: number; reason: string } | null = null;
  closed: Promise<{ code: number; reason: string }>;
  constructor(public ws: WebSocket, public room: string) {
    ws.addEventListener("message", (e) => {
      const data = e.data as ArrayBuffer | string;
      if (typeof data === "string") { this.inbox.push({ h: { op: "text", text: data }, payload: new Uint8Array(0) }); return; }
      const u = unpackMessage(data);
      if (u.ok) this.inbox.push({ h: u.header, payload: new Uint8Array(u.payload) });
    });
    this.closed = new Promise((resolve) => ws.addEventListener("close", (e) => { this.closeInfo = { code: e.code, reason: e.reason }; resolve(this.closeInfo); }));
    ws.accept();
  }

  /** Open a socket to a room. `query` defaults to the current protocol version. */
  static async open(room: string, opts: { query?: string; headers?: Record<string, string> } = {}): Promise<Conn> {
    const res = await SELF.fetch(`https://${HOST}/mesh/relay/${room}${opts.query ?? "?v=1"}`, { headers: { Upgrade: "websocket", ...(opts.headers ?? {}) } });
    if (res.status !== 101) throw new Error(`upgrade refused: ${res.status}`);
    return new Conn(res.webSocket!, room);
  }

  /** Open a socket to a pairing meeting point (/mesh/meet/<id>). */
  static async openMeet(id: string, opts: { query?: string; headers?: Record<string, string> } = {}): Promise<Conn> {
    const res = await SELF.fetch(`https://${HOST}/mesh/meet/${id}${opts.query ?? "?v=1"}`, { headers: { Upgrade: "websocket", ...(opts.headers ?? {}) } });
    if (res.status !== 101) throw new Error(`upgrade refused: ${res.status}`);
    return new Conn(res.webSocket!, id);
  }

  send(h: object, payload?: Uint8Array | null): void { this.ws.send(packMessage(h, payload)); }
  sendRaw(bytes: ArrayBuffer | Uint8Array): void { this.ws.send(bytes as ArrayBuffer); }

  async waitFor(match: string | ((m: Msg) => boolean), ms = 3000): Promise<Msg> {
    const pred = typeof match === "string" ? (m: Msg) => m.h.op === match : match;
    const t = Date.now();
    for (;;) {
      for (let i = this.taken; i < this.inbox.length; i++) {
        if (pred(this.inbox[i]!)) { const m = this.inbox[i]!; this.inbox.splice(i, 1); return m; }
      }
      if (Date.now() - t > ms) throw new Error(`timed out waiting for ${typeof match === "string" ? match : "message"}; inbox ops: ${this.inbox.map((m) => m.h.op).join(",")}; closed=${JSON.stringify(this.closeInfo)}`);
      await new Promise((r) => setTimeout(r, 5));
    }
  }
  /** Ask and wait for the reply carrying this id. */
  async call(h: Record<string, unknown> & { op: string }, payload?: Uint8Array | null, ms = 3000): Promise<Msg> {
    const id = Math.random().toString(36).slice(2);
    this.send({ ...h, id }, payload);
    return this.waitFor((m) => m.h.id === id, ms);
  }
  async frames(msgId: string, ms = 3000): Promise<Msg[]> {
    const out: Msg[] = [];
    for (;;) {
      const m = await this.waitFor((x) => x.h.id === msgId && (x.h.op === "frame" || x.h.op === "frames-end" || x.h.op === "gap"), ms);
      if (m.h.op === "frame") out.push(m); else return [...out, m];
    }
  }
  async waitClosed(ms = 3000): Promise<{ code: number; reason: string }> {
    return Promise.race([this.closed, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("socket did not close")), ms))]);
  }

  /** Read the challenge and answer it. `as` is the device; `firstDevice` sends the public key (only the
   *  first device of a new set does). */
  async auth(as: Device, opts: { firstDevice?: boolean; v?: number; room?: string; aud?: string; corruptSig?: boolean } = {}): Promise<Msg> {
    const ch = await this.waitFor("challenge");
    const msg = relayAuthMessage(opts.aud ?? ch.h.aud, opts.room ?? this.room, ch.h.nonce, as.dev);
    let sig = await sign(as, msg);
    if (opts.corruptSig) sig = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
    this.as = as;
    this.send({ op: "auth", v: opts.v ?? 1, dev: as.dev, sig, ...(opts.firstDevice ? { signKey: as.signKey } : {}), id: "auth" });
    return this.waitFor((m) => m.h.op === "auth-result" || m.h.op === "version-refused");
  }
}

// ---- Signed roster changes. The relay accepts only statements signed by a current member whose stated ancestry leads back to
// its own admission, so this ledger plays the app: it invents a genesis entry id for a room's first statement and then tracks
// each device's latest entry id as that device's `seen`. Keyed by room, which is random per test.
const ledger = new Map<string, { genesis: string | null; last: Map<string, string> }>();
const led = (room: string) => { let l = ledger.get(room); if (!l) { l = { genesis: null, last: new Map() }; ledger.set(room, l); } return l; };

export interface PutOpts { signer?: Device; seen?: string[]; entry?: string; room?: string; corruptSig?: boolean; noReply?: boolean; at?: number; kind?: "add" | "remove" }
/** Build, sign and send a roster-put from `c`'s device (or `opts.signer`). Resolves with the relay's reply. */
export async function rosterPut(c: Conn, kind: "add" | "remove", target: { dev: string; signKey?: string }, opts: PutOpts = {}): Promise<Msg> {
  const signer = opts.signer ?? c.as;
  if (!signer) throw new Error("rosterPut: connection has not authenticated");
  const room = opts.room ?? c.room;
  const l = led(room);
  let seen = opts.seen;
  if (!seen) {
    if (l.genesis === null) { l.genesis = randomHex(32); l.last.set(signer.dev, l.genesis); }
    seen = [l.last.get(signer.dev) ?? l.genesis];
  }
  const entry = opts.entry ?? randomHex(32);
  const at = opts.at ?? Date.now();
  const targetKey = kind === "add" ? (target.signKey as string) : null;
  const msg = rosterStatementMessage({ kind, room, signer: signer.dev, target: target.dev, targetKey, entry, seen, at });
  let sig = await sign(signer, msg);
  if (opts.corruptSig) sig = (sig[0] === "0" ? "1" : "0") + sig.slice(1);
  const header = { op: "roster-put", kind, signer: signer.dev, target: target.dev, ...(targetKey ? { targetKey } : {}), entry, seen, at, sig };
  if (opts.noReply) { c.send(header); return { h: { op: "sent" }, payload: new Uint8Array(0) }; }
  const r = await c.call(header as any);
  if (r.h.op === "ok") { l.last.set(signer.dev, entry); if (kind === "add") l.last.set(target.dev, entry); }
  return r;
}
export const rosterAdd = async (c: Conn, target: Device | string, opts: PutOpts = {}): Promise<Msg> => {
  const signKey = typeof target === "string" ? target : target.signKey;
  return rosterPut(c, "add", { dev: typeof target === "string" ? await deviceIdFor(signKey).catch(() => "00".repeat(16)) : target.dev, signKey }, opts);
};
export const rosterRemove = (c: Conn, dev: string, opts: PutOpts = {}): Promise<Msg> => rosterPut(c, "remove", { dev }, opts);

/** Set up a set: first device creates it, the rest are added and connect. Returns connections by name. */
export async function makeSet(names: string[]): Promise<{ room: string; devices: Device[]; conns: Conn[] }> {
  const devices = await Promise.all(names.map((n) => newDevice(n)));
  const room = devices[0]!.room;
  const first = await Conn.open(room);
  const r = await first.auth(devices[0]!, { firstDevice: true });
  if (r.h.r !== "ok") throw new Error("setup: first device refused: " + JSON.stringify(r.h));
  const conns = [first];
  for (const d of devices.slice(1)) {
    const add = await rosterAdd(first, d);
    if (add.h.op !== "ok") throw new Error("setup: add refused " + JSON.stringify(add.h));
    const c = await Conn.open(room);
    const ar = await c.auth(d);
    if (ar.h.r !== "ok") throw new Error("setup: member refused " + JSON.stringify(ar.h));
    conns.push(c);
  }
  return { room, devices, conns };
}

let counter = 0;
/** A hold message header for device `d` with an explicit number. */
export function holdHeader(d: Device, g: string, n: number, session = "a".repeat(32), extra: object = {}): object {
  return { op: "hold", g, from: d.dev, session, n, ...extra };
}
export function bytesOf(size: number, fill = 7): Uint8Array {
  counter++;
  return new Uint8Array(size).fill((fill + counter) & 0xff);
}
export const hex = bytesToHex;
export const unhex = hexToBytes;

export const stubFor = (room: string) => env.MESH_RELAY.get(env.MESH_RELAY.idFromName(room));
/** Run code against the live room object. Limits and the clock are instance fields a test may replace. */
// WHY the cast: runInDurableObject's own generics recurse too deeply for the class type.
export const inRoom = <T>(room: string, fn: (r: MeshRelayRoom) => T | Promise<T>): Promise<T> =>
  (runInDurableObject as any)(stubFor(room), (inst: any) => fn(inst as MeshRelayRoom));

/** A fresh meeting id (what the app derives from the typed code's meeting part) and the member's `meet-open` for it. */
export const newMeetId = (): string => randomHex(32);
export async function openMeeting(member: Conn, m = newMeetId()): Promise<{ m: string; ticket: string; reply: Msg }> {
  const reply = await member.call({ op: "meet-open", m });
  return { m, ticket: String(reply.h.ticket ?? ""), reply };
}
/** Connect to a meeting and say who you are. Resolves with the connection and the relay's first answer. */
export async function joinMeeting(m: string, role: "host" | "guest", ticket?: string): Promise<{ c: Conn; first: Msg }> {
  const c = await Conn.openMeet(m);
  c.send({ op: "meet-join", role, ...(ticket ? { ticket } : {}) });
  const first = await c.waitFor((x) => x.h.op === "meet-joined" || x.h.op === "refused");
  return { c, first };
}

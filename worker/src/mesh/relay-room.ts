// MeshRelayRoom: the Mesh relay. One Durable Object per device set, named by the opaque room id.
//
// WHAT IT IS: a mailbox. A user's devices connect, prove they belong (signed challenge against
// the set's PUBLIC verification keys), pass sealed frames to each other live, and leave the
// newest ones here for devices that are offline. Spec: T7-relay-fit-cost.md (this file is the
// production version of its throwaway prototype), design.md 5.6 / 6.4, T5 C9, threat model Y-*.
//
// WHAT IT CAN NEVER DO: read content (frames arrive already sealed and signed), or hold a key
// (it stores public keys and opaque ids only; auth.ts imports no signing or sealing code).
//
// STATE RULE: everything that matters is in SQLite or in a socket's attachment. A hibernated
// object is evicted and rebuilt (constructor runs again) on the next message, so the only thing
// kept in memory is the per-connection flood counter, which is meant to be forgotten.
//
// LOGGING RULE: nothing in this file may log a frame body, a key, a signature, or a full id.
// The single console call is `meshLog` below, which prints an event name and an 8-character
// prefix of the room. A test pins that this stays the only console call in src/mesh/.
import type { Env } from "../types";
import {
  CHALLENGE_TTL_MS, CLOSE_AUTH_FAILED, CLOSE_BAD_MESSAGE, CLOSE_DEVICE_REMOVED, CLOSE_NOT_AUTHED,
  CLOSE_RELAY_BUSY, CLOSE_SET_ERASED, CLOSE_TOO_FAST, CLOSE_TOO_LARGE, CLOSE_VERSION_REFUSED,
  ABANDON_MS, DEVICE_HEX, FETCH_PAGE_BYTES, GROUP_TTL_MS, KEY_HEX, MAX_DEVICES, MAX_FRAME_BYTES, MAX_GROUPS,
  MAX_MESSAGE_BYTES, MAX_REGISTERS, MAX_SESSIONS_PER_DEVICE, MAX_SOCKETS, MAX_UNAUTH_SOCKETS, MESH_MIN_PROTOCOL_VERSION,
  MESH_PROTOCOL_VERSION, NEARLY_FULL_FRACTION, NONCE_HEX, OUT_WINDOW_BYTES, PRE_PAIR_CAP_BYTES, RATE_MAX_HOLDS,
  RATE_MAX_MESSAGES, RATE_WINDOW_MS, REGISTER_MAX_BYTES, ROOM_HEX, SESSION_HEX, SET_CAP_BYTES,
  SET_IDLE_ERASE_MS, SIG_HEX, UNAUTH_DEADLINE_MS, UNAUTH_MAX_MESSAGE_BYTES, UNAUTH_MIN_AGE_MS, isCount, isGroupName, isHex, isRegisterKey, packMessage, unpackMessage,
  type MeshFill, type MeshUsage,
} from "./protocol";
import { deviceIdFor, isEd25519Point, randomHex, relayAuthMessage, roomIdFor, verifyEd25519 } from "./auth";
import { limiterAllows, meshMode, type MeshMode } from "./routes";

/** The only logging in the relay. Event name + 8-character room prefix, nothing else. */
function meshLog(event: string, room: string | null): void {
  console.log(`mesh-relay ${event} room=${(room ?? "").slice(0, 8)}`);
}

/** What the platform's rate-limit binding looks like (absent in tests; a test passes a fake). */
export interface CreateLimiter { limit(o: { key: string }): Promise<{ success: boolean }> }

/** Per-socket state, kept in the socket's attachment so it survives hibernation. */
interface Att {
  authed: boolean;
  dev: string;          // "" until authed
  room: string;
  aud: string;
  nonce: string | null; // outstanding challenge; cleared the moment it is used (single use)
  issuedAt: number;
  ip: string;           // only for the set-creation limiter; dropped when auth completes
  lastBeat: number;     // highest beat number seen on this socket
}

/** Tunable per instance so tests can exercise ceilings without writing 900 MiB. */
export interface MeshLimits { setCap: number; prePairCap: number; maxGroups: number; maxFrame: number; outWindowBytes: number }

const TEXT = new TextEncoder();

export class MeshRelayRoom {
  private sql: SqlStorage;
  // Not state: replaceable by tests, rebuilt from env on every construction.
  limits: MeshLimits = { setCap: SET_CAP_BYTES, prePairCap: PRE_PAIR_CAP_BYTES, maxGroups: MAX_GROUPS, maxFrame: MAX_FRAME_BYTES, outWindowBytes: OUT_WINDOW_BYTES };
  createLimiter: CreateLimiter | undefined;
  now: () => number = () => Date.now();
  // Read from env on construction; a test may replace it. Decides whether a missing/failed limiter refuses (anything but test-open).
  mode: MeshMode;
  // False after an abandoned object erased itself: tables are rebuilt lazily on the next request, so the object
  // really is empty (no schema, no rows) while nobody uses it.
  private tablesReady = true;
  // WHY in memory: a flood counter is meant to be forgotten; an object only hibernates while idle,
  // so a flooder cannot reset it by hibernating mid-flood.
  private recent = new WeakMap<WebSocket, number[]>();
  private recentHolds = new WeakMap<WebSocket, number[]>();
  // Bytes sent to a connection in reply to fetches in the current window (finding 9): [windowStart, bytes].
  private outBytes = new WeakMap<WebSocket, [number, number]>();

  constructor(private state: DurableObjectState, private env: Env) {
    this.sql = state.storage.sql;
    this.createLimiter = env.EVENT_RATE_LIMITER as CreateLimiter | undefined;
    this.mode = meshMode(env);
    state.blockConcurrencyWhile(async () => { this.init(); });
    // Free keepalive: answered by the platform without waking the object or billing duration.
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // WHY a method: erase() drops every table but the object stays alive; the prototype hung every
  // later request after an erase because tables were only created in the constructor.
  private init(): void {
    this.q(`CREATE TABLE IF NOT EXISTS frames(g TEXT, seq INTEGER, sz INTEGER, b BLOB, PRIMARY KEY(g,seq)) WITHOUT ROWID`);
    this.q(`CREATE TABLE IF NOT EXISTS groups(g TEXT PRIMARY KEY, next_seq INTEGER NOT NULL, bytes INTEGER NOT NULL,
            last_line_at INTEGER NOT NULL, last_touch INTEGER NOT NULL, released_through INTEGER NOT NULL, last_writer TEXT NOT NULL) WITHOUT ROWID`);
    this.q(`CREATE TABLE IF NOT EXISTS recv(g TEXT, dev TEXT, through INTEGER NOT NULL, PRIMARY KEY(g,dev)) WITHOUT ROWID`);
    this.q(`CREATE TABLE IF NOT EXISTS regs(k TEXT PRIMARY KEY, v BLOB, tok INTEGER NOT NULL, rev INTEGER NOT NULL) WITHOUT ROWID`);
    // WHY the index: "what changed since revision N" otherwise reads every register (T7 measured 6,000 rows to return 0).
    this.q(`CREATE INDEX IF NOT EXISTS regs_rev ON regs(rev)`);
    // A removed device keeps its row (removed=1) as a ban, so it cannot simply be re-added (threat model R-6, partly).
    this.q(`CREATE TABLE IF NOT EXISTS roster(dev TEXT PRIMARY KEY, sign_key TEXT NOT NULL, added_at INTEGER NOT NULL, removed INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID`);
    // Per-sender numbering for duplicate/replay refusal. Key is (device, run session): the app picks a
    // fresh random session on every start and counts from 1 (T5 C4), so a restart can never look like a replay.
    this.q(`CREATE TABLE IF NOT EXISTS senders(dev TEXT, session TEXT, last_n INTEGER NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY(dev,session)) WITHOUT ROWID`);
    // No declared type on v: it holds both numbers and the room id text.
    this.q(`CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v) WITHOUT ROWID`);
  }

  private ensureInit(): void { if (!this.tablesReady) { this.init(); this.tablesReady = true; } }

  private q(text: string, ...bind: unknown[]): Record<string, any>[] {
    return this.sql.exec(text, ...(bind as any[])).toArray() as Record<string, any>[];
  }
  private metaNum(k: string, d = 0): number { const r = this.q(`SELECT v FROM meta WHERE k=?`, k); return r.length ? Number(r[0]!.v) : d; }
  private metaText(k: string): string | null { const r = this.q(`SELECT v FROM meta WHERE k=?`, k); return r.length ? String(r[0]!.v) : null; }
  private metaSet(k: string, v: number | string): void { this.q(`INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`, k, v); }
  private totalBytes(): number { return this.metaNum("total_bytes"); }
  private activeDevices(): string[] { return this.q(`SELECT dev FROM roster WHERE removed=0`).map((r) => String(r.dev)); }

  // ---------------------------------------------------------------- accounting
  private cap(): number { return this.metaNum("paired") === 1 ? this.limits.setCap : this.limits.prePairCap; }
  private fillOf(bytes: number): MeshFill {
    const cap = this.cap();
    if (bytes >= cap) return "full";
    return bytes >= cap * NEARLY_FULL_FRACTION ? "nearly-full" : "ok";
  }
  private usage(): MeshUsage {
    const bytes = this.totalBytes();
    return { bytes, cap: this.cap(), fill: this.fillOf(bytes), paired: this.metaNum("paired") === 1 };
  }

  // ---------------------------------------------------------------- connect
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
    this.ensureInit(); // after an abandoned-object erase the tables are rebuilt here, before anything reads them
    // These headers are set by routes.ts, which overwrites anything a client sent.
    const room = request.headers.get("X-Mesh-Room");
    const aud = request.headers.get("X-Mesh-Aud");
    if (!isHex(room, ROOM_HEX) || !aud) return new Response("bad request", { status: 400 });
    // The object name IS the room, so a mismatch cannot happen through the router; refuse if it somehow does.
    const stored = this.metaText("room");
    if (stored !== null && stored !== room) return new Response("bad request", { status: 400 });

    // WHY sweep first: sockets that never answered their challenge would otherwise hold a slot.
    const now = this.now();
    const closing = new Set<WebSocket>();
    const unauth: Array<{ ws: WebSocket; issuedAt: number }> = [];
    let authedCount = 0;
    for (const w of this.state.getWebSockets()) {
      // A socket that is already closing (or closed but not yet dropped from the list) holds no slot.
      if (w.readyState !== WebSocket.READY_STATE_OPEN) continue;
      const a = this.att(w);
      if (!a || (!a.authed && now - a.issuedAt > UNAUTH_DEADLINE_MS)) { this.close(w, CLOSE_AUTH_FAILED, "challenge expired"); closing.add(w); }
      else if (a.authed) authedCount++;
      else unauth.push({ ws: w, issuedAt: a.issuedAt });
    }
    // WHY two caps (finding 5): a stranger who only knows the room id can hold at most the small unauthenticated
    // cap, and that never consumes the members' 64. When it is full the OLDEST stranger (if it has had a fair
    // chance to answer) is dropped for the newcomer, so a member can always connect.
    if (authedCount >= MAX_SOCKETS) return new Response("relay busy", { status: 503 });
    if (unauth.length >= MAX_UNAUTH_SOCKETS) {
      unauth.sort((x, y) => x.issuedAt - y.issuedAt);
      const oldest = unauth[0]!;
      if (now - oldest.issuedAt < UNAUTH_MIN_AGE_MS) return new Response("relay busy", { status: 503 });
      this.close(oldest.ws, CLOSE_RELAY_BUSY, "relay busy");
    }
    // First touch of this object: remember when, so an object nobody ever registers in can erase itself.
    if (this.metaNum("born", 0) === 0) this.metaSet("born", now);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    const nonce = randomHex(NONCE_HEX / 2);
    const att: Att = { authed: false, dev: "", room, aud, nonce, issuedAt: now, ip: (request.headers.get("X-Mesh-Ip") ?? "").slice(0, 64), lastBeat: 0 };
    server.serializeAttachment(att);
    this.send(server, { op: "challenge", aud, nonce, v: MESH_PROTOCOL_VERSION, min: MESH_MIN_PROTOCOL_VERSION });
    // The alarm closes this socket at its deadline even if nobody ever connects again, and (if no device ever
    // registers) erases the object once ABANDON_MS has passed.
    await this.armAt(now + UNAUTH_DEADLINE_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------------------------------------------------------------- helpers
  private att(ws: WebSocket): Att | null {
    const a = ws.deserializeAttachment() as Att | null;
    return a && typeof a === "object" && typeof a.authed === "boolean" ? a : null;
  }
  private send(ws: WebSocket, header: object, payload?: ArrayBuffer | Uint8Array | null): void {
    // send() throws if the peer is mid-close; one dead socket must never strand a broadcast loop.
    try { ws.send(packMessage(header, payload)); } catch { /* peer gone */ }
  }
  private close(ws: WebSocket, code: number, reason: string): void {
    try { ws.close(code, reason); } catch { /* already closing */ }
  }
  private authedSockets(): Array<{ ws: WebSocket; a: Att }> {
    const out: Array<{ ws: WebSocket; a: Att }> = [];
    for (const ws of this.state.getWebSockets()) { const a = this.att(ws); if (a && a.authed) out.push({ ws, a }); }
    return out;
  }
  private onlineDevices(excluding?: WebSocket): string[] {
    return [...new Set(this.authedSockets().filter((s) => s.ws !== excluding).map((s) => s.a.dev))];
  }
  private broadcast(header: object, opts: { exceptDev?: string; payload?: Uint8Array | null; toDev?: string } = {}): void {
    for (const { ws, a } of this.authedSockets()) {
      if (opts.exceptDev && a.dev === opts.exceptDev) continue;
      if (opts.toDev && a.dev !== opts.toDev) continue;
      this.send(ws, header, opts.payload);
    }
  }
  private idOf(h: Record<string, unknown>): { id?: string } {
    return typeof h.id === "string" && h.id.length <= 64 ? { id: h.id } : {};
  }
  /** True while this connection may still be sent fetch/list replies in the current window (finding 9). */
  private outBudgetLeft(ws: WebSocket): boolean {
    const now = this.now();
    const cur = this.outBytes.get(ws);
    return !cur || now - cur[0] >= RATE_WINDOW_MS || cur[1] < this.limits.outWindowBytes;
  }
  private chargeOut(ws: WebSocket, n: number): void {
    const now = this.now();
    const cur = this.outBytes.get(ws);
    if (!cur || now - cur[0] >= RATE_WINDOW_MS) this.outBytes.set(ws, [now, n]); else cur[1] += n;
  }
  private flood(ws: WebSocket, store: WeakMap<WebSocket, number[]>, max: number): boolean {
    const now = this.now();
    const list = (store.get(ws) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    list.push(now);
    store.set(ws, list);
    return list.length > max;
  }

  // ---------------------------------------------------------------- message entry
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      // Only binary frames are part of the protocol; the platform answers the text "ping" itself.
      if (typeof message === "string") return this.close(ws, CLOSE_BAD_MESSAGE, "binary messages only");
      // WHY size before anything else: refuse before doing any work on a huge message.
      if (message.byteLength > MAX_MESSAGE_BYTES) return this.close(ws, CLOSE_TOO_LARGE, "message too large");
      // WHY (finding 12): before authentication the only valid message is a small auth answer; refuse anything bigger at once.
      if (message.byteLength > UNAUTH_MAX_MESSAGE_BYTES && this.att(ws)?.authed !== true) return this.close(ws, CLOSE_TOO_LARGE, "message too large");
      if (this.flood(ws, this.recent, RATE_MAX_MESSAGES)) return this.close(ws, CLOSE_TOO_FAST, "too many messages");
      const m = unpackMessage(message);
      if (!m.ok) return this.close(ws, CLOSE_BAD_MESSAGE, "malformed message");
      const a = this.att(ws);
      if (!a) return this.close(ws, CLOSE_BAD_MESSAGE, "no connection state");

      if (!a.authed) {
        if (m.op !== "auth") return this.close(ws, CLOSE_NOT_AUTHED, "authenticate first");
        return await this.handleAuth(ws, a, m.header);
      }
      // WHY re-checked on every message: a device removed while connected must lose its voice at once,
      // even if the close we sent has not landed yet (threat model R-5: "within one round trip").
      const row = this.q(`SELECT removed FROM roster WHERE dev=?`, a.dev)[0];
      if (!row || Number(row.removed) === 1) return this.close(ws, CLOSE_DEVICE_REMOVED, "device removed");

      const h = m.header;
      switch (m.op) {
        case "auth": return this.close(ws, CLOSE_BAD_MESSAGE, "already authenticated");
        case "hold": return this.hold(ws, a, h, m.payload);
        case "fetch-after": return this.fetchAfter(ws, h);
        case "received": return this.received(ws, a, h);
        case "drop-group": return this.dropGroupOp(ws, h);
        case "reg-get": return this.regGet(ws, h);
        case "reg-list": return this.regList(ws, h);
        case "reg-set": return this.regSet(ws, h, m.payload);
        case "presence": return this.send(ws, { op: "presence-result", ...this.idOf(h), devices: this.onlineDevices() });
        case "pass": return this.pass(ws, a, h, m.payload);
        case "beat": return this.beat(ws, a, h);
        case "roster-add": return await this.rosterAdd(ws, a, h);
        case "roster-remove": return await this.rosterRemove(ws, a, h);
        case "usage": return this.send(ws, { op: "usage-result", ...this.idOf(h), usage: this.usage() });
        // Unknown ops are answered, not punished: a newer app may speak an op this relay lacks.
        default: return this.send(ws, { op: "error", ...this.idOf(h), reason: "unknown-op" });
      }
    } catch (e) {
      // WHY only the error NAME: a database error message can quote the values it choked on.
      meshLog(`handler-error:${e instanceof Error ? e.name : "unknown"}`, this.metaText("room"));
      this.close(ws, 1011, "relay error");
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const a = this.att(ws);
    this.close(ws, 1000, "closed");
    if (a && a.authed) {
      // WHY (finding 3): the last time a device was here counts as activity, so a device that stayed connected for
      // weeks and then left starts a fresh 90-day window instead of looking idle since its first connect.
      this.touchLastConnect();
      this.announcePresence(a.dev, "off", ws);
    }
  }
  /** At most one write an hour (rows written are billed). */
  private touchLastConnect(): void {
    const t = this.now();
    if (this.rosterRowCount() > 0 && t - this.metaNum("last_connect", 0) > 3_600_000) this.metaSet("last_connect", t);
  }
  async webSocketError(ws: WebSocket): Promise<void> { await this.webSocketClose(ws); }

  private announcePresence(dev: string, state: "on" | "off", excluding?: WebSocket): void {
    // Another socket of the same device keeps it "on".
    if (state === "off" && this.onlineDevices(excluding).includes(dev)) return;
    this.broadcast({ op: "presence-change", device: dev, state }, { exceptDev: dev });
  }

  // ---------------------------------------------------------------- authentication (T5 C9)
  private async handleAuth(ws: WebSocket, a: Att, h: Record<string, unknown>): Promise<void> {
    const fail = (r: string, code: number, why: string) => {
      this.send(ws, { op: "auth-result", r, ...this.idOf(h) });
      this.close(ws, code, why);
    };
    // Version first: a too-old or too-new client gets the clear "update" answer, whatever else is wrong.
    if (typeof h.v !== "number" || !Number.isInteger(h.v) || h.v < MESH_MIN_PROTOCOL_VERSION || h.v > MESH_PROTOCOL_VERSION) {
      this.send(ws, { op: "version-refused", min: MESH_MIN_PROTOCOL_VERSION, max: MESH_PROTOCOL_VERSION });
      return this.close(ws, CLOSE_VERSION_REFUSED, "protocol version not supported");
    }
    // Single use, fresh, and ours: the nonce lives only in this socket's attachment, so a response
    // captured on another connection can never match, and it is cleared before anything else runs.
    const nonce = a.nonce;
    ws.serializeAttachment({ ...a, nonce: null } satisfies Att);
    if (nonce === null) return fail("stale-challenge", CLOSE_AUTH_FAILED, "no outstanding challenge");
    if (this.now() - a.issuedAt > CHALLENGE_TTL_MS) return fail("stale-challenge", CLOSE_AUTH_FAILED, "challenge expired");
    if (!isHex(h.dev, DEVICE_HEX) || !isHex(h.sig, SIG_HEX) || (h.signKey !== undefined && !isHex(h.signKey, KEY_HEX)) || !isHex(a.room, ROOM_HEX)) {
      return fail("bad-request", CLOSE_AUTH_FAILED, "bad request");
    }
    const dev = h.dev;
    const sig = h.sig;
    const msg = relayAuthMessage(a.aud, a.room, nonce, dev);

    const row = this.q(`SELECT sign_key, removed FROM roster WHERE dev=?`, dev)[0];
    let created = false;
    if (row) {
      // WHY signature FIRST, one generic answer (finding 6): the old order answered "removed" before checking anything
      // and told "bad signature" (device is on the roster) apart from "not on the roster", so a stranger who knew a
      // device id could learn its membership. Now only someone who can sign with the stored key learns more.
      if (!(await verifyEd25519(String(row.sign_key), msg, sig))) return fail("refused", CLOSE_AUTH_FAILED, "refused");
      if (Number(row.removed) === 1) return fail("removed", CLOSE_DEVICE_REMOVED, "device removed");
    } else {
      // Unknown device: the only way in is to be the FIRST device of a brand-new, empty set.
      if (this.activeDevices().length > 0 || this.rosterRowCount() > 0) return fail("refused", CLOSE_AUTH_FAILED, "refused");
      // A set whose last device was removed is retired for good (finding 7): the same key cannot resurrect the room id.
      if (this.metaNum("retired", 0) === 1) return fail("refused", CLOSE_AUTH_FAILED, "refused");
      const signKey = h.signKey;
      if (typeof signKey !== "string") return fail("refused", CLOSE_AUTH_FAILED, "refused");
      // Self-certifying names: the room and the device id must both be derived from the key presented.
      if ((await roomIdFor(signKey)) !== a.room || (await deviceIdFor(signKey)) !== dev) return fail("refused", CLOSE_AUTH_FAILED, "refused");
      if (!(await verifyEd25519(signKey, msg, sig))) return fail("refused", CLOSE_AUTH_FAILED, "refused");
      // Per-address cap on creating sets (T7 abuse protection 3), checked only after the signature is good.
      // WHY fail CLOSED (finding 4): the old code skipped the check when the limiter or the address was missing and
      // let a limiter error through. Now only test-open mode (the test suite) may create a set without a working limiter.
      const gate = await limiterAllows(a.ip ? this.createLimiter : undefined, this.mode, `mesh-relay:create:${a.ip || "unknown"}`);
      if (gate !== "ok") return fail("rate-limited", CLOSE_TOO_FAST, "too many new sets from this address");
      // WHY re-checked: the awaits above let another connection register first; commit only if still empty.
      if (this.rosterRowCount() > 0) return fail("refused", CLOSE_AUTH_FAILED, "refused");
      const now = this.now();
      this.q(`INSERT INTO roster(dev,sign_key,added_at,removed) VALUES(?,?,?,0)`, dev, signKey, now);
      this.metaSet("room", a.room);
      this.metaSet("last_connect", now);
      created = true;
    }

    ws.serializeAttachment({ ...a, authed: true, dev, nonce: null, ip: "" } satisfies Att);
    // Throttled: at most one write an hour, not one per reconnect (rows written are billed).
    const t = this.now();
    if (t - this.metaNum("last_connect", 0) > 3_600_000) this.metaSet("last_connect", t);
    await this.arm();
    this.send(ws, { op: "auth-result", r: "ok", created, usage: this.usage(), devices: this.activeDevices(), ...this.idOf(h) });
    this.announcePresence(dev, "on");
  }
  private rosterRowCount(): number { return Number(this.q(`SELECT count(*) n FROM roster`)[0]!.n); }

  // ---------------------------------------------------------------- hold
  private hold(ws: WebSocket, a: Att, h: Record<string, unknown>, payload: Uint8Array): void {
    const idf = this.idOf(h);
    if (this.flood(ws, this.recentHolds, RATE_MAX_HOLDS)) return this.send(ws, { op: "over-limit", ...idf, why: "rate" });
    if (payload.byteLength === 0) return this.send(ws, { op: "refused", ...idf, reason: "empty-frame" });
    if (payload.byteLength > this.limits.maxFrame) return this.send(ws, { op: "over-limit", ...idf, why: "frame" });
    if (!isGroupName(h.g) || !isHex(h.session, SESSION_HEX) || !isCount(h.n) || h.n < 1) return this.send(ws, { op: "refused", ...idf, reason: "bad-header" });
    // Forged sender: the relay stamps identity from the proven connection, never from a claim.
    if (h.from !== a.dev) return this.send(ws, { op: "refused", ...idf, reason: "forged-sender" });
    const g = h.g, session = h.session, n = h.n;
    const size = payload.byteLength;

    // Per-sender numbering: each (device, session) must strictly increase. A repeat is a retry or a replay.
    const sender = this.q(`SELECT last_n FROM senders WHERE dev=? AND session=?`, a.dev, session)[0];
    if (sender && n <= Number(sender.last_n)) return this.send(ws, { op: "duplicate", ...idf, g, n });

    const now = this.now();
    let grp = this.q(`SELECT next_seq, bytes FROM groups WHERE g=?`, g)[0];
    if (!grp) {
      if (Number(this.q(`SELECT count(*) n FROM groups`)[0]!.n) >= this.limits.maxGroups) return this.send(ws, { op: "over-limit", ...idf, why: "groups" });
      this.q(`INSERT INTO groups(g,next_seq,bytes,last_line_at,last_touch,released_through,last_writer) VALUES(?,?,?,?,?,?,?)`, g, 1, 0, now, now, 0, a.dev);
      grp = { next_seq: 1, bytes: 0 };
    }
    // One group alone may not exceed the set's ceiling (a chat over the ceiling is never held; the host says "Relay full").
    if (Number(grp.bytes) + size > this.cap()) return this.send(ws, { op: "over-limit", ...idf, why: "group", fill: this.fillOf(this.totalBytes()) });
    let released: Array<{ g: string; through: number }> = [];
    if (this.totalBytes() + size > this.cap()) released = this.makeRoom(size, g, a.dev);
    if (this.totalBytes() + size > this.cap()) {
      // WHY announce first (finding 10): groups were already emptied above; devices must hear "released" even when
      // this write is then refused (possible only if byte accounting drifted), instead of discovering it later as a gap.
      for (const r of released) this.broadcast({ op: "released", g: r.g, throughSeq: r.through });
      return this.send(ws, { op: "over-limit", ...idf, why: "set", fill: "full" });
    }

    const seq = Number(grp.next_seq);
    this.q(`INSERT INTO frames(g,seq,sz,b) VALUES(?,?,?,?)`, g, seq, size, payload);
    this.q(`UPDATE groups SET next_seq=?, bytes=bytes+?, last_touch=?, last_writer=?, last_line_at=CASE WHEN ? THEN ? ELSE last_line_at END WHERE g=?`,
      seq + 1, size, now, a.dev, h.line === true ? 1 : 0, now, g);
    this.metaSet("total_bytes", this.totalBytes() + size);
    this.noteSender(a.dev, session, n, now, !sender);
    this.send(ws, { op: "stored", ...idf, g, seq, fill: this.fillOf(this.totalBytes()) });
    for (const r of released) this.broadcast({ op: "released", g: r.g, throughSeq: r.through });
  }

  private noteSender(dev: string, session: string, n: number, now: number, isNew: boolean): void {
    this.q(`INSERT INTO senders(dev,session,last_n,last_at) VALUES(?,?,?,?) ON CONFLICT(dev,session) DO UPDATE SET last_n=excluded.last_n, last_at=excluded.last_at`, dev, session, n, now);
    if (isNew) {
      // Keep only the newest few sessions per device; older ones are dedupe-by-signature on the devices anyway.
      this.q(`DELETE FROM senders WHERE dev=? AND session NOT IN (SELECT session FROM senders WHERE dev=? ORDER BY last_at DESC LIMIT ?)`, dev, dev, MAX_SESSIONS_PER_DEVICE);
    }
  }

  /** Release whole groups, least recently used first, the WRITER'S OWN groups before anyone else's
   *  (threat model Y-9: one device should not push another's waiting data out first), never the group
   *  being written. Every release is announced by the caller and kept as a mark on the group. */
  private makeRoom(need: number, protectG: string, writer: string): Array<{ g: string; through: number }> {
    const released: Array<{ g: string; through: number }> = [];
    const victims = this.q(`SELECT g, next_seq FROM groups WHERE g<>? AND bytes>0 ORDER BY (last_writer=?) DESC, last_touch ASC`, protectG, writer);
    for (const v of victims) {
      if (this.totalBytes() + need <= this.cap()) break;
      released.push({ g: String(v.g), through: Number(v.next_seq) - 1 });
      this.emptyGroup(String(v.g));
    }
    return released;
  }

  /** Empties a group but keeps its row: released_through says "lines up to here were let go". */
  private emptyGroup(g: string): number {
    const row = this.q(`SELECT next_seq, bytes FROM groups WHERE g=?`, g)[0];
    if (!row) return 0;
    this.q(`DELETE FROM frames WHERE g=?`, g);
    this.q(`UPDATE groups SET bytes=0, released_through=? WHERE g=?`, Number(row.next_seq) - 1, g);
    this.metaSet("total_bytes", Math.max(0, this.totalBytes() - Number(row.bytes)));
    return Number(row.next_seq) - 1;
  }

  private dropGroupOp(ws: WebSocket, h: Record<string, unknown>): void {
    if (!isGroupName(h.g)) return this.send(ws, { op: "refused", ...this.idOf(h), reason: "bad-header" });
    if (!this.q(`SELECT 1 FROM groups WHERE g=?`, h.g)[0]) return this.send(ws, { op: "refused", ...this.idOf(h), reason: "unknown-group" });
    const through = this.emptyGroup(h.g);
    this.broadcast({ op: "released", g: h.g, throughSeq: through });
    this.send(ws, { op: "ok", ...this.idOf(h) });
  }

  // ---------------------------------------------------------------- fetch-after
  private fetchAfter(ws: WebSocket, h: Record<string, unknown>): void {
    const idf = this.idOf(h);
    if (!isGroupName(h.g) || !isCount(h.seq)) return this.send(ws, { op: "refused", ...idf, reason: "bad-header" });
    // WHY (finding 9): a member could otherwise pull 4 MiB per request, 300 requests per window, on 64 connections.
    if (!this.outBudgetLeft(ws)) return this.send(ws, { op: "over-limit", ...idf, why: "rate" });
    const g = this.q(`SELECT released_through FROM groups WHERE g=?`, h.g)[0];
    if (!g) return this.send(ws, { op: "frames-end", ...idf, g: h.g, more: false, empty: true });
    if (h.seq < Number(g.released_through)) return this.send(ws, { op: "gap", ...idf, g: h.g, through: Number(g.released_through) });
    let sent = 0, last = h.seq, more = false;
    for (const r of this.sql.exec(`SELECT seq, sz, b FROM frames WHERE g=? AND seq>? ORDER BY seq`, h.g, h.seq)) {
      const sz = Number(r.sz);
      if (sent + sz > FETCH_PAGE_BYTES && sent > 0) { more = true; break; }
      this.send(ws, { op: "frame", ...idf, g: h.g, seq: Number(r.seq) }, new Uint8Array(r.b as ArrayBuffer));
      sent += sz; last = Number(r.seq);
    }
    this.chargeOut(ws, sent);
    this.send(ws, { op: "frames-end", ...idf, g: h.g, more, last });
  }

  // ---------------------------------------------------------------- received (acks)
  /** A frame is dropped once EVERY active roster device has reported receiving it. A device that has said
   *  nothing blocks the drop, so apps report `through = head` for chats they do not want (T7 finding 9). */
  private received(ws: WebSocket, a: Att, h: Record<string, unknown>): void {
    const idf = this.idOf(h);
    if (!isGroupName(h.g) || !isCount(h.through)) return this.send(ws, { op: "refused", ...idf, reason: "bad-header" });
    const grp = this.q(`SELECT next_seq FROM groups WHERE g=?`, h.g)[0];
    if (!grp) return this.send(ws, { op: "refused", ...idf, reason: "unknown-group" });
    // A device cannot acknowledge lines that do not exist yet (that would pre-approve their deletion).
    if (h.through > Number(grp.next_seq) - 1) return this.send(ws, { op: "refused", ...idf, reason: "through-beyond-head" });
    this.q(`INSERT INTO recv(g,dev,through) VALUES(?,?,?) ON CONFLICT(g,dev) DO UPDATE SET through=MAX(through,excluded.through)`, h.g, a.dev, h.through);
    // Only devices still on the roster count; a removed device's counters never trigger or block a drop (threat model Y-10).
    const m = this.q(`SELECT count(*) n, min(through) m FROM recv WHERE g=? AND dev IN (SELECT dev FROM roster WHERE removed=0)`, h.g)[0]!;
    if (Number(m.n) >= this.activeDevices().length) this.dropReceived(h.g, Number(m.m));
    this.send(ws, { op: "ok", ...idf });
  }
  private dropReceived(g: string, through: number): void {
    const sz = Number(this.q(`SELECT coalesce(sum(sz),0) s FROM frames WHERE g=? AND seq<=?`, g, through)[0]!.s);
    if (!sz) return;
    this.q(`DELETE FROM frames WHERE g=? AND seq<=?`, g, through);
    this.q(`UPDATE groups SET bytes=bytes-? WHERE g=?`, sz, g);
    this.metaSet("total_bytes", Math.max(0, this.totalBytes() - sz));
  }

  // ---------------------------------------------------------------- registers (compare-and-swap)
  private regGet(ws: WebSocket, h: Record<string, unknown>): void {
    if (!isRegisterKey(h.key)) return this.send(ws, { op: "refused", ...this.idOf(h), reason: "bad-header" });
    const r = this.q(`SELECT k, v, tok FROM regs WHERE k=?`, h.key)[0];
    const len = r ? (r.v as ArrayBuffer).byteLength : 0;
    this.send(ws, { op: "reg-result", ...this.idOf(h), regs: r ? [{ key: String(r.k), token: Number(r.tok), len }] : [] }, r ? new Uint8Array(r.v as ArrayBuffer) : null);
  }
  private regList(ws: WebSocket, h: Record<string, unknown>): void {
    const since = h.sinceRev === undefined ? 0 : h.sinceRev;
    if (!isCount(since)) return this.send(ws, { op: "refused", ...this.idOf(h), reason: "bad-header" });
    if (!this.outBudgetLeft(ws)) return this.send(ws, { op: "over-limit", ...this.idOf(h), why: "rate" });
    // WHY paged by revision: 4096 registers of 16 KiB could be 64 MiB; replies stay near FETCH_PAGE_BYTES and say `more`.
    const rows: Array<{ k: string; v: Uint8Array; tok: number; rev: number }> = [];
    let total = 0, more = false;
    for (const r of this.sql.exec(`SELECT k, v, tok, rev FROM regs WHERE rev>? ORDER BY rev`, since)) {
      const v = new Uint8Array(r.v as ArrayBuffer);
      if (total + v.length > FETCH_PAGE_BYTES && rows.length > 0) { more = true; break; }
      rows.push({ k: String(r.k), v, tok: Number(r.tok), rev: Number(r.rev) });
      total += v.length;
    }
    this.chargeOut(ws, total);
    const body = new Uint8Array(total);
    let o = 0;
    for (const r of rows) { body.set(r.v, o); o += r.v.length; }
    const rev = more ? rows[rows.length - 1]!.rev : this.metaNum("rev", 0);
    this.send(ws, { op: "reg-list-result", ...this.idOf(h), rev, more, regs: rows.map((r) => ({ key: r.k, token: r.tok, len: r.v.length })) }, body);
  }
  private regSet(ws: WebSocket, h: Record<string, unknown>, payload: Uint8Array): void {
    const idf = this.idOf(h);
    if (!isRegisterKey(h.key) || !isCount(h.expectToken)) return this.send(ws, { op: "refused", ...idf, reason: "bad-header" });
    if (payload.byteLength > REGISTER_MAX_BYTES) return this.send(ws, { op: "over-limit", ...idf, why: "register" });
    const cur = this.q(`SELECT tok, v FROM regs WHERE k=?`, h.key)[0];
    const curTok = cur ? Number(cur.tok) : 0;
    if (curTok !== h.expectToken) {
      return this.send(ws, { op: "conflict", ...idf, token: curTok, len: cur ? (cur.v as ArrayBuffer).byteLength : 0 }, cur ? new Uint8Array(cur.v as ArrayBuffer) : null);
    }
    if (!cur && Number(this.q(`SELECT count(*) n FROM regs`)[0]!.n) >= MAX_REGISTERS) return this.send(ws, { op: "over-limit", ...idf, why: "register" });
    // WHY registers count toward the set's storage ceiling (finding 4): up to 4096 x 16 KiB = 64 MiB sat outside every
    // cap. Counted as key + value bytes; an overwrite only counts the change, and a shrinking write is always allowed.
    const newSize = TEXT.encode(h.key).length + payload.byteLength;
    const oldSize = cur ? TEXT.encode(h.key).length + (cur.v as ArrayBuffer).byteLength : 0;
    if (newSize > oldSize && this.totalBytes() + (newSize - oldSize) > this.cap()) return this.send(ws, { op: "over-limit", ...idf, why: "set", fill: this.fillOf(this.totalBytes()) });
    this.metaSet("total_bytes", Math.max(0, this.totalBytes() + newSize - oldSize));
    const rev = this.metaNum("rev", 0) + 1;
    this.metaSet("rev", rev);
    this.q(`INSERT INTO regs(k,v,tok,rev) VALUES(?,?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, tok=excluded.tok, rev=excluded.rev`, h.key, payload, curTok + 1, rev);
    this.send(ws, { op: "reg-ok", ...idf, token: curTok + 1 });
  }

  // ---------------------------------------------------------------- live lane: pass-through and beats (never stored)
  private pass(ws: WebSocket, a: Att, h: Record<string, unknown>, payload: Uint8Array): void {
    const idf = this.idOf(h);
    if (!isGroupName(h.g) || !(h.to === "all" || isHex(h.to, DEVICE_HEX))) return this.send(ws, { op: "refused", ...idf, reason: "bad-header" });
    if (payload.byteLength > this.limits.maxFrame) return this.send(ws, { op: "over-limit", ...idf, why: "frame" });
    // `from` is stamped here from the proven connection; whatever the client wrote is ignored.
    this.broadcast({ op: "pass", from: a.dev, g: h.g }, { exceptDev: a.dev, payload, ...(h.to === "all" ? {} : { toDev: h.to as string }) });
  }
  /** Numbered beat (design 5.2): forwarded to the other devices, never stored. A beat whose number is not
   *  higher than the last one on this connection is a replay or a duplicate and is silently dropped. */
  private beat(ws: WebSocket, a: Att, h: Record<string, unknown>): void {
    if (!isCount(h.n) || h.n < 1) return this.send(ws, { op: "refused", ...this.idOf(h), reason: "bad-header" });
    if (h.n <= a.lastBeat) return;
    ws.serializeAttachment({ ...a, lastBeat: h.n } satisfies Att);
    this.broadcast({ op: "beat", from: a.dev, n: h.n }, { exceptDev: a.dev });
  }

  // ---------------------------------------------------------------- roster (public keys only)
  private async rosterAdd(ws: WebSocket, a: Att, h: Record<string, unknown>): Promise<void> {
    const idf = this.idOf(h);
    // WHY a curve check, not just 64 hex characters (finding 13): a non-key would hold one of the 16 slots forever.
    if (!isHex(h.signKey, KEY_HEX) || !(await isEd25519Point(h.signKey))) return this.send(ws, { op: "refused", ...idf, reason: "bad-header" });
    const dev = await deviceIdFor(h.signKey);
    // Re-read after the await (other messages may have run meanwhile).
    const existing = this.q(`SELECT removed FROM roster WHERE dev=?`, dev)[0];
    if (existing) return this.send(ws, { op: "refused", ...idf, reason: Number(existing.removed) === 1 ? "banned" : "already-member" });
    if (this.activeDevices().length >= MAX_DEVICES) return this.send(ws, { op: "refused", ...idf, reason: "too-many-devices" });
    this.q(`INSERT INTO roster(dev,sign_key,added_at,removed) VALUES(?,?,?,0)`, dev, h.signKey, this.now());
    // The second device lifts the pre-pairing allowance to the full ceiling (T7 abuse protection 1).
    if (this.activeDevices().length >= 2) this.metaSet("paired", 1);
    this.broadcast({ op: "roster-changed", change: "added", dev }, { exceptDev: a.dev });
    this.send(ws, { op: "ok", ...idf, dev } as object);
  }
  private async rosterRemove(ws: WebSocket, a: Att, h: Record<string, unknown>): Promise<void> {
    const idf = this.idOf(h);
    if (!isHex(h.dev, DEVICE_HEX)) return this.send(ws, { op: "refused", ...idf, reason: "bad-header" });
    const row = this.q(`SELECT removed FROM roster WHERE dev=?`, h.dev)[0];
    if (!row || Number(row.removed) === 1) return this.send(ws, { op: "refused", ...idf, reason: "not-found" });
    const dev = h.dev;
    this.q(`UPDATE roster SET removed=1 WHERE dev=?`, dev);
    // Its acknowledgements must not count for or against dropping frames any more.
    this.q(`DELETE FROM recv WHERE dev=?`, dev);
    this.q(`DELETE FROM senders WHERE dev=?`, dev);
    // Close every connection it has, including the one that asked if it removed itself.
    for (const { ws: w, a: wa } of this.authedSockets()) if (wa.dev === dev) this.close(w, CLOSE_DEVICE_REMOVED, "device removed");
    this.broadcast({ op: "roster-changed", change: "removed", dev }, { exceptDev: dev });
    if (dev !== a.dev) this.send(ws, { op: "ok", ...idf });
    // An empty roster erases the set at once (design 5.6).
    if (this.activeDevices().length === 0) return await this.eraseAsync("emptied");
    // Removal can complete other devices' acknowledgement sets: re-run the drop rule for held groups.
    for (const g of this.q(`SELECT g FROM groups WHERE bytes>0`)) {
      const m = this.q(`SELECT count(*) n, min(through) m FROM recv WHERE g=? AND dev IN (SELECT dev FROM roster WHERE removed=0)`, g.g)[0]!;
      if (Number(m.n) >= this.activeDevices().length) this.dropReceived(String(g.g), Number(m.m));
    }
  }

  // ---------------------------------------------------------------- lifetimes: 30-day groups, 90-day erase, abandoned objects
  private async arm(): Promise<void> {
    // An early alarm is harmless (it recomputes and re-arms), so one getAlarm per wake is enough.
    if ((await this.state.storage.getAlarm()) === null) await this.state.storage.setAlarm(this.now() + GROUP_TTL_MS);
  }
  /** Make sure an alarm fires no later than `at` (an earlier one already set stays). */
  private async armAt(at: number): Promise<void> {
    const cur = await this.state.storage.getAlarm();
    if (cur === null || cur > at) await this.state.storage.setAlarm(at);
  }

  async alarm(): Promise<void> {
    this.ensureInit();
    const now = this.now();
    // 1. Unauthenticated sockets past their short deadline close here, not only when someone else connects (finding 5).
    let nextUnauth: number | null = null;
    for (const w of this.state.getWebSockets()) {
      const a = this.att(w);
      if (!a) { this.close(w, CLOSE_AUTH_FAILED, "no connection state"); continue; }
      if (a.authed) continue;
      if (now - a.issuedAt > UNAUTH_DEADLINE_MS) this.close(w, CLOSE_AUTH_FAILED, "challenge expired");
      else nextUnauth = Math.min(nextUnauth ?? Infinity, a.issuedAt + UNAUTH_DEADLINE_MS);
    }
    // 2. Nobody ever registered a device here: after ABANDON_MS the object erases itself (finding 4). A retired
    //    set (last device removed) keeps only its tombstone and needs no further wake-ups.
    if (this.rosterRowCount() === 0) {
      if (this.metaNum("retired", 0) === 1) return;
      const born = this.metaNum("born", now);
      if (now - born >= ABANDON_MS) return void (await this.abandonAsync());
      await this.state.storage.setAlarm(this.now() + Math.max(1000, Math.min(born + ABANDON_MS, nextUnauth ?? Infinity) - now));
      return;
    }
    // 3. WHY a live socket counts as activity (finding 3): last_connect is only written when a device authenticates, so a
    //    device that stayed connected for 90 days looked idle and the whole set was erased under its open socket.
    if (this.authedSockets().length > 0) this.metaSet("last_connect", now);
    if (now - this.metaNum("last_connect", now) > SET_IDLE_ERASE_MS) return void (await this.eraseAsync());
    for (const o of this.q(`SELECT g FROM groups WHERE bytes>0 AND last_line_at<?`, now - GROUP_TTL_MS)) {
      const through = this.emptyGroup(String(o.g));
      this.broadcast({ op: "released", g: String(o.g), throughSeq: through });
    }
    // Next wake: the oldest remaining group's expiry, an unauthenticated deadline, or the 90-day idle check, whichever is sooner.
    const oldest = this.q(`SELECT min(last_line_at) m FROM groups WHERE bytes>0`)[0]!.m;
    const idleAt = this.metaNum("last_connect", now) + SET_IDLE_ERASE_MS;
    const next = Math.min(oldest === null ? Infinity : Number(oldest) + GROUP_TTL_MS, idleAt, nextUnauth ?? Infinity);
    await this.state.storage.setAlarm(this.now() + Math.max(nextUnauth !== null ? 1000 : 60_000, next - now));
  }

  /** Erases everything (registers, roster, frames) and rebuilds the empty tables so the object keeps working.
   *  `emptied` (every device removed) also leaves a one-row tombstone so the same key cannot re-create the room (finding 7);
   *  an idle (90-day) erase leaves none, because then the owner's own key legitimately starts a new set. */
  async eraseAsync(why: "idle" | "emptied" = "idle"): Promise<void> {
    for (const w of this.state.getWebSockets()) this.close(w, CLOSE_SET_ERASED, "set erased");
    await this.state.storage.deleteAll();
    // WHY explicit: do not rely on deleteAll() also clearing the alarm; an erased set must not wake on its old schedule.
    await this.state.storage.deleteAlarm();
    this.init();
    if (why === "emptied") this.metaSet("retired", 1);
    meshLog("erased", null);
  }

  /** An object nobody registered a device in: wipes storage completely and does NOT rebuild the tables, so it holds
   *  nothing until (if ever) it is used again (ensureInit rebuilds on demand). */
  private async abandonAsync(): Promise<void> {
    for (const w of this.state.getWebSockets()) this.close(w, CLOSE_SET_ERASED, "set erased");
    await this.state.storage.deleteAll();
    await this.state.storage.deleteAlarm();
    this.tablesReady = false;
    meshLog("abandoned", null);
  }
}

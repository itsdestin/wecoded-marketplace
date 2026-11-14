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
  CLOSE_MEET_ENDED, CLOSE_MEET_REFUSED, MEET_HEX, MEET_JOIN_DEADLINE_MS, MEET_LIFETIME_MS, MEET_MAX_GUEST_CONNECTS, MEET_MAX_MESSAGES,
  MEET_MAX_HOST_MESSAGE_BYTES, MEET_MAX_MESSAGE_BYTES, MEET_MAX_OPEN_PER_DEVICE, MEET_MAX_OPEN_PER_ROOM, MEET_MAX_SOCKETS, MEET_MAX_TOTAL_BYTES, MEET_OPENS_PER_DEVICE_HOUR, MEET_OPENS_PER_ROOM_HOUR, MEET_RATE_MAX_MESSAGES,
  FIRST_STATEMENT_SKEW_MS, MAX_ADMISSIONS_PER_SIGNER, MAX_KNOWN_KEYS, ROSTER_MAX_PER_SIGNER, ROSTER_MAX_PER_SIGNER_HOUR, ROSTER_MAX_SEEN,
  CONTROL_FRAME_TTL_MS, CONTROL_GROUPS, CONTROL_RESERVE_FRACTION, OTHER_GROUP_MAX_BYTES, OTHER_WRITER_MAX_BYTES, OTHER_WRITER_MAX_FRAMES,
  ROSTER_WRITER_MAX_BYTES, ROSTER_WRITER_MAX_FRAMES, isControlGroup,
  SET_IDLE_ERASE_MS, SIG_HEX, UNAUTH_DEADLINE_MS, UNAUTH_MAX_MESSAGE_BYTES, UNAUTH_MIN_AGE_MS, isCount, isGroupName, isHex, isRegisterKey, packMessage, unpackMessage,
  type MeshFill, type MeshUsage,
} from "./protocol";
import { deviceIdFor, isEd25519Point, randomHex, relayAuthMessage, roomIdFor, rosterStatementMessage, verifyEd25519 } from "./auth";
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
  // ---- pairing meeting point sockets only (the same class serves both; a meeting object is named "meet:<id>") ----
  meet?: boolean;
  role?: "" | "host" | "guest"; // "" until meet-join
  gen?: number;         // guest connection number (the host tells guests apart by it)
  lastN?: number;       // highest meet-relay number seen on this socket (replay / duplicate refusal)
  at?: number;          // when it joined
  sent?: boolean;       // a guest has sent its first message (until then it holds the slot only MEET_JOIN_DEADLINE_MS)
}

/** Tunable per instance so tests can exercise ceilings without writing 900 MiB. */
export interface MeshLimits {
  setCap: number; prePairCap: number; maxGroups: number; maxFrame: number; outWindowBytes: number;
  // Per-writer / per-group quotas (review 2, N6). Instance fields so tests can exercise them without writing hundreds of MiB.
  otherGroupBytes: number; otherWriterBytes: number; otherWriterFrames: number; rosterWriterBytes: number; rosterWriterFrames: number;
}

/** WHY the relay has NO mutual-removal policy (third review, finding 8): the app decides what two simultaneous removals mean (and may change its
 *  rule, or later void a removal); a relay setting that could disagree would leave a device the app keeps banned here for good. So the relay
 *  enforces only what CURRENT members signed, in the one conservative reading: both removals stand, because a ban here only ever reduces who may
 *  connect and never grants anyone anything. KNOWN LIMIT: a removal the app later judges void leaves that device banned at the relay. */

/** Most statement ids the ancestry walk will visit (a log is capped at 8192 entries); named so a test can prove the bound exists. */
export const ANCESTRY_WALK_LIMIT = 8192;

const TEXT = new TextEncoder();
// Same cap as MAX_HEADER_BYTES for a meeting message's header (kept as its own name so a meeting header could be tightened alone).
const MAX_HEADER_BYTES_MEET = 1024;

/** Compares two strings without stopping at the first difference (the host ticket is a secret). */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export class MeshRelayRoom {
  private sql: SqlStorage;
  // Not state: replaceable by tests, rebuilt from env on every construction.
  limits: MeshLimits = { setCap: SET_CAP_BYTES, prePairCap: PRE_PAIR_CAP_BYTES, maxGroups: MAX_GROUPS, maxFrame: MAX_FRAME_BYTES, outWindowBytes: OUT_WINDOW_BYTES,
    otherGroupBytes: OTHER_GROUP_MAX_BYTES, otherWriterBytes: OTHER_WRITER_MAX_BYTES, otherWriterFrames: OTHER_WRITER_MAX_FRAMES, rosterWriterBytes: ROSTER_WRITER_MAX_BYTES, rosterWriterFrames: ROSTER_WRITER_MAX_FRAMES };
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
    // w = the writing device and t = when it was stored (review 2): per-writer quotas, freeing a removed writer's frames, and the 90-day control expiry.
    this.q(`CREATE TABLE IF NOT EXISTS frames(g TEXT, seq INTEGER, sz INTEGER, b BLOB, w TEXT, t INTEGER, PRIMARY KEY(g,seq)) WITHOUT ROWID`);
    this.q(`CREATE TABLE IF NOT EXISTS groups(g TEXT PRIMARY KEY, next_seq INTEGER NOT NULL, bytes INTEGER NOT NULL,
            last_line_at INTEGER NOT NULL, last_touch INTEGER NOT NULL, released_through INTEGER NOT NULL, last_writer TEXT NOT NULL,
            has_line INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID`);
    // WHY has_line (review finding 5): the 30-day rule and set-full release are about CHAT LINES. A group becomes a line group on its first
    // `line:true` hold; a group that never had one (the roster group, other control traffic) is a control group, which neither rule may touch.
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
    // Signed roster changes the relay has accepted (review finding 8): just ids, so the relay can check a new statement's
    // stated ancestry. rseen = the statement's `seen` list; rintro = the entry that introduced each device.
    this.q(`CREATE TABLE IF NOT EXISTS rentries(id TEXT PRIMARY KEY, signer TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL, t INTEGER NOT NULL DEFAULT 0) WITHOUT ROWID`);
    // WHY t (review finding 4): the per-device hourly limit counts accepted statements by the relay's own clock. t=0 marks the creator's
    // genesis placeholder, which is not a statement and never counts.
    this.q(`CREATE TABLE IF NOT EXISTS rseen(id TEXT NOT NULL, sid TEXT NOT NULL, PRIMARY KEY(id,sid)) WITHOUT ROWID`);
    this.q(`CREATE TABLE IF NOT EXISTS rintro(dev TEXT PRIMARY KEY, entry TEXT NOT NULL) WITHOUT ROWID`);
    // Pairing meetings this ROOM has opened (opened only by an authenticated member). The meeting id itself is the key; the
    // meeting object holds the actual pipe. Kept for an hour so the per-room hourly cap can count them.
    this.q(`CREATE TABLE IF NOT EXISTS meets(m TEXT PRIMARY KEY, created INTEGER NOT NULL, expires INTEGER NOT NULL, opener TEXT NOT NULL DEFAULT '') WITHOUT ROWID`);
    this.migrate();
    // Indexes come AFTER the migration: they name columns an old table may not have had yet.
    this.q(`CREATE INDEX IF NOT EXISTS rentries_signer ON rentries(signer, t)`);
    this.q(`CREATE INDEX IF NOT EXISTS frames_w ON frames(w)`);
  }

  /** WHY (review 2, N10): `CREATE TABLE IF NOT EXISTS` never changes a table that already exists, so an object created by older code kept the old
   *  `groups` / `meets` shape and its first hold or meet-open died with handler-error (1011). Each column added since is checked on every start (a handful of
   *  schema reads, no row reads, and no marker row that would show up in storage) and added if missing. No production object exists; this keeps test relays working. */
  private migrate(): void {
    const add = (table: string, col: string, ddl: string): boolean => {
      const cols = this.q(`PRAGMA table_info(${table})`).map((r) => String(r.name));
      if (cols.includes(col)) return false;
      this.q(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
      return true;
    };
    add("groups", "has_line", "INTEGER NOT NULL DEFAULT 0");
    add("meets", "opener", "TEXT NOT NULL DEFAULT ''");
    add("rentries", "t", "INTEGER NOT NULL DEFAULT 0");
    add("frames", "w", "TEXT");
    // Frames written before the stamp existed count as written now, so the 90-day clock starts at the upgrade rather than expiring them at once.
    if (add("frames", "t", "INTEGER")) this.q(`UPDATE frames SET t=? WHERE t IS NULL`, this.now());
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
    // Internal, non-socket calls between objects (and from the front door). X-Mesh-Kind is deleted from every client
    // request by routes.ts before it is forwarded, so only this code's own calls can carry it.
    const kind = request.headers.get("X-Mesh-Kind");
    if (kind === "meet-create") return await this.meetCreate(request);
    if (kind === "meet-check") return this.meetCheck(request.headers.get("X-Mesh-Meet") ?? "");
    if (kind === "meet-gone") return this.meetGone(request.headers.get("X-Mesh-Meet") ?? "");
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("expected websocket", { status: 426 });
    if (kind === "meet") return await this.meetConnect();
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
      // Meeting-point sockets have their own, much tighter rules and never touch the room's tables.
      if (this.att(ws)?.meet === true) return await this.meetMessage(ws, message);
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
        case "roster-put": return await this.rosterPut(ws, a, h);
        case "meet-open": return await this.meetOpen(ws, a, h);
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
    if (a?.meet === true) return await this.meetSocketGone(a);
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
    // WHY (review 2, N5): the retention class of a group the relay knows by name is fixed by that name. `line:true` on `roster` would make it releasable
    // under pressure and purgeable after 30 days, so any member could have the relay forget the roster frames. Refused, deterministically.
    const isLine = h.line === true;
    const control = isControlGroup(g);
    if (control && isLine) return this.send(ws, { op: "refused", ...idf, reason: "control-group" });

    // Per-sender numbering: each (device, session) must strictly increase. A repeat is a retry or a replay.
    const sender = this.q(`SELECT last_n FROM senders WHERE dev=? AND session=?`, a.dev, session)[0];
    if (sender && n <= Number(sender.last_n)) return this.send(ws, { op: "duplicate", ...idf, g, n });

    const now = this.now();
    let grp = this.q(`SELECT next_seq, bytes, has_line FROM groups WHERE g=?`, g)[0];
    // WHY (review 2, N5): for any other group the FIRST hold decides the class for good; a later hold that disagrees is refused, not applied.
    if (grp && !control && (Number(grp.has_line) === 1) !== isLine) return this.send(ws, { op: "refused", ...idf, reason: "group-class" });
    if (!grp) {
      if (Number(this.q(`SELECT count(*) n FROM groups`)[0]!.n) >= this.limits.maxGroups) return this.send(ws, { op: "over-limit", ...idf, why: "groups" });
      // The class is decided here, once (has_line is never updated afterwards).
      this.q(`INSERT INTO groups(g,next_seq,bytes,last_line_at,last_touch,released_through,last_writer,has_line) VALUES(?,?,?,?,?,?,?,?)`, g, 1, 0, now, now, 0, a.dev, isLine ? 1 : 0);
      grp = { next_seq: 1, bytes: 0, has_line: isLine ? 1 : 0 };
    }
    // WHY quotas (review 2, N6): groups that are neither line groups nor named control groups are never released, expired early or evicted, and are freed only
    // when every device acknowledges (devices acknowledge only what they follow), so a member's junk there would stay for good. Each writer therefore gets a byte
    // and frame quota, such a group gets its own cap, and all such junk together may not take the reserve the roster group needs for a removal bundle. The roster
    // group has a per-writer quota too (a member cannot fill it either). Chat lines are exempt: they are released under pressure.
    let capLimit = this.cap();
    if (!isLine) {
      const roster = control;
      if (!roster && Number(grp.bytes) + size > this.limits.otherGroupBytes) return this.send(ws, { op: "over-limit", ...idf, why: "group", fill: this.fillOf(this.totalBytes()) });
      const own = roster
        ? this.q(`SELECT coalesce(sum(sz),0) b, count(*) n FROM frames WHERE w=? AND g=?`, a.dev, g)[0]!
        : this.q(`SELECT coalesce(sum(f.sz),0) b, count(*) n FROM frames f JOIN groups gr ON gr.g=f.g WHERE f.w=? AND gr.has_line=0 AND f.g NOT IN (${CONTROL_GROUPS.map(() => "?").join(",")})`, a.dev, ...CONTROL_GROUPS)[0]!;
      const maxBytes = roster ? this.limits.rosterWriterBytes : this.limits.otherWriterBytes;
      const maxFrames = roster ? this.limits.rosterWriterFrames : this.limits.otherWriterFrames;
      if (Number(own.b) + size > maxBytes || Number(own.n) + 1 > maxFrames) return this.send(ws, { op: "over-limit", ...idf, why: "writer", fill: this.fillOf(this.totalBytes()) });
      if (!roster) capLimit = this.cap() - Math.floor(this.cap() * CONTROL_RESERVE_FRACTION);
    }
    // One group alone may not exceed the set's ceiling (a chat over the ceiling is never held; the host says "Relay full").
    if (Number(grp.bytes) + size > this.cap()) return this.send(ws, { op: "over-limit", ...idf, why: "group", fill: this.fillOf(this.totalBytes()) });
    let released: Array<{ g: string; through: number }> = [];
    if (this.totalBytes() + size > capLimit) released = this.makeRoom(size, g, a.dev, capLimit);
    if (this.totalBytes() + size > capLimit) {
      // WHY announce first (finding 10): groups were already emptied above; devices must hear "released" even when
      // this write is then refused (possible only if byte accounting drifted), instead of discovering it later as a gap.
      for (const r of released) this.broadcast({ op: "released", g: r.g, throughSeq: r.through });
      return this.send(ws, { op: "over-limit", ...idf, why: "set", fill: "full" });
    }

    const seq = Number(grp.next_seq);
    this.q(`INSERT INTO frames(g,seq,sz,b,w,t) VALUES(?,?,?,?,?,?)`, g, seq, size, payload, a.dev, now);
    this.q(`UPDATE groups SET next_seq=?, bytes=bytes+?, last_touch=?, last_writer=?, last_line_at=CASE WHEN ? THEN ? ELSE last_line_at END WHERE g=?`,
      seq + 1, size, now, a.dev, isLine ? 1 : 0, now, g);
    this.metaSet("total_bytes", this.totalBytes() + size);
    this.noteSender(a.dev, session, n, now, !sender);
    this.send(ws, { op: "stored", ...idf, g, seq, fill: this.fillOf(this.totalBytes()) });
    // Doorbell: tell the OTHER connected members something is waiting, so they fetch now instead of at their next
    // reconnect. WHY only (group, seq): the bell must carry nothing a member cannot already see in a `stored` reply; the
    // group name and the number are what a fetch needs and what T7 already counts as visible to the relay. Never the body or its size.
    this.broadcast({ op: "doorbell", g, seq }, { exceptDev: a.dev });
    for (const r of released) this.broadcast({ op: "released", g: r.g, throughSeq: r.through });
  }

  private noteSender(dev: string, session: string, n: number, now: number, isNew: boolean): void {
    this.q(`INSERT INTO senders(dev,session,last_n,last_at) VALUES(?,?,?,?) ON CONFLICT(dev,session) DO UPDATE SET last_n=excluded.last_n, last_at=excluded.last_at`, dev, session, n, now);
    if (isNew) {
      // Keep only the newest few sessions per device; older ones are dedupe-by-signature on the devices anyway.
      this.q(`DELETE FROM senders WHERE dev=? AND session NOT IN (SELECT session FROM senders WHERE dev=? ORDER BY last_at DESC LIMIT ?)`, dev, dev, MAX_SESSIONS_PER_DEVICE);
    }
  }

  /** Release whole LINE groups (never a control group: roster frames must survive memory pressure, review finding 5), least recently used first, the WRITER'S OWN groups before anyone else's
   *  (threat model Y-9: one device should not push another's waiting data out first), never the group
   *  being written. Every release is announced by the caller and kept as a mark on the group. */
  private makeRoom(need: number, protectG: string, writer: string, capLimit: number): Array<{ g: string; through: number }> {
    const released: Array<{ g: string; through: number }> = [];
    const victims = this.q(`SELECT g, next_seq FROM groups WHERE g<>? AND bytes>0 AND has_line=1 ORDER BY (last_writer=?) DESC, last_touch ASC`, protectG, writer);
    for (const v of victims) {
      if (this.totalBytes() + need <= capLimit) break;
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
    for (const r of this.sql.exec(`SELECT seq, sz, b, w FROM frames WHERE g=? AND seq>? ORDER BY seq`, h.g, h.seq)) {
      const sz = Number(r.sz);
      if (sent + sz > FETCH_PAGE_BYTES && sent > 0) { more = true; break; }
      this.send(ws, { op: "frame", ...idf, g: h.g, seq: Number(r.seq), w: r.w === null || r.w === undefined ? null : String(r.w) }, new Uint8Array(r.b as ArrayBuffer));
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

  // ---------------------------------------------------------------- roster (public keys only, signed changes)
  /** WHY signed (review finding 8): the old plain add/remove let ANY connected device add keys or remove the owner's first
   *  device. Now a change is accepted only as a statement signed by a CURRENT member (see auth.ts rosterStatementMessage),
   *  checked against the stored public key. What a server with no secrets can check of the app verifier's rules, it checks:
   *   - the signature, under the signer's stored key, over a message that names this room (no cross-room replay);
   *   - the signer is a current member now, and never accepts a statement whose ancestry contains the signer's own removal;
   *   - the statement's stated ancestry (`seen`) leads back to the entry that introduced the signer (a member signs against
   *     a history that includes its own admission);
   *   - an `add` never overwrites a device id already present, never re-adds a removed one (ban), names a real curve point
   *     whose id derives from it; a statement id is single use.
   *  What it cannot check: the entry's content (names, agreement keys), which devices verify among themselves, and
   *  ancestry through entries the relay never heard of (renames are not put here yet; see the design notes). */
  private async rosterPut(ws: WebSocket, a: Att, h: Record<string, unknown>): Promise<void> {
    const idf = this.idOf(h);
    const refuse = (reason: string) => this.send(ws, { op: "refused", ...idf, reason });
    const seenRaw = h.seen;
    if ((h.kind !== "add" && h.kind !== "remove" && h.kind !== "rename") || !isHex(h.signer, DEVICE_HEX) || !isHex(h.target, DEVICE_HEX) || !isHex(h.entry, 64) || !isHex(h.sig, SIG_HEX) || !isCount(h.at)
      || !Array.isArray(seenRaw) || seenRaw.length < 1 || seenRaw.length > ROSTER_MAX_SEEN || !seenRaw.every((x) => isHex(x, 64)) || new Set(seenRaw).size !== seenRaw.length) return refuse("bad-header");
    const kind = h.kind, signer = h.signer, target = h.target, entry = h.entry, seen = seenRaw as string[];
    let targetKey: string | null = null;
    if (kind === "add") {
      // WHY a curve check and the id derivation (finding 13 and C2): a non-key would hold one of the 16 slots forever.
      if (!isHex(h.targetKey, KEY_HEX) || !(await isEd25519Point(h.targetKey)) || (await deviceIdFor(h.targetKey)) !== target) return refuse("bad-header");
      targetKey = h.targetKey;
    } else if (h.targetKey !== undefined && h.targetKey !== null) return refuse("bad-header");
    // WHY (review finding 1): a rename is an entry the app writes, so the relay must be able to follow it or every later statement from
    // a device that has renamed itself fails the ancestry walk. It changes nobody's membership, names its signer as its own target and
    // carries no name (the relay never learns names).
    if (kind === "rename" && target !== signer) return refuse("bad-header");

    const signerRow = this.q(`SELECT sign_key, removed FROM roster WHERE dev=?`, signer)[0];
    if (!signerRow) return refuse("not-a-member");
    // WHY only `remove` may continue from a removed signer (review 2, concurrent removal): the one case the app honours is MUTUAL removal (A removes B while
    // B removes A, neither citing the other's removal). Everything else from a removed signer stays refused, here, before any signature work.
    const signerWasRemoved = Number(signerRow.removed) === 1;
    if (signerWasRemoved && kind !== "remove") return refuse("signer-removed");
    const msg = rosterStatementMessage({ kind, room: a.room, signer, target, targetKey, entry, seen, at: h.at });
    if (!(await verifyEd25519(String(signerRow.sign_key), msg, h.sig))) return refuse("bad-signature");

    // ---- everything below runs without another await, so the checks and the writes see the same state ----
    const again = this.q(`SELECT removed FROM roster WHERE dev=?`, signer)[0];
    if (!again || (Number(again.removed) === 1) !== signerWasRemoved) return refuse("signer-removed");
    if (this.q(`SELECT 1 FROM rentries WHERE id=?`, entry)[0]) return refuse("duplicate");
    // WHY per-device limits here (review finding 4): a member could otherwise record unlimited cheap statements. Counted only for statements
    // already accepted; the check precedes every write. 512 in total and 30 in any rolling hour, by the relay's own clock (never the signed `at`).
    const nowMs = this.now();
    const tally = this.q(`SELECT count(*) n, coalesce(sum(t>?),0) h FROM rentries WHERE signer=? AND t>0`, nowMs - 3_600_000, signer)[0]!;
    if (Number(tally.n) >= ROSTER_MAX_PER_SIGNER) return refuse("too-many-entries");
    if (Number(tally.h) >= ROSTER_MAX_PER_SIGNER_HOUR) return refuse("roster-rate-limited");
    const first = Number(this.q(`SELECT count(*) n FROM rentries`)[0]!.n) === 0;
    if (first && signerWasRemoved) return refuse("signer-removed");
    if (first) {
      // WHY a fresh date on the first statement (review 15, idle-erase replay): after an idle erase the room is empty again, and the first
      // statement is accepted on the strength of its signature alone. Without a date check an operator could replay an old captured one.
      // A day either way tolerates any honest clock; the creator's own statement is made moments after it connected.
      if (Math.abs(h.at - nowMs) > FIRST_STATEMENT_SKEW_MS) return refuse("stale-statement");
      // The room's first statement: the only member is the creator, and it names its own genesis entry (which the relay
      // never saw) as its sole ancestry. That id is recorded as the creator's introduction.
      if (this.activeDevices().length !== 1 || this.activeDevices()[0] !== signer || seen.length !== 1) return refuse("bad-ancestry");
      this.q(`INSERT INTO rentries(id,signer,kind,target,t) VALUES(?,?,?,?,0)`, seen[0], signer, "add", signer);
      this.q(`INSERT INTO rintro(dev,entry) VALUES(?,?)`, signer, seen[0]);
    } else {
      const intro = this.q(`SELECT entry FROM rintro WHERE dev=?`, signer)[0];
      if (!intro) return refuse("bad-ancestry");
      const visited = this.ancestry(seen);
      if (!visited.has(String(intro.entry))) return refuse("bad-ancestry");
      if (!signerWasRemoved) {
        for (const r of this.q(`SELECT id FROM rentries WHERE kind='remove' AND target=?`, signer)) if (visited.has(String(r.id))) return refuse("signer-knew-removal");
      } else {
        // Mutual removal: (a) the statement does not cite (directly or through entries the relay knows) the removal that removed its signer, and
        // (b) its target is the device that signed that removal. Anything else is the removed device acting on the set: refused.
        const removal = this.q(`SELECT id, signer FROM rentries WHERE kind='remove' AND target=? ORDER BY t DESC LIMIT 1`, signer)[0];
        if (!removal || visited.has(String(removal.id)) || String(removal.signer) !== target) return refuse("signer-removed");
      }
    }

    if (kind === "rename") {
      this.recordEntry(entry, signer, kind, target, seen);
      return this.send(ws, { op: "ok", ...idf });
    }
    if (kind === "add") {
      const existing = this.q(`SELECT removed FROM roster WHERE dev=?`, target)[0];
      if (existing) return refuse(Number(existing.removed) === 1 ? "banned" : "already-member");
      if (this.activeDevices().length >= MAX_DEVICES) return refuse("too-many-devices");
      // WHY (third review, finding 2, N7): ghosts. Charged to the VERIFIED SIGNER only (the signature was checked above), so one device's admissions
      // can never use up another's, and a set can never name more keys than MAX_KNOWN_KEYS in its lifetime (removed devices keep their ban row).
      const admitted = Number(this.q(`SELECT count(*) n FROM rentries WHERE signer=? AND kind='add' AND t>0`, signer)[0]!.n);
      if (admitted >= MAX_ADMISSIONS_PER_SIGNER) return refuse("too-many-admissions");
      if (this.rosterRowCount() >= MAX_KNOWN_KEYS) return refuse("too-many-keys");
      this.q(`INSERT INTO roster(dev,sign_key,added_at,removed) VALUES(?,?,?,0)`, target, targetKey, this.now());
      this.q(`INSERT INTO rintro(dev,entry) VALUES(?,?)`, target, entry);
      this.recordEntry(entry, signer, kind, target, seen);
      // The second device lifts the pre-pairing allowance to the full ceiling (T7 abuse protection 1).
      if (this.activeDevices().length >= 2) this.metaSet("paired", 1);
      this.broadcast({ op: "roster-changed", change: "added", dev: target }, { exceptDev: a.dev });
      return this.send(ws, { op: "ok", ...idf, dev: target } as object);
    }
    const row = this.q(`SELECT removed, added_at FROM roster WHERE dev=?`, target)[0];
    if (!row) return refuse("not-found");
    // Removing a device that is already removed changes nothing and succeeds (idempotent): the entry is still recorded so later statements can cite it.
    if (Number(row.removed) === 1) {
      this.recordEntry(entry, signer, kind, target, seen);
      return this.send(ws, { op: "ok", ...idf });
    }
    this.recordEntry(entry, signer, kind, target, seen);
    this.q(`UPDATE roster SET removed=1 WHERE dev=?`, target);
    // Its acknowledgements must not count for or against dropping frames any more.
    this.q(`DELETE FROM recv WHERE dev=?`, target);
    this.q(`DELETE FROM senders WHERE dev=?`, target);
    this.freeWriterFrames(target);
    // Close every connection it has, including the one that asked if it removed itself. WHY (review: "a removed device's
    // socket is closed and it cannot re-add itself"): its row is now removed=1, so its later statements die at "signer-removed".
    for (const { ws: w, a: wa } of this.authedSockets()) if (wa.dev === target) this.close(w, CLOSE_DEVICE_REMOVED, "device removed");
    this.broadcast({ op: "roster-changed", change: "removed", dev: target }, { exceptDev: target });
    if (target !== a.dev) this.send(ws, { op: "ok", ...idf });
    // An empty roster erases the set at once (design 5.6).
    if (this.activeDevices().length === 0) return await this.eraseAsync("emptied");
    // Removal can complete other devices' acknowledgement sets: re-run the drop rule for held groups.
    for (const g of this.q(`SELECT g FROM groups WHERE bytes>0`)) {
      const m = this.q(`SELECT count(*) n, min(through) m FROM recv WHERE g=? AND dev IN (SELECT dev FROM roster WHERE removed=0)`, g.g)[0]!;
      if (Number(m.n) >= this.activeDevices().length) this.dropReceived(String(g.g), Number(m.m));
    }
  }
  /** WHY (review 2, N6): a removed device's frames in every non-roster group are freed at once, so junk it wrote cannot outlive it. Its roster frames stay:
   *  they are the removal bundles and entries other devices still need. The groups keep their numbering (a hole in the sequence is harmless to a fetch). */
  private freeWriterFrames(dev: string): void {
    const rows = this.q(`SELECT g, coalesce(sum(sz),0) s FROM frames WHERE w=? AND g NOT IN (${CONTROL_GROUPS.map(() => "?").join(",")}) GROUP BY g`, dev, ...CONTROL_GROUPS);
    let freed = 0;
    for (const r of rows) {
      this.q(`DELETE FROM frames WHERE w=? AND g=?`, dev, r.g);
      this.q(`UPDATE groups SET bytes=MAX(0,bytes-?) WHERE g=?`, r.s, r.g);
      freed += Number(r.s);
    }
    if (freed) this.metaSet("total_bytes", Math.max(0, this.totalBytes() - freed));
  }
  private recordEntry(id: string, signer: string, kind: string, target: string, seen: string[]): void {
    this.q(`INSERT INTO rentries(id,signer,kind,target,t) VALUES(?,?,?,?,?)`, id, signer, kind, target, this.now());
    for (const s of seen) this.q(`INSERT OR IGNORE INTO rseen(id,sid) VALUES(?,?)`, id, s);
  }
  /** Every entry id reachable from `seen` through the statements the relay has accepted (bounded: a log is capped at 8192). */
  private ancestry(seen: string[]): Set<string> {
    const visited = new Set<string>();
    const stack = [...seen];
    while (stack.length && visited.size <= ANCESTRY_WALK_LIMIT) {
      const id = stack.pop() as string;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const r of this.q(`SELECT sid FROM rseen WHERE id=?`, id)) stack.push(String(r.sid));
    }
    return visited;
  }

  // ---------------------------------------------------------------- pairing meeting point (T5 C10, threat model P-3, P-9)
  // WHAT: a short-lived pipe between exactly two parties: the existing device (host) and the device being added (guest).
  // The relay learns nothing it needs: every message is opaque PAKE bytes or sealed. IT NEVER TOUCHES THE CODE: the meeting
  // id is SHA-256 of the typed code's random MEETING part, and the secret part is independent of it, so seeing the id gives
  // the relay no way to test guesses of the secret offline (the only test is online, against the host, 3 tries per code).
  // WHO MAY OPEN ONE: only an authenticated member of a room the relay admits (so in allowlist mode, only an allow-listed
  // room), through `meet-open` on that room's socket. A brand-new device that is in no room needs no permission: it can only
  // JOIN a meeting that already exists, and joining creates nothing.
  // WHERE IT LIVES: a Durable Object of this same class named "meet:<id>" (no new binding), erased on close or expiry.
  private async meetOpen(ws: WebSocket, a: Att, h: Record<string, unknown>): Promise<void> {
    const idf = this.idOf(h);
    if (!isHex(h.m, MEET_HEX)) return void this.send(ws, { op: "refused", ...idf, reason: "bad-header" });
    if (!this.env.MESH_RELAY) return void this.send(ws, { op: "refused", ...idf, reason: "unavailable" });
    const now = this.now();
    // Fail closed on limits: the counts are read before anything is created.
    this.q(`DELETE FROM meets WHERE created<?`, now - 3_600_000);
    // WHY per opening device first (review finding 12, M4): a member who used the room's whole allowance locked the owner out of pairing.
    // Each device has its own open-at-once and per-hour share; the room totals are only a backstop sized so no device's share is crowded out.
    const open = (opener: string | null) => Number(this.q(`SELECT count(*) n FROM meets WHERE expires>?${opener === null ? "" : " AND opener=?"}`, ...(opener === null ? [now] : [now, opener]))[0]!.n);
    const hour = (opener: string | null) => Number(this.q(`SELECT count(*) n FROM meets${opener === null ? "" : " WHERE opener=?"}`, ...(opener === null ? [] : [opener]))[0]!.n);
    if (open(a.dev) >= MEET_MAX_OPEN_PER_DEVICE || open(null) >= MEET_MAX_OPEN_PER_ROOM) return void this.send(ws, { op: "refused", ...idf, reason: "too-many-meetings" });
    if (hour(a.dev) >= MEET_OPENS_PER_DEVICE_HOUR || hour(null) >= MEET_OPENS_PER_ROOM_HOUR) return void this.send(ws, { op: "refused", ...idf, reason: "rate-limited" });
    if (this.q(`SELECT 1 FROM meets WHERE m=?`, h.m)[0]) return void this.send(ws, { op: "refused", ...idf, reason: "meeting-exists" });
    // Reserve the slot BEFORE the await, so two quick opens cannot both pass the count.
    this.q(`INSERT INTO meets(m,created,expires,opener) VALUES(?,?,?,?)`, h.m, now, now + MEET_LIFETIME_MS, a.dev);
    let ticket: string | null = null;
    try {
      // The meeting remembers which room opened it, so it can tell that room when it ends (its concurrency slot is then freed).
      const res = await this.env.MESH_RELAY.get(this.env.MESH_RELAY.idFromName(`meet:${h.m}`)).fetch(new Request("https://mesh-relay.internal/meet-create", { headers: { "X-Mesh-Kind": "meet-create", "X-Mesh-Room": a.room, "X-Mesh-Meet": h.m } }));
      if (res.ok) ticket = String(((await res.json()) as { ticket?: string }).ticket ?? "") || null;
    } catch { ticket = null; }
    if (!ticket) { this.q(`DELETE FROM meets WHERE m=?`, h.m); return void this.send(ws, { op: "refused", ...idf, reason: "meeting-exists" }); }
    this.send(ws, { op: "meet-opened", ...idf, m: h.m, ticket, ttlMs: MEET_LIFETIME_MS });
  }
  /** Answered to the front door in allowlist mode: "did one of YOUR members open this meeting, and is it still live?" */
  private meetCheck(m: string): Response {
    this.ensureInit();
    const live = isHex(m, MEET_HEX) && !!this.q(`SELECT 1 FROM meets WHERE m=? AND expires>?`, m, this.now())[0];
    return new Response(null, { status: live ? 200 : 404 });
  }
  /** A meeting this room opened has ended: it stops counting as open (the hourly count keeps it, so ending early cannot reset the allowance). */
  private meetGone(m: string): Response {
    this.ensureInit();
    if (isHex(m, MEET_HEX)) this.q(`UPDATE meets SET expires=MIN(expires,?) WHERE m=?`, this.now(), m);
    return new Response(null, { status: 204 });
  }
  /** Meeting object: created exactly once, by the room that opened it. A second create (squatting on an id) is refused. */
  private async meetCreate(request: Request): Promise<Response> {
    this.ensureInit();
    if (this.metaNum("meet_created", 0) !== 0) return new Response("exists", { status: 409 });
    const now = this.now();
    const ticket = randomHex(16);
    this.metaSet("meet_created", now);
    this.metaSet("meet_ticket", ticket);
    const opener = request.headers.get("X-Mesh-Room");
    const mid = request.headers.get("X-Mesh-Meet");
    if (isHex(opener, ROOM_HEX) && isHex(mid, MEET_HEX)) { this.metaSet("meet_room", opener); this.metaSet("meet_id", mid); }
    await this.state.storage.setAlarm(now + MEET_LIFETIME_MS);
    return Response.json({ ticket });
  }
  private meetOpenSockets(role?: "host" | "guest"): Array<{ ws: WebSocket; a: Att }> {
    const out: Array<{ ws: WebSocket; a: Att }> = [];
    for (const ws of this.state.getWebSockets()) {
      if (ws.readyState !== WebSocket.READY_STATE_OPEN) continue;
      const a = this.att(ws);
      if (a?.meet === true && (!role || a.role === role)) out.push({ ws, a });
    }
    return out;
  }
  /** A socket to the meeting. Nothing is stored for an id that was never opened (and the object wipes itself again). */
  private async meetConnect(): Promise<Response> {
    this.ensureInit();
    const created = this.metaNum("meet_created", 0);
    const now = this.now();
    if (!created) { await this.wipeEmpty(); return new Response("not found", { status: 404 }); }
    if (now - created >= MEET_LIFETIME_MS) { await this.meetEnd("expired"); return new Response("not found", { status: 404 }); }
    if (this.meetOpenSockets().length >= MEET_MAX_SOCKETS) return new Response("meeting busy", { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.state.acceptWebSocket(server);
    server.serializeAttachment({ authed: false, dev: "", room: "", aud: "", nonce: null, issuedAt: now, ip: "", lastBeat: 0, meet: true, role: "", lastN: 0, at: now } satisfies Att);
    await this.armAt(now + MEET_JOIN_DEADLINE_MS);
    return new Response(null, { status: 101, webSocket: client });
  }
  private async meetMessage(ws: WebSocket, message: ArrayBuffer): Promise<void> {
    if (!this.tablesReady) return this.close(ws, CLOSE_MEET_ENDED, "meeting over");
    // Header cap + payload cap; anything bigger is closed before it is parsed.
    // WHY by role (review finding 11): the host's welcome carries the whole signed roster log and may be large; a guest (a stranger until
    // the exchange completes) and a socket that has not joined yet stay at the small cap, so widening the pipe widens it only for the member.
    const maxPayload = this.att(ws)?.role === "host" ? MEET_MAX_HOST_MESSAGE_BYTES : MEET_MAX_MESSAGE_BYTES;
    if (message.byteLength > 4 + MAX_HEADER_BYTES_MEET + maxPayload) return this.close(ws, CLOSE_TOO_LARGE, "message too large");
    if (this.flood(ws, this.recent, MEET_RATE_MAX_MESSAGES)) return this.close(ws, CLOSE_TOO_FAST, "too many messages");
    const m = unpackMessage(message);
    if (!m.ok) return this.close(ws, CLOSE_BAD_MESSAGE, "malformed message");
    const a = this.att(ws) as Att;
    const h = m.header;
    const created = this.metaNum("meet_created", 0);
    if (!created || this.now() - created >= MEET_LIFETIME_MS) return await this.meetEnd("expired");
    if (m.op === "meet-join") return this.meetJoin(ws, a, h);
    if (a.role !== "host" && a.role !== "guest") return this.close(ws, CLOSE_NOT_AUTHED, "join first");
    if (m.op === "meet-close") return await this.meetEnd("closed");
    if (m.op !== "meet-relay") return this.close(ws, CLOSE_BAD_MESSAGE, "unknown message");
    // Strictly rising numbers per socket: a repeated or older number is a replay or a retry and is dropped, not forwarded.
    if (!isCount(h.n) || h.n < 1) return this.close(ws, CLOSE_BAD_MESSAGE, "bad number");
    if (h.n <= (a.lastN ?? 0)) return void this.send(ws, { op: "refused", ...this.idOf(h), reason: "replay" });
    if (m.payload.byteLength === 0 || m.payload.byteLength > maxPayload) return this.close(ws, CLOSE_TOO_LARGE, "message too large");
    const bytes = this.metaNum("meet_bytes", 0) + m.payload.byteLength;
    const msgs = this.metaNum("meet_msgs", 0) + 1;
    // The whole meeting is tiny (threat model P-9): past the total the meeting simply ends and is erased.
    if (bytes > MEET_MAX_TOTAL_BYTES || msgs > MEET_MAX_MESSAGES) return await this.meetEnd("limit");
    const peer = this.meetOpenSockets(a.role === "host" ? "guest" : "host")[0];
    if (!peer) return void this.send(ws, { op: "refused", ...this.idOf(h), reason: "peer-absent" });
    this.metaSet("meet_bytes", bytes);
    this.metaSet("meet_msgs", msgs);
    // WHY counted here (review finding 12, M5): a guest connection uses up one of the meeting's few guest allowances only once it has said
    // something. Counting at join let someone who knew only the meeting id burn all of them with silent connections.
    if (a.role === "guest" && a.sent !== true) this.metaSet("meet_guests", this.metaNum("meet_guests", 0) + 1);
    ws.serializeAttachment({ ...a, lastN: h.n, sent: true } satisfies Att);
    // `gen` ties every message to one guest connection, so the host never mixes two strangers' exchanges.
    this.send(peer.ws, { op: "meet-relay", from: a.role, gen: a.role === "guest" ? (a.gen ?? 0) : (peer.a.gen ?? 0), n: h.n }, m.payload);
  }
  private meetJoin(ws: WebSocket, a: Att, h: Record<string, unknown>): void {
    const idf = this.idOf(h);
    if (a.role === "host" || a.role === "guest") return this.close(ws, CLOSE_BAD_MESSAGE, "already joined");
    const refuse = (reason: string) => { this.send(ws, { op: "refused", ...idf, reason }); this.close(ws, CLOSE_MEET_REFUSED, reason); };
    const now = this.now();
    if (h.role === "host") {
      // The ticket is what opening returned to the member who opened the meeting; a guest never has it.
      const ticket = this.metaText("meet_ticket");
      if (typeof h.ticket !== "string" || !ticket || !constantTimeEqual(h.ticket, ticket)) return refuse("bad-ticket");
      if (this.meetOpenSockets("host").length > 0) return refuse("host-taken");
      ws.serializeAttachment({ ...a, role: "host", at: now } satisfies Att);
      return void this.send(ws, { op: "meet-joined", ...idf, role: "host", gen: 0, peer: this.meetOpenSockets("guest").length > 0 });
    }
    if (h.role !== "guest") return refuse("bad-role");
    // Exactly two parties: one guest at a time. A second guest while one holds the slot is refused, not queued, EXCEPT that a guest who has
    // said nothing for a short while (UNAUTH_MIN_AGE_MS) gives way to a newcomer: a stranger who knows only the id could otherwise keep the
    // slot occupied and shut the honest guest out. A guest that has already sent a message is never displaced.
    for (const g of this.meetOpenSockets("guest")) {
      if (g.a.sent === true || now - (g.a.at ?? g.a.issuedAt) < UNAUTH_MIN_AGE_MS) return refuse("busy");
    }
    if (this.metaNum("meet_guests", 0) >= MEET_MAX_GUEST_CONNECTS) return refuse("full");
    for (const g of this.meetOpenSockets("guest")) {
      const host = this.meetOpenSockets("host")[0];
      if (host) this.send(host.ws, { op: "meet-peer", state: "off", gen: g.a.gen ?? 0 });
      this.close(g.ws, CLOSE_MEET_REFUSED, "replaced by a newer guest");
    }
    // `gen` numbers every guest connection (counted or not) so the host never mixes two connections' exchanges.
    const gen = this.metaNum("meet_gen", 0) + 1;
    this.metaSet("meet_gen", gen);
    ws.serializeAttachment({ ...a, role: "guest", gen, at: now, sent: false } satisfies Att);
    const hostUp = this.meetOpenSockets("host")[0];
    this.send(ws, { op: "meet-joined", ...idf, role: "guest", gen, peer: !!hostUp });
    if (hostUp) this.send(hostUp.ws, { op: "meet-peer", state: "on", gen });
  }
  private async meetSocketGone(a: Att): Promise<void> {
    if (!this.tablesReady) return;
    if (a.role === "host") return await this.meetEnd("host-left"); // nobody to pair with and nothing worth keeping
    if (a.role === "guest") { const host = this.meetOpenSockets("host")[0]; if (host) this.send(host.ws, { op: "meet-peer", state: "off", gen: a.gen ?? 0 }); }
  }
  /** Close every socket, say why, and erase everything: after this the object holds nothing. */
  private async meetEnd(why: string): Promise<void> {
    if (!this.tablesReady) return;
    const opener = this.metaText("meet_room");
    const mid = this.metaText("meet_id");
    if (opener && mid && this.env.MESH_RELAY) {
      try { await this.env.MESH_RELAY.get(this.env.MESH_RELAY.idFromName(opener)).fetch(new Request("https://mesh-relay.internal/meet-gone", { headers: { "X-Mesh-Kind": "meet-gone", "X-Mesh-Meet": mid } })); } catch { /* the room's own expiry still frees the slot */ }
    }
    for (const ws of this.state.getWebSockets()) {
      if (this.att(ws)?.meet !== true) continue;
      this.send(ws, { op: "meet-ended", why });
      this.close(ws, CLOSE_MEET_ENDED, why);
    }
    await this.wipeEmpty();
    meshLog("meet-ended", null);
  }
  /** Storage and alarm gone, tables rebuilt only if something asks again (ensureInit). */
  private async wipeEmpty(): Promise<void> {
    await this.state.storage.deleteAll();
    await this.state.storage.deleteAlarm();
    this.tablesReady = false;
  }
  private async meetAlarm(created: number): Promise<void> {
    const now = this.now();
    if (now - created >= MEET_LIFETIME_MS) return await this.meetEnd("expired");
    let next = created + MEET_LIFETIME_MS;
    for (const { ws, a } of this.meetOpenSockets()) {
      // A socket that has not said who it is, or a guest that holds the slot without ever sending, is let go.
      const pending = a.role === "" || (a.role === "guest" && a.sent !== true);
      if (!pending) continue;
      const due = (a.role === "" ? a.issuedAt : (a.at ?? a.issuedAt)) + MEET_JOIN_DEADLINE_MS;
      if (now >= due) this.close(ws, CLOSE_MEET_REFUSED, "no message in time"); else next = Math.min(next, due);
    }
    await this.state.storage.setAlarm(Math.max(now + 250, next));
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
    // A meeting object has its own, short life and no roster; it must never reach the room rules below.
    const meetCreated = this.metaNum("meet_created", 0);
    if (meetCreated > 0) return await this.meetAlarm(meetCreated);
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
    for (const o of this.q(`SELECT g FROM groups WHERE bytes>0 AND has_line=1 AND last_line_at<?`, now - GROUP_TTL_MS)) {
      const through = this.emptyGroup(String(o.g));
      this.broadcast({ op: "released", g: String(o.g), throughSeq: through });
    }
    // WHY (review 2, dead member): control frames wait for EVERY roster device to acknowledge, so a device that is on the roster but dead would pin them
    // forever. Frames in non-line groups (the roster group included) are released CONTROL_FRAME_TTL_MS after they were written. Frames of a group are
    // numbered in time order, so the expired ones are a prefix: everything up to the newest expired frame goes, and `released_through` moves up to it. A
    // device that comes back after that and asks from a lower position gets `gap` (see fetchAfter), which the app treats as "ask for everything again".
    for (const o of this.q(`SELECT f.g g, max(f.seq) s FROM frames f JOIN groups gr ON gr.g=f.g WHERE gr.has_line=0 AND f.t<? GROUP BY f.g`, now - CONTROL_FRAME_TTL_MS)) {
      const sz = Number(this.q(`SELECT coalesce(sum(sz),0) z FROM frames WHERE g=? AND seq<=?`, o.g, o.s)[0]!.z);
      this.q(`DELETE FROM frames WHERE g=? AND seq<=?`, o.g, o.s);
      this.q(`UPDATE groups SET bytes=MAX(0,bytes-?), released_through=MAX(released_through,?) WHERE g=?`, sz, o.s, o.g);
      this.metaSet("total_bytes", Math.max(0, this.totalBytes() - sz));
      this.broadcast({ op: "released", g: String(o.g), throughSeq: Number(o.s) });
    }
    const oldestControl = this.q(`SELECT min(f.t) m FROM frames f JOIN groups gr ON gr.g=f.g WHERE gr.has_line=0`)[0]!.m;
    // Next wake: the oldest remaining group's expiry, an unauthenticated deadline, or the 90-day idle check, whichever is sooner.
    const oldest = this.q(`SELECT min(last_line_at) m FROM groups WHERE bytes>0 AND has_line=1`)[0]!.m;
    const idleAt = this.metaNum("last_connect", now) + SET_IDLE_ERASE_MS;
    const next = Math.min(oldest === null ? Infinity : Number(oldest) + GROUP_TTL_MS, oldestControl === null ? Infinity : Number(oldestControl) + CONTROL_FRAME_TTL_MS + 1, idleAt, nextUnauth ?? Infinity);
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

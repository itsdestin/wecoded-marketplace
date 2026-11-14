import { env, runInDurableObject, listDurableObjectIds } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { Conn, HOST, bytesOf, holdHeader, makeSet, newDevice, sign, inRoom, stubFor } from "./mesh-helpers";
import { relayAuthMessage, bytesToHex } from "../src/mesh/auth";
import { MAX_FRAME_BYTES, MESH_PROTOCOL_VERSION } from "../src/mesh/protocol";
import type { MeshRelayRoom } from "../src/mesh/relay-room";

// The Mesh relay (src/mesh/relay-room.ts): protocol behaviour. Hostile clients, flooding and fuzzing are in
// mesh-relay-hostile.test.ts; hibernation and lifetimes in mesh-relay-lifetime.test.ts; the off switch in
// mesh-relay-gate.test.ts.

/** Run code against the live room object (limits and the clock are instance fields, replaceable by tests). */

describe("auth challenge pinned to the app's canonical encoding (T5 C5, C9)", () => {
  it("the signed message equals the bytes T5's reference encoder produces", () => {
    // Produced by docs/active/prototypes/2026-11-14-mesh-phase0/T5/cbor.mjs: encode({aud,room,nonce,dev}) after the
    // "youcoded-mesh/v1/relay-auth\0" prefix, with room/nonce = 32 bytes of 0x11/0x22 and dev = 16 bytes of 0x33.
    const expected = "796f75636f6465642d6d6573682f76312f72656c61792d6175746800a4636175646a746573742e6c6f63616c63646576503333333333333333333333333333333364726f6f6d58201111111111111111111111111111111111111111111111111111111111111111656e6f6e636558202222222222222222222222222222222222222222222222222222222222222222";
    const msg = relayAuthMessage("test.local", "11".repeat(32), "22".repeat(32), "33".repeat(16));
    expect(bytesToHex(msg)).toBe(expected);
  });
});

describe("connect and membership challenge", () => {
  it("sends a challenge naming the host the device dialled, with a fresh 32-byte nonce", async () => {
    const d = await newDevice();
    const a = await Conn.open(d.room);
    const b = await Conn.open(d.room);
    const ca = await a.waitFor("challenge"), cb = await b.waitFor("challenge");
    expect(ca.h.aud).toBe(HOST);
    expect(ca.h.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(ca.h.nonce).not.toBe(cb.h.nonce);
    expect(ca.h.v).toBe(MESH_PROTOCOL_VERSION);
  });

  it("the first device creates the set by proving the key that names the room", async () => {
    const d = await newDevice("laptop");
    const c = await Conn.open(d.room);
    const r = await c.auth(d, { firstDevice: true });
    expect(r.h).toMatchObject({ op: "auth-result", r: "ok", created: true });
    expect(r.h.devices).toEqual([d.dev]);
    expect(r.h.usage).toMatchObject({ bytes: 0, paired: false, fill: "ok" });
  });

  it("a later device already on the roster signs in without sending a key", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    conns[1]!.ws.close(1000, "bye");
    const again = await Conn.open(room);
    const r = await again.auth(devices[1]!);
    expect(r.h).toMatchObject({ r: "ok", created: false });
  });

  it("refuses a device that is not on the roster", async () => {
    const { room } = await makeSet(["a"]);
    const stranger = await newDevice("stranger");
    const c = await Conn.open(room);
    const r = await c.auth(stranger, { firstDevice: true });
    expect(r.h.r).toBe("not-on-roster");
    expect((await c.waitClosed()).code).toBe(4002);
  });

  it("refuses a bad signature", async () => {
    const { room, devices } = await makeSet(["a"]);
    const c = await Conn.open(room);
    const r = await c.auth(devices[0]!, { corruptSig: true });
    expect(r.h.r).toBe("bad-signature");
    expect((await c.waitClosed()).code).toBe(4002);
  });

  it("refuses an answer that names a different room than the one it connected to", async () => {
    const { room, devices } = await makeSet(["a"]);
    const c = await Conn.open(room);
    const r = await c.auth(devices[0]!, { room: "ab".repeat(32) });
    expect(r.h.r).toBe("bad-signature");
  });

  it("refuses an answer signed for another relay host", async () => {
    const { room, devices } = await makeSet(["a"]);
    const c = await Conn.open(room);
    const r = await c.auth(devices[0]!, { aud: "evil.example" });
    expect(r.h.r).toBe("bad-signature");
  });

  it("refuses the first-device claim when the room is not the hash of the key presented", async () => {
    const attacker = await newDevice("attacker");
    const victimRoom = (await newDevice("victim")).room;
    const c = await Conn.open(victimRoom);
    const r = await c.auth(attacker, { firstDevice: true });
    expect(r.h.r).toBe("not-on-roster");
  });

  it("a challenge answer captured on one connection is useless on another (single-use, per-connection nonce)", async () => {
    const { room, devices } = await makeSet(["a"]);
    const c1 = await Conn.open(room);
    const ch1 = await c1.waitFor("challenge");
    const sig = await sign(devices[0]!, relayAuthMessage(ch1.h.aud, room, ch1.h.nonce, devices[0]!.dev));
    c1.send({ op: "auth", v: 1, dev: devices[0]!.dev, sig });
    expect((await c1.waitFor("auth-result")).h.r).toBe("ok");
    const c2 = await Conn.open(room);
    await c2.waitFor("challenge");
    c2.send({ op: "auth", v: 1, dev: devices[0]!.dev, sig }); // the captured answer
    expect((await c2.waitFor("auth-result")).h.r).toBe("bad-signature");
  });

  it("refuses a correctly signed answer that arrives after the 30-second window", async () => {
    const { room, devices } = await makeSet(["a"]);
    const c = await Conn.open(room);
    const ch = await c.waitFor("challenge");
    const sig = await sign(devices[0]!, relayAuthMessage(ch.h.aud, room, ch.h.nonce, devices[0]!.dev));
    await inRoom(room, (r) => { const t = Date.now(); r.now = () => t + 31_000; });
    c.send({ op: "auth", v: 1, dev: devices[0]!.dev, sig });
    expect((await c.waitFor("auth-result")).h.r).toBe("stale-challenge");
    expect((await c.waitClosed()).code).toBe(4002);
  });

  it("closes a connection that sends anything before authenticating", async () => {
    const { room } = await makeSet(["a"]);
    const c = await Conn.open(room);
    await c.waitFor("challenge");
    c.send({ op: "usage" });
    expect((await c.waitClosed()).code).toBe(4001);
  });

  it("refuses an auth message after the connection is already authenticated", async () => {
    const { conns, devices } = await makeSet(["a"]);
    conns[0]!.send({ op: "auth", v: 1, dev: devices[0]!.dev, sig: "00".repeat(64) });
    expect((await conns[0]!.waitClosed()).code).toBe(4006);
  });
});

describe("protocol version refusal (close code 4005, the fill-protocol precedent)", () => {
  for (const q of ["", "?v=0", "?v=2", "?v=abc", "?v=-1"]) {
    it(`closes with 4005 and creates no room object for ${q || "no version"}`, async () => {
      const d = await newDevice();
      // WHY a before/after count: the id list survives the per-test reset, so compare against what was there.
      const before = (await listDurableObjectIds(env.MESH_RELAY)).length;
      const c = await Conn.open(d.room, { query: q });
      const info = await c.waitClosed();
      expect(info.code).toBe(4005);
      expect(info.reason).toMatch(/Update YouCoded/);
      expect(await listDurableObjectIds(env.MESH_RELAY)).toHaveLength(before);
    });
  }
  it("a client that claims a bad version inside auth is refused with 4005 too", async () => {
    const d = await newDevice();
    const c = await Conn.open(d.room);
    const r = await c.auth(d, { firstDevice: true, v: 99 });
    expect(r.h).toMatchObject({ op: "version-refused", min: 1, max: 1 });
    expect((await c.waitClosed()).code).toBe(4005);
  });
});

describe("three devices: live pass-through, held frames, catch-up, acknowledgements", () => {
  it("passes live frames to the others only, stamps the real sender, and holds nothing for them", async () => {
    const { devices, conns } = await makeSet(["laptop", "phone", "tablet"]);
    const [a, b, c] = conns as [Conn, Conn, Conn];
    a.send({ op: "pass", g: "live", to: "all" }, new TextEncoder().encode("hello"));
    const mb = await b.waitFor("pass"), mc = await c.waitFor("pass");
    expect(mb.h.from).toBe(devices[0]!.dev);
    expect(new TextDecoder().decode(mc.payload)).toBe("hello");
    // targeted
    b.send({ op: "pass", g: "live", to: devices[2]!.dev }, new Uint8Array([1, 2, 3]));
    expect((await c.waitFor("pass")).payload).toEqual(new Uint8Array([1, 2, 3]));
    expect((await a.call({ op: "usage" })).h.usage.bytes).toBe(0);
  });

  it("holds frames with growing sequence numbers; devices catch up; frames go once everyone has them", async () => {
    const { room, devices, conns } = await makeSet(["laptop", "phone", "tablet"]);
    const [a, b, c] = conns as [Conn, Conn, Conn];
    c.ws.close(1000, "offline"); // the tablet is away
    await c.waitClosed();
    const bodies = [bytesOf(1000), bytesOf(2000), bytesOf(3000)];
    for (let i = 0; i < 3; i++) {
      const r = await a.call(holdHeader(devices[0]!, "chat:1", i + 1, undefined, { line: true }) as any, bodies[i]!);
      expect(r.h).toMatchObject({ op: "stored", g: "chat:1", seq: i + 1, fill: "ok" });
    }
    // phone catches up
    const idb = "fb";
    b.send({ op: "fetch-after", g: "chat:1", seq: 0, id: idb });
    const got = await b.frames(idb);
    expect(got.filter((m) => m.h.op === "frame").map((m) => m.h.seq)).toEqual([1, 2, 3]);
    expect(got[1]!.payload).toEqual(bodies[1]);
    expect(got[got.length - 1]!.h).toMatchObject({ op: "frames-end", more: false, last: 3 });
    // partial acks do not drop anything
    await a.call({ op: "received", g: "chat:1", through: 3 });
    await b.call({ op: "received", g: "chat:1", through: 3 });
    expect((await a.call({ op: "usage" })).h.usage.bytes).toBe(6000);
    // tablet comes back, fetches from its own point, acknowledges: now everyone has it, so it is deleted
    const c2 = await Conn.open(room);
    expect((await c2.auth(devices[2]!)).h.r).toBe("ok");
    c2.send({ op: "fetch-after", g: "chat:1", seq: 1, id: "fc" });
    const gotC = await c2.frames("fc");
    expect(gotC.filter((m) => m.h.op === "frame").map((m) => m.h.seq)).toEqual([2, 3]);
    await c2.call({ op: "received", g: "chat:1", through: 3 });
    expect((await a.call({ op: "usage" })).h.usage.bytes).toBe(0);
    c2.send({ op: "fetch-after", g: "chat:1", seq: 0, id: "fd" });
    expect((await c2.frames("fd")).map((m) => m.h.op)).toEqual(["frames-end"]);
  });

  it("pages large catch-ups: at most 4 MiB of frames per reply, then `more`", async () => {
    const { devices, conns } = await makeSet(["a", "b"]);
    const [a, b] = conns as [Conn, Conn];
    for (let i = 1; i <= 6; i++) await a.call(holdHeader(devices[0]!, "chat:big", i) as any, bytesOf(1 << 20));
    b.send({ op: "fetch-after", g: "chat:big", seq: 0, id: "p1" });
    const p1 = await b.frames("p1", 8000);
    const end1 = p1[p1.length - 1]!.h;
    expect(p1.filter((m) => m.h.op === "frame")).toHaveLength(4);
    expect(end1).toMatchObject({ more: true, last: 4 });
    b.send({ op: "fetch-after", g: "chat:big", seq: end1.last, id: "p2" });
    const p2 = await b.frames("p2", 8000);
    expect(p2.filter((m) => m.h.op === "frame").map((m) => m.h.seq)).toEqual([5, 6]);
    expect(p2[p2.length - 1]!.h.more).toBe(false);
  });

  it("an acknowledgement cannot reach beyond what exists", async () => {
    const { devices, conns } = await makeSet(["a", "b"]);
    await conns[0]!.call(holdHeader(devices[0]!, "g1", 1) as any, bytesOf(10));
    expect((await conns[1]!.call({ op: "received", g: "g1", through: 5 })).h).toMatchObject({ op: "refused", reason: "through-beyond-head" });
    expect((await conns[1]!.call({ op: "received", g: "nope", through: 0 })).h.reason).toBe("unknown-group");
  });

  it("tells the others when a device comes and goes", async () => {
    const { devices, conns } = await makeSet(["a", "b"]);
    const [a, b] = conns as [Conn, Conn];
    b.ws.close(1000, "bye");
    const off = await a.waitFor((m) => m.h.op === "presence-change" && m.h.state === "off");
    expect(off.h.device).toBe(devices[1]!.dev);
    expect((await a.call({ op: "presence" })).h.devices).toEqual([devices[0]!.dev]);
  });
});

describe("numbered beats", () => {
  it("forwards a beat to the others, never to the sender, and drops repeats and older numbers", async () => {
    const { devices, conns } = await makeSet(["a", "b"]);
    const [a, b] = conns as [Conn, Conn];
    a.send({ op: "beat", n: 1 });
    a.send({ op: "beat", n: 1 });   // duplicate
    a.send({ op: "beat", n: 3 });
    a.send({ op: "beat", n: 2 });   // older than 3
    a.send({ op: "beat", n: 4 });
    await b.waitFor((m) => m.h.op === "beat" && m.h.n === 4);
    const beats = b.inbox.filter((m) => m.h.op === "beat").map((m) => m.h.n);
    expect(beats).toEqual([1, 3]); // 4 was consumed by the wait above
    expect(a.inbox.some((m) => m.h.op === "beat")).toBe(false);
    expect(b.inbox.find((m) => m.h.op === "beat")!.h.from).toBe(devices[0]!.dev);
  });
  it("refuses a beat with a bad number", async () => {
    const { conns } = await makeSet(["a"]);
    for (const n of [0, -1, 1.5, "x", null]) {
      expect((await conns[0]!.call({ op: "beat", n } as any)).h.reason).toBe("bad-header");
    }
  });
});

describe("storage accounting and ceilings", () => {
  it("rejects a frame over 1 MiB and accepts exactly 1 MiB", async () => {
    const { devices, conns } = await makeSet(["a", "b"]);
    const a = conns[0]!;
    expect((await a.call(holdHeader(devices[0]!, "g", 1) as any, bytesOf(MAX_FRAME_BYTES + 1))).h).toMatchObject({ op: "over-limit", why: "frame" });
    expect((await a.call(holdHeader(devices[0]!, "g", 1) as any, bytesOf(MAX_FRAME_BYTES))).h.op).toBe("stored");
    expect((await a.call(holdHeader(devices[0]!, "g", 2) as any, new Uint8Array(0))).h).toMatchObject({ op: "refused", reason: "empty-frame" });
  });

  it("starts with the 100 MiB allowance and lifts to the full ceiling when a second device joins", async () => {
    const d = await newDevice();
    const a = await Conn.open(d.room);
    const first = await a.auth(d, { firstDevice: true });
    expect(first.h.usage).toMatchObject({ cap: 100 * 1024 * 1024, paired: false });
    const second = await newDevice();
    expect((await a.call({ op: "roster-add", signKey: second.signKey })).h.op).toBe("ok");
    const u = (await a.call({ op: "usage" })).h.usage;
    expect(u).toMatchObject({ cap: 900 * 1024 * 1024, paired: true });
  });

  it("reports nearly-full from 90 percent, refuses with `full` when nothing can be released", async () => {
    const d = await newDevice();
    const a = await Conn.open(d.room);
    await a.auth(d, { firstDevice: true });
    await inRoom(d.room, (r) => { r.limits.prePairCap = 10_000; });
    const fills: string[] = [];
    for (let i = 1; i <= 4; i++) fills.push((await a.call(holdHeader(d, "only", i) as any, bytesOf(2_300))).h.fill);
    // 2300, 4600, 6900 are ok; 9200 is 92 percent of 10_000
    expect(fills).toEqual(["ok", "ok", "ok", "nearly-full"]);
    // one group cannot exceed the ceiling on its own: refused, and the response says how full the set is
    expect((await a.call(holdHeader(d, "only", 5) as any, bytesOf(2_300))).h).toMatchObject({ op: "over-limit", why: "group", fill: "nearly-full" });
  });

  it("releases whole groups, least recently used first, never the one being written, and announces it", async () => {
    const d = await newDevice();
    const a = await Conn.open(d.room);
    await a.auth(d, { firstDevice: true });
    await inRoom(d.room, (r) => { r.limits.prePairCap = 10_000; });
    await a.call(holdHeader(d, "old", 1) as any, bytesOf(4_000));
    await a.call(holdHeader(d, "mid", 2) as any, bytesOf(4_000));
    await a.call(holdHeader(d, "old", 3) as any, bytesOf(1_000)); // touches "old" again: "mid" is now least recently used
    const r = await a.call(holdHeader(d, "new", 4) as any, bytesOf(3_000));
    expect(r.h.op).toBe("stored");
    const rel = await a.waitFor("released");
    expect(rel.h).toMatchObject({ g: "mid", throughSeq: 1 });
    // a device asking for the released stretch gets the gap; the surviving chat is intact
    a.send({ op: "fetch-after", g: "mid", seq: 0, id: "m" });
    expect((await a.frames("m"))[0]!.h).toMatchObject({ op: "gap", through: 1 });
    a.send({ op: "fetch-after", g: "old", seq: 0, id: "o" });
    expect((await a.frames("o")).filter((m) => m.h.op === "frame")).toHaveLength(2);
    // new lines for the released chat are accepted and numbered after the mark
    const again = await a.call(holdHeader(d, "mid", 5) as any, bytesOf(100));
    expect(again.h).toMatchObject({ op: "stored", seq: 2 });
  });

  it("releases the writer's own groups before another device's (threat model Y-9)", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    const [a, b] = conns as [Conn, Conn];
    await inRoom(room, (r) => { r.limits.setCap = 10_000; });
    await b.call(holdHeader(devices[1]!, "b-chat", 1) as any, bytesOf(3_000));   // older, written by b
    await a.call(holdHeader(devices[0]!, "a-chat", 1) as any, bytesOf(3_000));   // newer, written by a
    await a.call(holdHeader(devices[0]!, "a-new", 2) as any, bytesOf(6_000));    // needs room: a's own chat goes first
    const rel = await b.waitFor("released");
    expect(rel.h.g).toBe("a-chat");
    b.send({ op: "fetch-after", g: "b-chat", seq: 0, id: "x" });
    expect((await b.frames("x")).filter((m) => m.h.op === "frame")).toHaveLength(1);
  });

  it("defence in depth: refuses with `set` (fill: full) if the books ever say the set is full but nothing is releasable", async () => {
    const d = await newDevice();
    const a = await Conn.open(d.room);
    await a.auth(d, { firstDevice: true });
    await inRoom(d.room, (r) => { r.limits.prePairCap = 10_000; });
    // With consistent books this state cannot arise (a single group over the ceiling is a `group` refusal and
    // anything else is releasable), so force it the way a bookkeeping bug would, and check the relay still says no.
    await a.call(holdHeader(d, "g1", 1) as any, bytesOf(3_000));
    await inRoom(d.room, (r: any) => r.metaSet("total_bytes", 10_000));
    await inRoom(d.room, (r: any) => r.q(`UPDATE groups SET bytes=0, released_through=1`));
    const r = await a.call(holdHeader(d, "g2", 2) as any, bytesOf(500));
    expect(r.h).toMatchObject({ op: "over-limit", why: "set", fill: "full" });
  });

  it("limits the number of groups", async () => {
    const d = await newDevice();
    const a = await Conn.open(d.room);
    await a.auth(d, { firstDevice: true });
    await inRoom(d.room, (r) => { r.limits.maxGroups = 3; });
    for (let i = 1; i <= 3; i++) expect((await a.call(holdHeader(d, `g${i}`, i) as any, bytesOf(10))).h.op).toBe("stored");
    expect((await a.call(holdHeader(d, "g4", 4) as any, bytesOf(10))).h).toMatchObject({ op: "over-limit", why: "groups" });
  });

  it("drop-group empties a group at once and announces it", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    await conns[0]!.call(holdHeader(devices[0]!, "g1", 1) as any, bytesOf(500));
    expect((await conns[1]!.call({ op: "drop-group", g: "g1" })).h.op).toBe("ok");
    expect((await conns[0]!.waitFor("released")).h).toMatchObject({ g: "g1", throughSeq: 1 });
    expect((await conns[0]!.call({ op: "usage" })).h.usage.bytes).toBe(0);
    expect((await conns[0]!.call({ op: "drop-group", g: "missing" })).h.reason).toBe("unknown-group");
    void room;
  });
});

describe("per-address limit on creating sets", () => {
  it("refuses creation when the limiter says no, and uses the caller's address as the key", async () => {
    const d = await newDevice();
    const c = await Conn.open(d.room, { headers: { "CF-Connecting-IP": "203.0.113.9" } }); // creates the room object
    await c.waitFor("challenge");
    const keys: string[] = [];
    await inRoom(d.room, (r) => { r.createLimiter = { limit: async (o) => { keys.push(o.key); return { success: false }; } }; });
    const c2 = await Conn.open(d.room, { headers: { "CF-Connecting-IP": "203.0.113.9" } });
    const r = await c2.auth(d, { firstDevice: true });
    expect(r.h.r).toBe("rate-limited");
    expect((await c2.waitClosed()).code).toBe(4008);
    expect(keys).toEqual(["mesh-create:203.0.113.9"]);
  });
  it("allows creation when the limiter allows, and does not consult it for existing members", async () => {
    const d = await newDevice();
    const c0 = await Conn.open(d.room, { headers: { "CF-Connecting-IP": "203.0.113.10" } });
    const calls: string[] = [];
    await inRoom(d.room, (r) => { r.createLimiter = { limit: async (o) => { calls.push(o.key); return { success: true }; } }; });
    expect((await c0.auth(d, { firstDevice: true })).h.r).toBe("ok");
    const c1 = await Conn.open(d.room, { headers: { "CF-Connecting-IP": "203.0.113.10" } });
    expect((await c1.auth(d)).h.r).toBe("ok");
    expect(calls).toHaveLength(1);
  });
});

describe("registers (compare-and-swap)", () => {
  it("creates, reads, rejects a stale token with the current value, and lists changes since a revision", async () => {
    const { conns } = await makeSet(["a", "b"]);
    const [a, b] = conns as [Conn, Conn];
    const v1 = new TextEncoder().encode("one");
    expect((await a.call({ op: "reg-set", key: "head:v1", expectToken: 0 }, v1)).h).toMatchObject({ op: "reg-ok", token: 1 });
    // two devices race on a new key: one wins, one conflicts
    const lost = await b.call({ op: "reg-set", key: "head:v1", expectToken: 0 }, new TextEncoder().encode("two"));
    expect(lost.h).toMatchObject({ op: "conflict", token: 1 });
    expect(new TextDecoder().decode(lost.payload)).toBe("one");
    expect((await b.call({ op: "reg-set", key: "head:v1", expectToken: 1 }, new TextEncoder().encode("two"))).h.token).toBe(2);
    expect((await a.call({ op: "reg-set", key: "host:v1", expectToken: 0 }, v1)).h.token).toBe(1);
    const g = await a.call({ op: "reg-get", key: "head:v1" });
    expect(new TextDecoder().decode(g.payload)).toBe("two");
    const all = await a.call({ op: "reg-list" });
    expect(all.h.regs.map((r: any) => r.key).sort()).toEqual(["head:v1", "host:v1"]);
    const since = await a.call({ op: "reg-list", sinceRev: all.h.rev });
    expect(since.h.regs).toEqual([]);
    await b.call({ op: "reg-set", key: "host:v1", expectToken: 1 }, v1);
    expect((await a.call({ op: "reg-list", sinceRev: all.h.rev })).h.regs.map((r: any) => r.key)).toEqual(["host:v1"]);
  });
  it("refuses values over 16 KiB and bad keys", async () => {
    const { conns } = await makeSet(["a"]);
    expect((await conns[0]!.call({ op: "reg-set", key: "k", expectToken: 0 }, bytesOf(16 * 1024 + 1))).h).toMatchObject({ op: "over-limit", why: "register" });
    expect((await conns[0]!.call({ op: "reg-set", key: "bad key!", expectToken: 0 }, bytesOf(1))).h.reason).toBe("bad-header");
    expect((await conns[0]!.call({ op: "reg-set", key: "k", expectToken: 0 }, bytesOf(16 * 1024))).h.op).toBe("reg-ok");
  });
});

describe("device removal", () => {
  it("closes the removed device's connection, refuses its return, and bans re-adding it", async () => {
    const { room, devices, conns } = await makeSet(["a", "b", "c"]);
    const [a, b, c] = conns as [Conn, Conn, Conn];
    expect((await a.call({ op: "roster-remove", dev: devices[2]!.dev })).h.op).toBe("ok");
    expect((await c.waitClosed()).code).toBe(4003);
    expect((await b.waitFor((m) => m.h.op === "roster-changed" && m.h.change === "removed")).h).toMatchObject({ dev: devices[2]!.dev });
    const back = await Conn.open(room);
    expect((await back.auth(devices[2]!)).h.r).toBe("removed");
    expect((await back.waitClosed()).code).toBe(4003);
    expect((await a.call({ op: "roster-add", signKey: devices[2]!.signKey })).h.reason).toBe("banned");
  });

  it("refuses a removed device's frames even on a socket the close has not reached yet", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    const b = conns[1]!;
    // mark removed behind the socket's back, as if the close message were still in flight
    await inRoom(room, (r: any) => r.q(`UPDATE roster SET removed=1 WHERE dev=?`, devices[1]!.dev));
    b.send(holdHeader(devices[1]!, "g1", 1), bytesOf(100));
    expect((await b.waitClosed()).code).toBe(4003);
    expect((await conns[0]!.call({ op: "usage" })).h.usage.bytes).toBe(0);
  });

  it("a removed device no longer blocks frames from being dropped", async () => {
    const { devices, conns } = await makeSet(["a", "b", "c"]);
    const [a, b] = conns as [Conn, Conn];
    await a.call(holdHeader(devices[0]!, "g1", 1) as any, bytesOf(500));
    await a.call({ op: "received", g: "g1", through: 1 });
    await b.call({ op: "received", g: "g1", through: 1 });
    expect((await a.call({ op: "usage" })).h.usage.bytes).toBe(500); // c has said nothing: still held
    await a.call({ op: "roster-remove", dev: devices[2]!.dev });
    expect((await a.call({ op: "usage" })).h.usage.bytes).toBe(0);
  });

  it("refuses to remove an unknown device; removing the last device erases the set", async () => {
    const { room, devices, conns } = await makeSet(["a"]);
    expect((await conns[0]!.call({ op: "roster-remove", dev: "ee".repeat(16) })).h.reason).toBe("not-found");
    conns[0]!.send({ op: "roster-remove", dev: devices[0]!.dev });
    // the removed device is closed with 4003 (that close lands first); the set is then wiped
    expect((await conns[0]!.waitClosed()).code).toBe(4003);
    // the set is empty again: anyone's key can create it afresh (only the matching first key)
    const c = await Conn.open(room);
    expect((await c.auth(devices[0]!, { firstDevice: true })).h).toMatchObject({ r: "ok", created: true });
  });
});

describe("misc", () => {
  it("answers an unknown op with an error instead of dropping the connection", async () => {
    const { conns } = await makeSet(["a"]);
    expect((await conns[0]!.call({ op: "from-the-future" })).h).toMatchObject({ op: "error", reason: "unknown-op" });
    expect((await conns[0]!.call({ op: "usage" })).h.op).toBe("usage-result");
  });
  it("caps the number of devices in a set", async () => {
    const { conns } = await makeSet(["a"]);
    for (let i = 0; i < 15; i++) expect((await conns[0]!.call({ op: "roster-add", signKey: (await newDevice()).signKey })).h.op).toBe("ok");
    expect((await conns[0]!.call({ op: "roster-add", signKey: (await newDevice()).signKey })).h.reason).toBe("too-many-devices");
  });
});

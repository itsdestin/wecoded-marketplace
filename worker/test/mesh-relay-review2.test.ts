import { runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { Conn, bytesOf, holdHeader, inRoom, makeSet, rosterAdd, rosterRemove, rosterRename, stubFor, newDevice, type Device } from "./mesh-helpers";
import { CONTROL_FRAME_TTL_MS, DAY_MS } from "../src/mesh/protocol";
import { randomHex } from "../src/mesh/auth";

// Fixes for the second-round security review of the relay (N5, N6, dead-member pinning, N10, concurrent removal).
// Written BEFORE the fixes: each describe block failed on the old relay.

const skew = (room: string, ms: number) => inRoom(room, (r) => { const base = Date.now(); r.now = () => base + ms; });
/** Per-device hold counter: the relay refuses a repeated (device, session) number. */
const counters = new Map<string, number>();
const hold = (c: Conn, d: Device, g: string, size: number, extra: object = {}) => {
  const n = (counters.get(d.dev) ?? 0) + 1; counters.set(d.dev, n);
  return c.call(holdHeader(d, g, n, undefined, extra) as any, bytesOf(size));
};
const fetchAll = async (c: Conn, g: string, seq = 0) => { const id = randomHex(4); c.send({ op: "fetch-after", g, seq, id }); return c.frames(id); };

describe("N5: the roster group's class is fixed by its name", () => {
  it("a member cannot make `roster` a line group: line:true is refused and the frames survive 31 days", async () => {
    const { room, devices, conns } = await makeSet(["a", "b", "c"]);
    const [a, b] = conns as [Conn, Conn, Conn];
    expect((await hold(a, devices[0]!, "roster", 300)).h.op).toBe("stored");
    expect((await hold(b, devices[1]!, "roster", 100, { line: true })).h).toMatchObject({ op: "refused", reason: "control-group" });
    await skew(room, 31 * DAY_MS);
    await runDurableObjectAlarm(stubFor(room));
    const back = await Conn.open(room);
    expect((await back.auth(devices[2]!)).h.r).toBe("ok");
    const got = await fetchAll(back, "roster");
    expect(got.filter((m) => m.h.op === "frame")).toHaveLength(1);
  });
  it("for other groups the first hold decides the class permanently (both directions refused)", async () => {
    const { devices, conns } = await makeSet(["a"]);
    const a = conns[0]!;
    expect((await hold(a, devices[0]!, "g", 100)).h.op).toBe("stored");
    expect((await hold(a, devices[0]!, "g", 100, { line: true })).h).toMatchObject({ op: "refused", reason: "group-class" });
    expect((await hold(a, devices[0]!, "chat:1", 100, { line: true })).h.op).toBe("stored");
    expect((await hold(a, devices[0]!, "chat:1", 100)).h).toMatchObject({ op: "refused", reason: "group-class" });
    expect((await hold(a, devices[0]!, "chat:1", 100, { line: true })).h.op).toBe("stored");
  });
});

describe("N6: per-writer quotas, per-group caps and a reserve for the roster group", () => {
  it("one writer cannot exceed its byte quota across non-line groups, and the roster group still accepts a hold", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    const [a, b] = conns as [Conn, Conn];
    await inRoom(room, (r) => { r.limits = { ...r.limits, otherWriterBytes: 1000 }; });
    expect((await hold(b, devices[1]!, "j1", 400)).h.op).toBe("stored");
    expect((await hold(b, devices[1]!, "j2", 400)).h.op).toBe("stored");
    expect((await hold(b, devices[1]!, "j3", 400)).h).toMatchObject({ op: "over-limit", why: "writer" });
    expect((await hold(a, devices[0]!, "j4", 400)).h.op).toBe("stored"); // another writer is unaffected
    expect((await hold(b, devices[1]!, "roster", 100)).h.op).toBe("stored");
  });
  it("one writer cannot exceed its frame-count quota", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    const b = conns[1]!;
    await inRoom(room, (r) => { r.limits = { ...r.limits, otherWriterFrames: 3 }; });
    for (let i = 0; i < 3; i++) expect((await hold(b, devices[1]!, `j${i}`, 10)).h.op).toBe("stored");
    expect((await hold(b, devices[1]!, "j9", 10)).h).toMatchObject({ op: "over-limit", why: "writer" });
  });
  it("a non-line group has a byte cap of its own", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    const b = conns[1]!;
    await inRoom(room, (r) => { r.limits = { ...r.limits, otherGroupBytes: 500 }; });
    expect((await hold(b, devices[1]!, "j1", 300)).h.op).toBe("stored");
    expect((await hold(b, devices[1]!, "j1", 300)).h).toMatchObject({ op: "over-limit", why: "group" });
  });
  it("the roster group has a per-writer quota too", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    const [a, b] = conns as [Conn, Conn];
    await inRoom(room, (r) => { r.limits = { ...r.limits, rosterWriterBytes: 500 }; });
    expect((await hold(b, devices[1]!, "roster", 200)).h.op).toBe("stored");
    expect((await hold(b, devices[1]!, "roster", 200)).h.op).toBe("stored");
    expect((await hold(b, devices[1]!, "roster", 200)).h).toMatchObject({ op: "over-limit", why: "writer" });
    expect((await hold(a, devices[0]!, "roster", 200)).h.op).toBe("stored");
  });
  it("junk from several writers cannot take the roster's reserve (10% of the ceiling)", async () => {
    const { room, devices, conns } = await makeSet(["a", "b", "c"]);
    const [a, b, c] = conns as [Conn, Conn, Conn];
    await inRoom(room, (r) => { r.limits = { ...r.limits, setCap: 1000 }; });
    expect((await hold(a, devices[0]!, "j1", 450)).h.op).toBe("stored");
    expect((await hold(b, devices[1]!, "j2", 450)).h.op).toBe("stored");
    expect((await hold(c, devices[2]!, "j3", 100)).h).toMatchObject({ op: "over-limit", why: "set" });
    expect((await hold(c, devices[2]!, "roster", 100)).h.op).toBe("stored");
  });
  it("removing a device frees its unacknowledged frames in non-roster groups, keeps its roster frames", async () => {
    const { room, devices, conns } = await makeSet(["a", "b", "c"]);
    const [a, b] = conns as [Conn, Conn, Conn];
    await hold(b, devices[1]!, "j1", 400);
    await hold(b, devices[1]!, "chat:1", 300, { line: true });
    await hold(b, devices[1]!, "roster", 100);
    await hold(a, devices[0]!, "j1", 50);
    expect((await a.call({ op: "usage" })).h.usage.bytes).toBe(850);
    expect((await rosterRemove(a, devices[1]!.dev)).h.op).toBe("ok");
    expect((await a.call({ op: "usage" })).h.usage.bytes).toBe(150);
    expect(await inRoom(room, (r) => (r as any).q(`SELECT coalesce(sum(bytes),0) s FROM groups`)[0].s)).toBe(150);
  });
});

describe("dead member: control frames expire after 90 days and a returning device is told with a gap", () => {
  it("keeps a roster frame to the last millisecond of the period, then releases it; a device that never acknowledged gets a gap", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    const [a, b] = conns as [Conn, Conn];
    await hold(a, devices[0]!, "roster", 200);
    await hold(a, devices[0]!, "roster", 100);
    b.ws.close(1000, "dead"); await b.closed;
    const t = await inRoom(room, (r) => Number((r as any).q(`SELECT min(t) t FROM frames`)[0].t));
    await inRoom(room, (r) => { r.now = () => t + CONTROL_FRAME_TTL_MS; });
    await runDurableObjectAlarm(stubFor(room));
    expect((await a.call({ op: "usage" })).h.usage.bytes).toBe(300);
    await inRoom(room, (r) => { r.now = () => t + CONTROL_FRAME_TTL_MS + 1; });
    await runDurableObjectAlarm(stubFor(room));
    // frame 1 was written at t, frame 2 a few ms later: only frame 1 is past the period
    expect((await a.call({ op: "usage" })).h.usage.bytes).toBeLessThanOrEqual(100);
    const back = await Conn.open(room);
    expect((await back.auth(devices[1]!)).h.r).toBe("ok");
    expect((await fetchAll(back, "roster", 0))[0]!.h).toMatchObject({ op: "gap" });
    // a device already past the released part is not told of a gap
    expect((await fetchAll(back, "roster", 2))[0]!.h.op).toBe("frames-end");
  });
  it("an ordinary frame the dead device would still have acknowledged is untouched before the period ends", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    await hold(conns[0]!, devices[0]!, "roster", 200);
    await skew(room, 89 * DAY_MS);
    await runDurableObjectAlarm(stubFor(room));
    expect((await conns[0]!.call({ op: "usage" })).h.usage.bytes).toBe(200);
  });
});

describe("N10: a relay object created by older code is upgraded instead of failing", () => {
  it("old-shape groups, meets and frames tables work again after the upgrade (hold and meet-open answer normally)", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    await inRoom(room, (r) => {
      const q = (s: string) => (r as any).q(s);
      q(`DROP TABLE frames`); q(`DROP TABLE groups`); q(`DROP TABLE meets`);
      q(`CREATE TABLE frames(g TEXT, seq INTEGER, sz INTEGER, b BLOB, PRIMARY KEY(g,seq)) WITHOUT ROWID`);
      q(`CREATE TABLE groups(g TEXT PRIMARY KEY, next_seq INTEGER NOT NULL, bytes INTEGER NOT NULL, last_line_at INTEGER NOT NULL, last_touch INTEGER NOT NULL, released_through INTEGER NOT NULL, last_writer TEXT NOT NULL) WITHOUT ROWID`);
      q(`CREATE TABLE meets(m TEXT PRIMARY KEY, created INTEGER NOT NULL, expires INTEGER NOT NULL) WITHOUT ROWID`);
      q(`DELETE FROM meta WHERE k='total_bytes'`);
      (r as any).init(); // what the constructor does on the next wake
    });
    expect((await hold(conns[0]!, devices[0]!, "chat:1", 100, { line: true })).h.op).toBe("stored");
    const mo = await conns[1]!.call({ op: "meet-open", m: randomHex(32) });
    expect(mo.h.op).toBe("meet-opened");
    expect(conns[0]!.closeInfo).toBeNull();
  });
});

describe("concurrent removal at the relay (mutual removal, default: both removed)", () => {
  /** Three devices; returns the relay entry id that introduced each device (its admission), for building `seen` lists. */
  async function trio() {
    const s = await makeSet(["a", "b", "c"]);
    const intro = await inRoom(s.room, (r) => Object.fromEntries((r as any).q(`SELECT dev, entry FROM rintro`).map((x: any) => [x.dev, x.entry])));
    return { ...s, intro: intro as Record<string, string> };
  }
  const active = (room: string) => inRoom(room, (r) => (r as any).activeDevices().sort() as string[]);

  it("A removes B; B's concurrent removal of A (not citing A's removal) is accepted and removes A too", async () => {
    const { room, devices, conns } = await trio();
    const [a, , c] = conns as [Conn, Conn, Conn];
    expect((await rosterRemove(a, devices[1]!.dev)).h.op).toBe("ok");
    const r = await rosterRemove(c, devices[0]!.dev, { signer: devices[1]! });
    expect(r.h.op).toBe("ok");
    expect(await active(room)).toEqual([devices[2]!.dev]);
    expect((await a.waitClosed()).code).toBe(4003);
  });
  it("a removed signer that DOES cite the removal that removed it is refused", async () => {
    const { room, devices, conns, intro } = await trio();
    const [a, , c] = conns as [Conn, Conn, Conn];
    const eA = randomHex(32);
    expect((await rosterRemove(a, devices[1]!.dev, { entry: eA })).h.op).toBe("ok");
    const r = await rosterRemove(c, devices[0]!.dev, { signer: devices[1]!, seen: [intro[devices[1]!.dev]!, eA] });
    expect(r.h).toMatchObject({ op: "refused", reason: "signer-removed" });
    expect(await active(room)).toEqual([devices[0]!.dev, devices[2]!.dev].sort());
  });
  it("a removed signer may not remove anyone but the device that removed it, nor add or rename", async () => {
    const { room, devices, conns } = await trio();
    const [a, , c] = conns as [Conn, Conn, Conn];
    await rosterRemove(a, devices[1]!.dev);
    expect((await rosterRemove(c, devices[2]!.dev, { signer: devices[1]! })).h.reason).toBe("signer-removed");
    expect((await rosterAdd(c, await newDevice("x"), { signer: devices[1]! })).h.reason).toBe("signer-removed");
    expect((await rosterRename(c, { signer: devices[1]! })).h.reason).toBe("signer-removed");
    expect(await active(room)).toEqual([devices[0]!.dev, devices[2]!.dev].sort());
  });
  it("removing an already-removed device is an idempotent success", async () => {
    const { devices, conns } = await trio();
    const a = conns[0]!;
    expect((await rosterRemove(a, devices[2]!.dev)).h.op).toBe("ok");
    expect((await rosterRemove(a, devices[2]!.dev)).h.op).toBe("ok");
    expect((await rosterRemove(a, "ee".repeat(16))).h.reason).toBe("not-found");
  });
  it("a bad signature from a removed signer gets nothing", async () => {
    const { room, devices, conns } = await trio();
    const [a, , c] = conns as [Conn, Conn, Conn];
    await rosterRemove(a, devices[1]!.dev);
    expect((await rosterRemove(c, devices[0]!.dev, { signer: devices[1]!, corruptSig: true })).h.reason).toBe("bad-signature");
    expect((await active(room)).length).toBe(2);
  });
  // The relay's 'first-admitted' variant was REMOVED in the third round (it carried an opinion the app could contradict); see mesh-relay-review3.test.ts.
});

import { runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { Conn, bytesOf, holdHeader, inRoom, joinMeeting, makeSet, newDevice, newMeetId, openMeeting, rosterAdd, rosterPut, rosterRename, rosterRemove, stubFor } from "./mesh-helpers";
import { DAY_MS, FIRST_STATEMENT_SKEW_MS, MEET_MAX_GUEST_CONNECTS, MEET_MAX_HOST_MESSAGE_BYTES, MEET_MAX_MESSAGE_BYTES, MEET_MAX_OPEN_PER_DEVICE, MEET_OPENS_PER_DEVICE_HOUR, ROSTER_MAX_PER_SIGNER, ROSTER_MAX_PER_SIGNER_HOUR, ROSTER_MAX_SEEN } from "../src/mesh/protocol";
import { randomHex } from "../src/mesh/auth";

// Fixes for the second independent review of the relay (findings 1, 4, 5, 12, and the first-statement replay in 15).
const skew = (room: string, ms: number) => inRoom(room, (r) => { const base = Date.now(); r.now = () => base + ms; });

describe("finding 1: the relay follows rename entries (without learning the name)", () => {
  it("after a rename statement, the same device can still add and remove (the ancestry walk reaches its introduction)", async () => {
    const { conns, devices, room } = await makeSet(["a", "b"]);
    const ren = await rosterRename(conns[0]!);
    expect(ren.h.op).toBe("ok");
    const late = await newDevice("late");
    expect((await rosterAdd(conns[0]!, late)).h.op).toBe("ok");
    expect((await rosterRename(conns[1]!)).h.op).toBe("ok");
    expect((await rosterRemove(conns[1]!, late.dev)).h.op).toBe("ok");
    // a rename changes nobody's membership and is recorded as a rename
    expect(await inRoom(room, (r) => (r as any).activeDevices().length)).toBe(2);
    expect(await inRoom(room, (r) => (r as any).q(`SELECT count(*) n FROM rentries WHERE kind='rename'`)[0].n)).toBe(2);
    void devices;
  });
  it("a rename must name its signer, carry no key, be signed by a member, and cite history the relay knows", async () => {
    const { conns, devices } = await makeSet(["a", "b"]);
    const other = await newDevice();
    // target other than the signer
    const forged = await rosterPut(conns[0]!, "rename", { dev: other.dev });
    expect(forged.h.op).toBe("ok"); // the helper forces target = signer; now hand-build the bad one
    const bad = await conns[0]!.call({ op: "roster-put", kind: "rename", signer: devices[0]!.dev, target: other.dev, entry: randomHex(32), seen: ["11".repeat(32)], at: 1, sig: "00".repeat(64) });
    expect(bad.h.reason).toBe("bad-header");
    const withKey = await conns[0]!.call({ op: "roster-put", kind: "rename", signer: devices[0]!.dev, target: devices[0]!.dev, targetKey: other.signKey, entry: randomHex(32), seen: ["11".repeat(32)], at: 1, sig: "00".repeat(64) });
    expect(withKey.h.reason).toBe("bad-header");
    expect((await rosterRename(conns[1]!, { seen: ["99".repeat(32)] })).h.reason).toBe("bad-ancestry");
    expect((await rosterRename(conns[0]!, { signer: await newDevice() })).h.reason).toBe("not-a-member");
  });
  it("accepts a seen list up to the app's limit of 64 and refuses 65", async () => {
    const { conns } = await makeSet(["a"]);
    expect((await rosterRename(conns[0]!)).h.op).toBe("ok"); // the creator's first statement (records its genesis)
    const known = await inRoom(conns[0]!.room, (r) => (r as any).q(`SELECT entry FROM rintro`)[0].entry as string);
    const filler = Array.from({ length: ROSTER_MAX_SEEN - 1 }, () => randomHex(32));
    expect((await rosterRename(conns[0]!, { seen: [known, ...filler] })).h.op).toBe("ok");
    expect((await rosterRename(conns[0]!, { seen: [known, ...filler, randomHex(32)] })).h.reason).toBe("bad-header");
  });
});

describe("finding 4: per-device roster limits, and the first statement must be fresh", () => {
  it("a device may have at most 30 statements recorded in any rolling hour", async () => {
    const { conns, room } = await makeSet(["a", "b"]);
    // makeSet already used one of device a's thirty (its add of b)
    for (let i = 0; i < ROSTER_MAX_PER_SIGNER_HOUR - 1; i++) expect((await rosterRename(conns[0]!)).h.op, `rename ${i}`).toBe("ok");
    expect((await rosterRename(conns[0]!)).h.reason).toBe("roster-rate-limited");
    // another device has its own allowance (a flooder cannot use up everyone's)
    expect((await rosterRename(conns[1]!)).h.op).toBe("ok");
    // refused statements are not counted: an hour later the device may write again
    await skew(room, 3_600_001);
    expect((await rosterRename(conns[0]!)).h.op).toBe("ok");
  });
  it("a device may have at most ROSTER_MAX_PER_SIGNER (256) statements in total, however slowly it writes them", async () => {
    const { conns, room, devices } = await makeSet(["a", "b"]);
    await inRoom(room, (r) => { for (let i = 0; i < ROSTER_MAX_PER_SIGNER - 6; i++) (r as any).q(`INSERT INTO rentries(id,signer,kind,target,t) VALUES(?,?,?,?,?)`, randomHex(32), devices[0]!.dev, "rename", devices[0]!.dev, 1); });
    for (let i = 0; i < 5; i++) expect((await rosterRename(conns[0]!)).h.op).toBe("ok");
    expect((await rosterRename(conns[0]!)).h.reason).toBe("too-many-entries");
    expect((await rosterRename(conns[1]!)).h.op).toBe("ok");
  });
  it("the room's first statement must be dated within a day of the relay's clock (a replayed old statement is refused)", async () => {
    const a = await newDevice();
    const c = await Conn.open(a.room);
    await c.auth(a, { firstDevice: true });
    expect((await rosterRename(c, { at: Date.now() - FIRST_STATEMENT_SKEW_MS - 60_000 })).h.reason).toBe("stale-statement");
    expect((await rosterRename(c, { at: Date.now() + FIRST_STATEMENT_SKEW_MS + 60_000 })).h.reason).toBe("stale-statement");
    expect((await rosterRename(c, { at: Date.now() })).h.op).toBe("ok");
  });
});

describe("finding 5: control groups (roster) are never dropped by the 30-day rule or by set-full release", () => {
  it("a group that never carried a chat line keeps its frames 31+ days, and an offline device fetches them", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    const [a, b] = conns as [Conn, Conn];
    await a.call(holdHeader(devices[0]!, "roster", 1) as any, bytesOf(300));
    await a.call(holdHeader(devices[0]!, "chat:x", 2, undefined, { line: true }) as any, bytesOf(300));
    b.ws.close(1000, "offline");
    await b.closed;
    await skew(room, 31 * DAY_MS);
    await runDurableObjectAlarm(stubFor(room));
    const back = await Conn.open(room);
    expect((await back.auth(devices[1]!)).h.r).toBe("ok");
    back.send({ op: "fetch-after", g: "roster", seq: 0, id: "r" });
    expect((await back.frames("r")).filter((m) => m.h.op === "frame")).toHaveLength(1);
    back.send({ op: "fetch-after", g: "chat:x", seq: 0, id: "c" });
    expect((await back.frames("c"))[0]!.h).toMatchObject({ op: "gap" }); // the line group is still let go on schedule
  });
  // CHANGED in review round 2 (N5): this test used to pin "a group first held without line and later with line becomes a line group (expires)",
  // which let any member turn the roster group into a purgeable one. The first hold now decides the class for good; a later change is refused.
  it("a group first held without line stays a control group: a later line:true is refused and the frames are not expired at 31 days", async () => {
    const { room, devices, conns } = await makeSet(["a"]);
    await conns[0]!.call(holdHeader(devices[0]!, "g", 1) as any, bytesOf(100));
    expect((await conns[0]!.call(holdHeader(devices[0]!, "g", 2, undefined, { line: true }) as any, bytesOf(100))).h).toMatchObject({ op: "refused", reason: "group-class" });
    await skew(room, 31 * DAY_MS);
    await runDurableObjectAlarm(stubFor(room));
    expect((await conns[0]!.call({ op: "usage" })).h.usage.bytes).toBe(100);
  });
  it("when the set is full, line groups are released but the control group is not", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    const a = conns[0]!;
    await inRoom(room, (r) => { r.limits = { ...r.limits, setCap: 1000 }; });
    await a.call(holdHeader(devices[0]!, "roster", 1) as any, bytesOf(400));
    await a.call(holdHeader(devices[0]!, "chat:1", 2, undefined, { line: true }) as any, bytesOf(400));
    const r = await a.call(holdHeader(devices[0]!, "chat:2", 3, undefined, { line: true }) as any, bytesOf(300));
    expect(r.h.op).toBe("stored");
    a.send({ op: "fetch-after", g: "roster", seq: 0, id: "r" });
    expect((await a.frames("r")).filter((m) => m.h.op === "frame")).toHaveLength(1);
    a.send({ op: "fetch-after", g: "chat:1", seq: 0, id: "c" });
    expect((await a.frames("c"))[0]!.h.op).toBe("gap");
    // and with only control data filling the set, a new write is refused rather than evicting it
    await a.call(holdHeader(devices[0]!, "roster", 4) as any, bytesOf(250));
    const full = await a.call(holdHeader(devices[0]!, "chat:3", 5, undefined, { line: true }) as any, bytesOf(500));
    expect(full.h.op).toBe("over-limit");
    a.send({ op: "fetch-after", g: "roster", seq: 0, id: "r2" });
    expect((await a.frames("r2")).filter((m) => m.h.op === "frame")).toHaveLength(2);
  });
});

describe("finding 12 M4: meeting limits are per opening device, with a reserved share", () => {
  it("one member using up its own share does not stop another member from opening", async () => {
    const { conns } = await makeSet(["a", "b"]);
    for (let i = 0; i < MEET_MAX_OPEN_PER_DEVICE; i++) expect((await openMeeting(conns[0]!)).reply.h.op).toBe("meet-opened");
    expect((await openMeeting(conns[0]!)).reply.h).toMatchObject({ op: "refused", reason: "too-many-meetings" });
    expect((await openMeeting(conns[1]!)).reply.h.op).toBe("meet-opened");
  });
  it("hourly: six per device, and a device's burst does not use the others' share", async () => {
    const { conns, room } = await makeSet(["a", "b"]);
    for (let i = 0; i < MEET_OPENS_PER_DEVICE_HOUR; i++) {
      expect((await openMeeting(conns[0]!)).reply.h.op, `open ${i}`).toBe("meet-opened");
      await inRoom(room, (r) => { (r as any).q(`UPDATE meets SET expires=1`); });
    }
    expect((await openMeeting(conns[0]!)).reply.h).toMatchObject({ op: "refused", reason: "rate-limited" });
    expect((await openMeeting(conns[1]!)).reply.h.op).toBe("meet-opened");
  });
});

describe("finding 12 M5: silent strangers cannot use up the guest allowance or the slot", () => {
  it("nine silent connections in a row do not stop the honest guest, who gets a free slot", async () => {
    const { conns } = await makeSet(["owner"]);
    const o = await openMeeting(conns[0]!);
    const host = await joinMeeting(o.m, "host", o.ticket);
    const silent: Conn[] = [];
    for (let i = 0; i < MEET_MAX_GUEST_CONNECTS + 1; i++) {
      // each newcomer must be older than the minimum age to evict the previous idle one
      await inRoom(`meet:${o.m}`, (r) => { const t0 = Date.now(); const k = (i + 1) * 5000; r.now = () => t0 + k; });
      const g = await joinMeeting(o.m, "guest");
      expect(g.first.h.op, `silent ${i}`).toBe("meet-joined");
      silent.push(g.c);
    }
    await inRoom(`meet:${o.m}`, (r) => { const t0 = Date.now(); r.now = () => t0 + 100_000; });
    const honest = await joinMeeting(o.m, "guest");
    expect(honest.first.h.op).toBe("meet-joined");
    honest.c.send({ op: "meet-relay", n: 1 }, new TextEncoder().encode("hello"));
    expect(new TextDecoder().decode((await host.c.waitFor((m) => m.h.op === "meet-relay")).payload)).toBe("hello");
    void silent;
  });
  it("a guest that has sent a message counts toward the allowance and is never evicted by a newcomer", async () => {
    const { conns } = await makeSet(["owner"]);
    const o = await openMeeting(conns[0]!);
    const host = await joinMeeting(o.m, "host", o.ticket);
    const g1 = await joinMeeting(o.m, "guest");
    g1.c.send({ op: "meet-relay", n: 1 }, bytesOf(10));
    await host.c.waitFor("meet-relay");
    await inRoom(`meet:${o.m}`, (r) => { const t0 = Date.now(); r.now = () => t0 + 60_000; });
    expect((await joinMeeting(o.m, "guest")).first.h).toMatchObject({ op: "refused", reason: "busy" });
  });
});

describe("finding 11 at the relay: the host's welcome may be large, the guest's messages may not", () => {
  it("a 600 KiB host-to-guest message passes; a 20 KiB guest-to-host message is refused", async () => {
    const { conns } = await makeSet(["owner"]);
    const o = await openMeeting(conns[0]!);
    const host = await joinMeeting(o.m, "host", o.ticket);
    const guest = await joinMeeting(o.m, "guest");
    await host.c.waitFor("meet-peer");
    const big = bytesOf(600 * 1024);
    host.c.send({ op: "meet-relay", n: 1 }, big);
    expect((await guest.c.waitFor((m) => m.h.op === "meet-relay")).payload.length).toBe(600 * 1024);
    guest.c.send({ op: "meet-relay", n: 1 }, bytesOf(20 * 1024));
    expect((await guest.c.waitClosed()).code).toBe(4007);
    expect(MEET_MAX_HOST_MESSAGE_BYTES).toBe(1 << 20);
    expect(MEET_MAX_MESSAGE_BYTES).toBe(16 * 1024);
  });
  it("a socket that has not joined as host cannot send a large message either", async () => {
    const { conns } = await makeSet(["owner"]);
    const o = await openMeeting(conns[0]!);
    const c = await Conn.openMeet(o.m);
    c.send({ op: "meet-relay", n: 1 }, bytesOf(100 * 1024));
    expect((await c.waitClosed()).code).toBe(4007);
  });
});
void newMeetId;

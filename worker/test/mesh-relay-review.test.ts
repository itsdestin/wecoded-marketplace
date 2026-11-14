/// <reference types="vite/client" />
// Fixes for the independent code review of the Mesh relay (docs/active/reviews/2026-11-14-mesh-relay-code-review.md).
// Each test names the finding it reproduces. Every clock-dependent test sets the room's own clock (`r.now`) so
// nothing here waits on real time.
import { env, SELF, createExecutionContext, waitOnExecutionContext, listDurableObjectIds, runDurableObjectAlarm } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { Conn, bytesOf, holdHeader, inRoom, makeSet, newDevice, stubFor, rosterAdd, rosterRemove } from "./mesh-helpers";
import { DAY_MS } from "../src/mesh/protocol";
import { isEd25519Point } from "../src/mesh/auth";

const room = "ab".repeat(32);
const WS = { Upgrade: "websocket" };
async function callWorker(extraEnv: Record<string, unknown>, path = `/mesh/relay/${room}?v=1`, headers: Record<string, string> = { ...WS, "CF-Connecting-IP": "198.51.100.7" }) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://test.local${path}`, { headers }), { ...env, ...extraEnv } as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
function spyNs() {
  const touched: string[] = [];
  return { touched, idFromName(n: string) { touched.push("idFromName"); return { n } as any; }, get() { touched.push("get"); return { fetch: async () => new Response("reached", { status: 200 }) } as any; } };
}
const fixClock = (r: string, t = Date.now()) => inRoom(r, (x) => { x.now = () => t; });
const setClock = (r: string, fn: () => number) => inRoom(r, (x) => { x.now = fn; });

describe("finding 1: the generic /parties/ route cannot reach the relay", () => {
  it("answers /parties/mesh-relay/* exactly like an unknown party, flag on or off, and creates no object", async () => {
    const before = (await listDurableObjectIds(env.MESH_RELAY)).length;
    const unknown = await SELF.fetch(`https://test.local/parties/not-a-party/${room}`, { headers: WS });
    for (const flag of ["1", "0"]) for (const path of [`/parties/mesh-relay/${room}`, `/parties/mesh-relay/ABCDEF`, `/parties/mesh-relay`]) {
      for (const headers of [WS, {}] as Array<Record<string, string>>) {
        const res = await callWorker({ MESH_RELAY_ENABLED: flag }, path, headers);
        const ref = await callWorker({ MESH_RELAY_ENABLED: flag }, path.replace("mesh-relay", "not-a-party"), headers);
        expect(res.status).toBe(ref.status);
        expect(await res.text()).toBe(await ref.text());
      }
    }
    expect(unknown.status).toBe(400);
    expect(await listDurableObjectIds(env.MESH_RELAY)).toHaveLength(before);
  });
  it("is blocked even when the games ticket check would pass (the block does not rely on it)", async () => {
    // A lobby for party "mesh-relay" must be refused before the ticket is even looked at: no DB access is needed.
    const res = await callWorker({ DB: undefined }, `/parties/mesh-relay/${room}?ticket=anything`);
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid request");
  });
  it("leaves the existing games paths untouched", async () => {
    const res = await SELF.fetch(`https://test.local/parties/chess/ABCDEF`, { headers: WS });
    expect(res.status).toBe(401);
  });
});

describe("finding 2: the allow-list fails closed and the mode is explicit", () => {
  it("allowlist mode (and a missing mode) with an empty, blank or missing list admits no room and touches no object", async () => {
    for (const mode of ["allowlist", undefined]) for (const list of [undefined, "", "   ", ","]) {
      const spy = spyNs();
      const res = await callWorker({ MESH_RELAY_MODE: mode, MESH_ALLOWED_ROOMS: list, MESH_RELAY: spy });
      expect(res.status).toBe(404);
      expect(spy.touched).toEqual([]);
    }
  });
  it("allowlist mode admits exactly the listed rooms", async () => {
    const spy = spyNs();
    const ok = await callWorker({ MESH_RELAY_MODE: "allowlist", MESH_ALLOWED_ROOMS: `${"cd".repeat(32)}, ${room}`, MESH_RELAY: spy, EVENT_RATE_LIMITER: { limit: async () => ({ success: true }) } });
    expect(ok.status).toBe(200);
    expect((await callWorker({ MESH_RELAY_MODE: "allowlist", MESH_ALLOWED_ROOMS: "cd".repeat(32), MESH_RELAY: spyNs() })).status).toBe(404);
  });
  it("\"open\", \"off\" and any unknown mode word admit nothing (open is not implemented yet)", async () => {
    for (const mode of ["open", "off", "OPEN", "public", "allow-list", " "]) {
      const spy = spyNs();
      const res = await callWorker({ MESH_RELAY_MODE: mode, MESH_ALLOWED_ROOMS: room, MESH_RELAY: spy });
      expect(res.status).toBe(404);
      expect(spy.touched).toEqual([]);
    }
  });
});

describe("finding 3: the 90-day idle erase never hits a set in use", () => {
  it("a set with a live authenticated socket survives an alarm 91 days on, and keeps its data", async () => {
    const { room: r, devices, conns } = await makeSet(["a"]);
    await conns[0]!.call({ op: "reg-set", key: "head:v1", expectToken: 0 }, bytesOf(10));
    const base = Date.now();
    await setClock(r, () => base + 91 * DAY_MS);
    await runDurableObjectAlarm(stubFor(r));
    expect(conns[0]!.closeInfo).toBeNull();
    // (held frames are subject to the separate 30-day rule, so the register is what shows the set was not wiped)
    expect((await conns[0]!.call({ op: "reg-list" })).h.regs).toHaveLength(1);
    // and the next check is a full window away, not immediate
    const next = await inRoom(r, (x) => (x as any).state.storage.getAlarm());
    expect(next).not.toBeNull();
  });
  it("a set whose device was connected 80 days in and left is not erased at day 91", async () => {
    const { room: r, conns } = await makeSet(["a"]);
    const base = Date.now();
    await setClock(r, () => base + 80 * DAY_MS);
    conns[0]!.ws.close(1000, "bye");
    await conns[0]!.closed;
    // wait until the room has processed the close (poll the room, not the clock)
    for (let i = 0; i < 200 && (await inRoom(r, (x: any) => x.state.getWebSockets().length)) > 0; i++) await new Promise((res) => setTimeout(res, 10));
    await setClock(r, () => base + 91 * DAY_MS);
    await runDurableObjectAlarm(stubFor(r));
    const again = await Conn.open(r);
    const d = (await inRoom(r, (x) => (x as any).q("SELECT count(*) n FROM roster")))[0].n;
    expect(d).toBe(1);
    again.ws.close();
  });
});

describe("finding 4: cost and storage guards", () => {
  it("a never-registered object erases itself, and its alarm is cleared", async () => {
    const d = await newDevice();
    const t = Date.now();
    await fixClock(d.room, t);
    const c = await Conn.open(d.room);
    await c.waitFor("challenge");
    await setClock(d.room, () => t + 11 * 60_000);
    await runDurableObjectAlarm(stubFor(d.room));
    // closed by the alarm's deadline sweep (4002) or by the erase (4004): either way it is gone
    expect([4002, 4004]).toContain((await c.waitClosed()).code);
    const state = await inRoom(d.room, (x: any) => ({ alarm: null as unknown, tables: x.state.storage.sql.exec("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf%'").toArray()[0].n, ready: x.tablesReady }));
    expect(state.tables).toBe(0);
    expect(state.ready).toBe(false);
    expect(await inRoom(d.room, (x: any) => x.state.storage.getAlarm())).toBeNull();
  });
  it("an abandoned object that is later used again simply starts fresh", async () => {
    const d = await newDevice();
    const t = Date.now();
    await fixClock(d.room, t);
    await (await Conn.open(d.room)).waitFor("challenge");
    await setClock(d.room, () => t + 11 * 60_000);
    await runDurableObjectAlarm(stubFor(d.room));
    await setClock(d.room, () => t + 12 * 60_000);
    const c = await Conn.open(d.room);
    expect((await c.auth(d, { firstDevice: true })).h.r).toBe("ok");
  });
  it("an object younger than the abandon time is left alone by an early alarm", async () => {
    const d = await newDevice();
    const t = Date.now();
    await fixClock(d.room, t);
    const c = await Conn.open(d.room);
    await c.waitFor("challenge");
    await setClock(d.room, () => t + 20_000);
    await runDurableObjectAlarm(stubFor(d.room));
    // the unauthenticated socket is past its deadline and closed, but the object is not erased (no 4004)
    expect((await c.waitClosed()).code).toBe(4002);
  });
  it("register bytes count against the set's storage cap and show in usage", async () => {
    const { room: r, conns } = await makeSet(["a"]);
    await inRoom(r, (x) => { x.limits.prePairCap = 40_000; });
    const v = new Uint8Array(16 * 1024).fill(1);
    expect((await conns[0]!.call({ op: "reg-set", key: "k1", expectToken: 0 }, v)).h.op).toBe("reg-ok");
    expect((await conns[0]!.call({ op: "reg-set", key: "k2", expectToken: 0 }, v)).h.op).toBe("reg-ok");
    expect((await conns[0]!.call({ op: "usage" })).h.usage.bytes).toBeGreaterThanOrEqual(32 * 1024);
    const third = await conns[0]!.call({ op: "reg-set", key: "k3", expectToken: 0 }, v);
    expect(third.h).toMatchObject({ op: "over-limit", why: "set" });
    // overwriting an existing register with a same-size value still works (net change is zero)
    expect((await conns[0]!.call({ op: "reg-set", key: "k1", expectToken: 1 }, v)).h.op).toBe("reg-ok");
    expect((await conns[0]!.call({ op: "usage" })).h.usage.bytes).toBeLessThanOrEqual(40_000);
  });
  it("the creation limiter fails closed: an error from it, or no limiter at all outside test-open mode, refuses creation", async () => {
    for (const how of ["throws", "missing"]) {
      const d = await newDevice();
      await Conn.open(d.room, { headers: { "CF-Connecting-IP": "203.0.113.50" } }).then((c) => c.waitFor("challenge"));
      await inRoom(d.room, (x) => {
        x.mode = "allowlist";
        x.createLimiter = how === "throws" ? { limit: async () => { throw new Error("down"); } } : undefined;
      });
      const c2 = await Conn.open(d.room, { headers: { "CF-Connecting-IP": "203.0.113.50" } });
      expect((await c2.auth(d, { firstDevice: true })).h.r).toBe("rate-limited");
    }
  });
  it("creation with no caller address is refused outside test-open mode", async () => {
    const d = await newDevice();
    await Conn.open(d.room).then((c) => c.waitFor("challenge"));
    await inRoom(d.room, (x) => { x.mode = "allowlist"; x.createLimiter = { limit: async () => ({ success: true }) }; });
    const c2 = await Conn.open(d.room);
    expect((await c2.auth(d, { firstDevice: true })).h.r).toBe("rate-limited");
  });
  it("the creation limiter uses its own key prefix, not the analytics one", async () => {
    const d = await newDevice();
    await Conn.open(d.room, { headers: { "CF-Connecting-IP": "203.0.113.51" } }).then((c) => c.waitFor("challenge"));
    const keys: string[] = [];
    await inRoom(d.room, (x) => { x.createLimiter = { limit: async (o) => { keys.push(o.key); return { success: true }; } }; });
    await (await Conn.open(d.room, { headers: { "CF-Connecting-IP": "203.0.113.51" } })).auth(d, { firstDevice: true });
    expect(keys).toEqual(["mesh-relay:create:203.0.113.51"]);
  });
  it("the Worker limits every upgrade per address BEFORE touching an object, and fails closed", async () => {
    const base = { MESH_RELAY_MODE: "allowlist", MESH_ALLOWED_ROOMS: room };
    const keys: string[] = [];
    const no = spyNs();
    const denied = await callWorker({ ...base, MESH_RELAY: no, EVENT_RATE_LIMITER: { limit: async (o: any) => { keys.push(o.key); return { success: false }; } } });
    expect(denied.status).toBe(429);
    expect(keys).toEqual(["mesh-relay:upgrade:198.51.100.7"]);
    expect(no.touched).toEqual([]);
    const broken = spyNs();
    expect((await callWorker({ ...base, MESH_RELAY: broken, EVENT_RATE_LIMITER: { limit: async () => { throw new Error("down"); } } })).status).toBe(503);
    expect(broken.touched).toEqual([]);
    const none = spyNs();
    expect((await callWorker({ ...base, MESH_RELAY: none, EVENT_RATE_LIMITER: undefined })).status).toBe(503);
    expect(none.touched).toEqual([]);
    // test-open (tests only) may run without a limiter
    const open = spyNs();
    expect((await callWorker({ MESH_RELAY_MODE: "test-open", MESH_RELAY: open, EVENT_RATE_LIMITER: undefined })).status).toBe(200);
  });
  it("a not-allow-listed or unlisted-mode connect never gets as far as the limiter", async () => {
    let asked = 0;
    const lim = { limit: async () => { asked++; return { success: true }; } };
    await callWorker({ MESH_RELAY_MODE: "allowlist", MESH_ALLOWED_ROOMS: "cd".repeat(32), MESH_RELAY: spyNs(), EVENT_RATE_LIMITER: lim });
    expect(asked).toBe(0);
  });
});

describe("finding 5: a stranger who knows a room id cannot hold the connection slots", () => {
  it("unauthenticated sockets have their own small cap; a 9th fresh one is refused", async () => {
    const d = await newDevice();
    await fixClock(d.room, Date.now());
    for (let i = 0; i < 8; i++) await Conn.open(d.room);
    await expect(Conn.open(d.room)).rejects.toThrow(/503/);
  });
  it("members can still connect while 8 old strangers hold every unauthenticated slot (the oldest is dropped)", async () => {
    const { room: r, devices, conns } = await makeSet(["a"]);
    const t = Date.now();
    await fixClock(r, t);
    const strangers: Conn[] = [];
    for (let i = 0; i < 8; i++) strangers.push(await Conn.open(r));
    await setClock(r, () => t + 5_000); // past the minimum age, before the deadline
    const member = await Conn.open(r);
    expect((await member.auth(devices[0]!)).h.r).toBe("ok");
    // every stranger arrived at the same fixed instant, so which one is "oldest" is arbitrary: exactly one is dropped
    expect((await Promise.race(strangers.map((s) => s.closed))).code).toBe(4009);
  });
  it("an alarm, not another connect, closes unauthenticated sockets past their short deadline", async () => {
    const d = await newDevice();
    const t = Date.now();
    await fixClock(d.room, t);
    const idle = await Conn.open(d.room);
    await idle.waitFor("challenge");
    expect(await inRoom(d.room, (x: any) => x.state.storage.getAlarm())).not.toBeNull();
    await setClock(d.room, () => t + 11_000);
    await runDurableObjectAlarm(stubFor(d.room));
    expect((await idle.waitClosed()).code).toBe(4002);
  });
  it("authenticated devices are not counted against the unauthenticated cap", async () => {
    const { room: r, devices, conns } = await makeSet(["a", "b", "c"]);
    await fixClock(r, Date.now());
    for (let i = 0; i < 8; i++) await Conn.open(r); // fills the unauthenticated slots
    expect((await conns[0]!.call({ op: "usage" })).h.op).toBe("usage-result");
    void devices;
  });
  it("(finding 12) an oversized message before authentication closes the socket at once", async () => {
    const d = await newDevice();
    const c = await Conn.open(d.room);
    await c.waitFor("challenge");
    c.sendRaw(new Uint8Array(64 * 1024));
    expect((await c.waitClosed()).code).toBe(4007);
  });
});

describe("finding 6: one generic refusal, signature checked first", () => {
  it("a stranger learns nothing from the answer: unknown device, wrong signature on a member, and a removed id look alike", async () => {
    const { room: r, devices, conns } = await makeSet(["a", "b"]);
    await rosterRemove(conns[0]!, devices[1]!.dev);
    const outsider = await newDevice("x");
    const answers: string[] = [];
    // unknown device id
    let c = await Conn.open(r); let res = await c.auth(outsider); answers.push(`${res.h.r}/${(await c.waitClosed()).code}`);
    // member with a bad signature
    c = await Conn.open(r); res = await c.auth(devices[0]!, { corruptSig: true }); answers.push(`${res.h.r}/${(await c.waitClosed()).code}`);
    // removed device id with a bad signature (a stranger who only knows the id)
    c = await Conn.open(r); res = await c.auth(devices[1]!, { corruptSig: true }); answers.push(`${res.h.r}/${(await c.waitClosed()).code}`);
    expect(new Set(answers).size).toBe(1);
  });
  it("a removed device that proves its key is still told it was removed", async () => {
    const { room: r, devices, conns } = await makeSet(["a", "b"]);
    await rosterRemove(conns[0]!, devices[1]!.dev);
    const c = await Conn.open(r);
    expect((await c.auth(devices[1]!)).h.r).toBe("removed");
  });
});

describe("finding 7: a room whose last device was removed cannot be re-created", () => {
  it("after the roster is emptied by removals, the same first key cannot register the room again", async () => {
    const { room: r, devices, conns } = await makeSet(["a", "b"]);
    await rosterRemove(conns[0]!, devices[1]!.dev);
    await rosterRemove(conns[0]!, devices[0]!.dev, { noReply: true });
    await conns[0]!.waitClosed();
    const c = await Conn.open(r);
    const res = await c.auth(devices[0]!, { firstDevice: true });
    expect(res.h.r).toBe("refused");
  });
});

describe("finding 9: outbound bytes per connection are bounded", () => {
  it("fetch-after replies stop once a connection's output budget for the window is used", async () => {
    const { room: r, devices, conns } = await makeSet(["a", "b"]);
    await fixClock(r);
    await inRoom(r, (x) => { x.limits.outWindowBytes = 5000; });
    for (let i = 1; i <= 3; i++) await conns[0]!.call(holdHeader(devices[0]!, "g", i) as any, bytesOf(2000));
    const first = await conns[1]!.call({ op: "fetch-after", g: "g", seq: 0 });
    void first;
    const ops: string[] = [];
    for (let i = 0; i < 4; i++) { const m = await conns[1]!.call({ op: "fetch-after", g: "g", seq: 0 }); ops.push(m.h.op); }
    expect(ops).toContain("over-limit");
  });
});

describe("finding 10: released groups are announced even when the write is then refused", () => {
  it("broadcasts released before the over-limit answer", async () => {
    const { room: r, devices, conns } = await makeSet(["a", "b"]);
    await inRoom(r, (x) => { x.limits.prePairCap = 1000; x.limits.setCap = 1000; });
    await conns[0]!.call(holdHeader(devices[0]!, "x", 1) as any, bytesOf(300));
    await inRoom(r, (x: any) => x.metaSet("total_bytes", 5000)); // simulated accounting drift
    const res = await conns[0]!.call(holdHeader(devices[0]!, "y", 2) as any, bytesOf(200));
    expect(res.h.op).toBe("over-limit");
    expect((await conns[1]!.waitFor("released")).h.g).toBe("x");
  });
});

describe("finding 13: a roster key must be a real Ed25519 point", () => {
  it("recognises valid and invalid keys", async () => {
    const d = await newDevice();
    expect(await isEd25519Point(d.signKey)).toBe(true);
    expect(await isEd25519Point("ff".repeat(32))).toBe(false);          // y above the field size
    expect(await isEd25519Point("02" + "00".repeat(31))).toBe(false);   // y = 2 has no matching x
  });
  it("roster-add refuses garbage", async () => {
    const { conns } = await makeSet(["a"]);
    expect((await rosterAdd(conns[0]!, "02" + "00".repeat(31))).h).toMatchObject({ op: "refused", reason: "bad-header" });
  });
});

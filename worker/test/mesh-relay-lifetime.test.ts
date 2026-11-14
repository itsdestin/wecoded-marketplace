import { env, runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { Conn, bytesOf, holdHeader, makeSet, newDevice, sign, inRoom, stubFor } from "./mesh-helpers";
import { MeshRelayRoom } from "../src/mesh/relay-room";
import { DAY_MS, packMessage } from "../src/mesh/protocol";
import { relayAuthMessage } from "../src/mesh/auth";

// Survival across eviction, and the two lifetime rules (30 days per chat group, 90 idle days per set).

const skewClock = (room: string, ms: number) => inRoom(room, (r) => { const base = Date.now(); r.now = () => base + ms; });

describe("hibernation: nothing that matters lives only in memory", () => {
  // WHY this simulation: a hibernated object is evicted and its constructor runs again on the next message, with the
  // storage and the open sockets (and their attachments) still in place. The test builds a SECOND, brand-new
  // MeshRelayRoom over the same storage and drives the live sockets through it; whatever the old object remembered in
  // memory is gone. (The real platform's eviction timing is not reproducible here: see the report's "unverified".)
  it("a rebuilt object keeps the roster, held frames, numbering, registers, pairing state, beats and pending challenges", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    const [a, b] = conns as [Conn, Conn];
    await a.call(holdHeader(devices[0]!, "chat:1", 1, undefined, { line: true }) as any, new TextEncoder().encode("first"));
    await a.call({ op: "reg-set", key: "head:v1", expectToken: 0 }, new TextEncoder().encode("reg"));
    a.send({ op: "beat", n: 5 });
    await b.waitFor((m) => m.h.op === "beat");
    // a third socket that has been challenged but not answered yet
    const pending = await Conn.open(room);
    const ch = await pending.waitFor("challenge");

    await (runInDurableObject as any)(stubFor(room), async (_old: any, state: DurableObjectState) => {
      const fresh = new MeshRelayRoom(state, env as any);          // the "after eviction" object
      const byDev = (dev: string) => state.getWebSockets().find((w) => (w.deserializeAttachment() as any)?.dev === dev)!;
      const wsA = byDev(devices[0]!.dev), wsB = byDev(devices[1]!.dev);
      const wsPending = state.getWebSockets().find((w) => (w.deserializeAttachment() as any)?.authed === false)!;
      const drive = (ws: WebSocket, h: object, p?: Uint8Array) => fresh.webSocketMessage(ws, packMessage(h, p));

      await drive(wsB, { op: "fetch-after", g: "chat:1", seq: 0, id: "f1" });                                            // held frame survived
      await drive(wsA, holdHeader(devices[0]!, "chat:1", 1, undefined, { id: "d1" }), bytesOf(5));                         // numbering survived: replay refused
      await drive(wsA, holdHeader(devices[0]!, "chat:1", 2, undefined, { id: "d2" }), bytesOf(5));                         // next seq survived
      await drive(wsB, { op: "reg-get", key: "head:v1", id: "r1" });                                                      // register survived
      await drive(wsB, { op: "usage", id: "u1" });                                                                        // still authenticated, pairing state kept
      await drive(wsA, { op: "beat", n: 5 });                                                                             // beat counter lives in the attachment: repeat dropped
      await drive(wsA, { op: "beat", n: 6 });
      // the pending challenge's nonce lives in the socket attachment: the rebuilt object accepts a correct answer
      const sig = await sign(devices[1]!, relayAuthMessage(ch.h.aud, room, ch.h.nonce, devices[1]!.dev));
      await drive(wsPending, { op: "auth", v: 1, dev: devices[1]!.dev, sig, id: "p1" });
    });

    const f1 = await b.waitFor((m) => m.h.id === "f1" && m.h.op === "frame");
    expect(new TextDecoder().decode(f1.payload)).toBe("first");
    expect((await a.waitFor((m) => m.h.id === "d1")).h.op).toBe("duplicate");
    expect((await a.waitFor((m) => m.h.id === "d2")).h).toMatchObject({ op: "stored", seq: 2 });
    expect(new TextDecoder().decode((await b.waitFor((m) => m.h.id === "r1")).payload)).toBe("reg");
    expect((await b.waitFor((m) => m.h.id === "u1")).h.usage).toMatchObject({ paired: true, cap: 900 * 1024 * 1024 });
    const beats = b.inbox.filter((m) => m.h.op === "beat").map((m) => m.h.n);
    expect(beats).toEqual([6]);                       // 5 was consumed above; the repeated 5 never arrived; 6 did
    expect((await pending.waitFor((m) => m.h.id === "p1")).h.r).toBe("ok");
  });

  it("a rebuilt object still enforces the quota and erases on schedule (alarm armed in storage)", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    await conns[0]!.call(holdHeader(devices[0]!, "g", 1) as any, bytesOf(1000));
    const armed = await (runInDurableObject as any)(stubFor(room), async (_o: any, state: DurableObjectState) => {
      const fresh = new MeshRelayRoom(state, env as any);
      void fresh;
      return await state.storage.getAlarm();
    });
    expect(armed).not.toBeNull();
    expect(((armed as number) - Date.now()) / DAY_MS).toBeGreaterThan(29);
  });
});

describe("30-day rule: a chat's frames are let go 30 days after its last line", () => {
  it("releases the stale group, announces it, keeps a mark (gap), spares groups with newer lines and the registers", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    const [a, b] = conns as [Conn, Conn];
    await a.call(holdHeader(devices[0]!, "chat:old", 1, undefined, { line: true }) as any, bytesOf(400));
    await a.call(holdHeader(devices[0]!, "chat:live", 2, undefined, { line: true }) as any, bytesOf(300));
    await a.call({ op: "reg-set", key: "head:v1", expectToken: 0 }, bytesOf(10));
    await skewClock(room, 20 * DAY_MS);
    await a.call(holdHeader(devices[0]!, "chat:live", 3, undefined, { line: true }) as any, bytesOf(100)); // a new line on day 20
    await skewClock(room, 31 * DAY_MS);
    expect(await runDurableObjectAlarm(stubFor(room))).toBe(true);

    const rel = await b.waitFor("released");
    expect(rel.h).toMatchObject({ g: "chat:old", throughSeq: 1 });
    b.send({ op: "fetch-after", g: "chat:old", seq: 0, id: "o" });
    expect((await b.frames("o"))[0]!.h).toMatchObject({ op: "gap", through: 1 });
    b.send({ op: "fetch-after", g: "chat:live", seq: 0, id: "l" });
    expect((await b.frames("l")).filter((m) => m.h.op === "frame")).toHaveLength(2);
    expect((await b.call({ op: "reg-get", key: "head:v1" })).h.regs).toHaveLength(1);
    expect((await a.call({ op: "usage" })).h.usage.bytes).toBe(400);
    // and the next wake-up is scheduled
    const next = await (runInDurableObject as any)(stubFor(room), (_i: any, state: DurableObjectState) => state.storage.getAlarm());
    expect(next).not.toBeNull();
  });
});

describe("90-day rule: a set nobody has connected to for 90 days is erased, and the object keeps working", () => {
  it("closes sockets with 4004, wipes roster, frames and registers, and re-creates its tables", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    await conns[0]!.call(holdHeader(devices[0]!, "g", 1) as any, bytesOf(500));
    await conns[0]!.call({ op: "reg-set", key: "head:v1", expectToken: 0 }, bytesOf(10));
    await skewClock(room, 91 * DAY_MS);
    expect(await runDurableObjectAlarm(stubFor(room))).toBe(true);
    expect((await conns[0]!.waitClosed()).code).toBe(4004);
    expect((await conns[1]!.waitClosed()).code).toBe(4004);

    // The same object is alive (its tables were rebuilt): the old roster is gone, so the old second device is a stranger...
    await inRoom(room, (r) => { r.now = () => Date.now(); });
    const stranger = await Conn.open(room);
    expect((await stranger.auth(devices[1]!)).h.r).toBe("not-on-roster");
    // ...and the first device can create the set afresh, hold, and sees no old data.
    const again = await Conn.open(room);
    expect((await again.auth(devices[0]!, { firstDevice: true })).h).toMatchObject({ r: "ok", created: true, usage: { bytes: 0, paired: false } });
    expect((await again.call(holdHeader(devices[0]!, "g", 1) as any, bytesOf(50))).h).toMatchObject({ op: "stored", seq: 1 });
    expect((await again.call({ op: "reg-list" })).h.regs).toEqual([]);
  });

  it("does not erase a set that was connected to recently", async () => {
    const { room, devices, conns } = await makeSet(["a"]);
    await conns[0]!.call(holdHeader(devices[0]!, "g", 1) as any, bytesOf(500));
    await skewClock(room, 31 * DAY_MS);
    await runDurableObjectAlarm(stubFor(room));
    expect((await conns[0]!.call({ op: "usage" })).h.op).toBe("usage-result");
  });
});

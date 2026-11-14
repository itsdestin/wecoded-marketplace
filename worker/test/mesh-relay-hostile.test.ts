/// <reference types="vite/client" />
import { env, runInDurableObject } from "cloudflare:test";
import { describe, it, expect, vi } from "vitest";
import { Conn, bytesOf, holdHeader, makeSet, newDevice, inRoom, stubFor } from "./mesh-helpers";
import { MAX_MESSAGE_BYTES, packMessage } from "../src/mesh/protocol";
import type { MeshRelayRoom } from "../src/mesh/relay-room";

// Hostile clients against the Mesh relay: replay, forged sender, oversize, wrong set, flood, malformed input,
// and the no-logging guarantee.

const usage = async (c: Conn) => (await c.call({ op: "usage" })).h.usage;

describe("replay and forgery", () => {
  it("stores a replayed frame once: the same (sender, session, number) comes back as `duplicate`", async () => {
    const { devices, conns } = await makeSet(["a", "b"]);
    const a = conns[0]!;
    const body = bytesOf(300);
    expect((await a.call(holdHeader(devices[0]!, "g", 5) as any, body)).h.op).toBe("stored");
    expect((await a.call(holdHeader(devices[0]!, "g", 5) as any, body)).h).toMatchObject({ op: "duplicate", n: 5 });
    expect((await a.call(holdHeader(devices[0]!, "g", 4) as any, body)).h.op).toBe("duplicate"); // older number
    expect((await usage(a)).bytes).toBe(300);
  });

  it("a replay from a second connection of the same device is also refused", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    await conns[0]!.call(holdHeader(devices[0]!, "g", 1) as any, bytesOf(100));
    const other = await Conn.open(room);
    await other.auth(devices[0]!);
    expect((await other.call(holdHeader(devices[0]!, "g", 1) as any, bytesOf(100))).h.op).toBe("duplicate");
  });

  it("a new run session starts again from 1 without being mistaken for a replay", async () => {
    const { devices, conns } = await makeSet(["a"]);
    expect((await conns[0]!.call(holdHeader(devices[0]!, "g", 1, "a".repeat(32)) as any, bytesOf(10))).h.op).toBe("stored");
    expect((await conns[0]!.call(holdHeader(devices[0]!, "g", 1, "b".repeat(32)) as any, bytesOf(10))).h.op).toBe("stored");
  });

  it("failed holds do not use up the sender's number (a retry after `full` still works)", async () => {
    const { room, devices, conns } = await makeSet(["a"]);
    await inRoom(room, (r) => { r.limits.maxFrame = 100; });
    expect((await conns[0]!.call(holdHeader(devices[0]!, "g", 1) as any, bytesOf(200))).h.op).toBe("over-limit");
    expect((await conns[0]!.call(holdHeader(devices[0]!, "g", 1) as any, bytesOf(50))).h.op).toBe("stored");
  });

  it("refuses a frame claiming to be from another device", async () => {
    const { devices, conns } = await makeSet(["a", "b"]);
    const r = await conns[0]!.call(holdHeader(devices[1]!, "g", 1) as any, bytesOf(100)); // header says b, connection is a
    expect(r.h).toMatchObject({ op: "refused", reason: "forged-sender" });
    expect((await usage(conns[0]!)).bytes).toBe(0);
  });

  it("stamps live frames with the proven sender, ignoring a forged `from`", async () => {
    const { devices, conns } = await makeSet(["a", "b"]);
    conns[0]!.send({ op: "pass", g: "live", to: "all", from: devices[1]!.dev }, bytesOf(5));
    expect((await conns[1]!.waitFor("pass")).h.from).toBe(devices[0]!.dev);
  });

  it("a device of one set cannot reach another set's frames or rooms", async () => {
    const one = await makeSet(["a", "b"]);
    const two = await makeSet(["x", "y"]);
    await one.conns[0]!.call(holdHeader(one.devices[0]!, "chat:secret", 1) as any, bytesOf(100));
    // set two asks for the same group name: its own room is separate and empty
    two.conns[0]!.send({ op: "fetch-after", g: "chat:secret", seq: 0, id: "z" });
    expect((await two.conns[0]!.frames("z")).map((m) => m.h.op)).toEqual(["frames-end"]);
    // a member of set one cannot sign into set two's room
    const c = await Conn.open(two.room);
    expect((await c.auth(one.devices[0]!)).h.r).toBe("not-on-roster");
  });

  it("a removed device cannot use a stolen live socket's authority for anything", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    await conns[0]!.call({ op: "roster-remove", dev: devices[1]!.dev });
    expect((await conns[1]!.waitClosed()).code).toBe(4003);
    const c = await Conn.open(room);
    expect((await c.auth(devices[1]!)).h.r).toBe("removed");
  });
});

describe("oversize", () => {
  it("closes a message bigger than frame plus header limit with 4007, before parsing it", async () => {
    const { devices, conns } = await makeSet(["a"]);
    conns[0]!.send(holdHeader(devices[0]!, "g", 1), new Uint8Array(MAX_MESSAGE_BYTES + 1));
    expect((await conns[0]!.waitClosed()).code).toBe(4007);
  });
  it("refuses a header that claims an enormous length", async () => {
    const { conns } = await makeSet(["a"]);
    const b = new Uint8Array(20); new DataView(b.buffer).setUint32(0, 0xffffffff);
    conns[0]!.sendRaw(b);
    expect((await conns[0]!.waitClosed()).code).toBe(4006);
  });
  it("refuses an oversized header (over 8 KiB) even when the length is honest", async () => {
    const { conns } = await makeSet(["a"]);
    conns[0]!.send({ op: "usage", pad: "x".repeat(9000) });
    expect((await conns[0]!.waitClosed()).code).toBe(4006);
  });
});

describe("flood", () => {
  it("closes a connection that sends more than 300 messages in 10 seconds", async () => {
    const { conns } = await makeSet(["a"]);
    for (let i = 0; i < 400; i++) conns[0]!.send({ op: "usage" });
    // WHY a long wait: the client sees the close only after it has dispatched the replies already queued, which is slow on a busy machine.
    expect((await conns[0]!.waitClosed(20_000)).code).toBe(4008);
  }, 30_000);
  it("answers holds beyond 100 in 10 seconds with over-limit `rate` and stores no more", async () => {
    const { devices, conns } = await makeSet(["a", "b"]);
    const a = conns[0]!;
    for (let i = 1; i <= 130; i++) a.send({ ...holdHeader(devices[0]!, "g", i), id: `h${i}` }, bytesOf(10));
    const results: string[] = [];
    for (let i = 1; i <= 130; i++) results.push((await a.waitFor((m) => m.h.id === `h${i}`, 10_000)).h.op);
    expect(results.filter((r) => r === "stored")).toHaveLength(100);
    expect(results.filter((r) => r === "over-limit")).toHaveLength(30);
    expect((await usage(a)).bytes).toBe(1000);
  }, 30_000);
  it("one flooding connection does not stop another device's use of the set", async () => {
    const { conns } = await makeSet(["a", "b"]);
    for (let i = 0; i < 400; i++) conns[0]!.send({ op: "usage" });
    await conns[0]!.waitClosed(20_000);
    expect((await conns[1]!.call({ op: "usage" })).h.op).toBe("usage-result");
  });
  it("sockets that never answer their challenge are swept and do not exhaust the connection slots", async () => {
    const d = await newDevice();
    const idle: Conn[] = [];
    for (let i = 0; i < 64; i++) idle.push(await Conn.open(d.room));
    await Conn.open(d.room).then(
      () => { throw new Error("65th connection should be refused while 64 are fresh"); },
      (e) => expect(String(e)).toMatch(/503/),
    );
    await inRoom(d.room, (r) => { const t = Date.now(); r.now = () => t + 31_000; });
    const ok = await Conn.open(d.room); // sweep closes the stale ones first
    expect((await ok.auth(d, { firstDevice: true })).h.r).toBe("ok");
    expect((await idle[0]!.waitClosed()).code).toBe(4002);
  });
});

describe("malformed input", () => {
  // Deterministic pseudo-random bytes so a failure can be reproduced.
  function prng(seed: number) { return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const GOOD_CLOSES = new Set([4001, 4006, 4007]);

  it("random bytes and text before authentication close the socket cleanly, never with an internal error", async () => {
    const d = await newDevice();
    const rnd = prng(1234);
    for (let i = 0; i < 40; i++) {
      const c = await Conn.open(d.room);
      await c.waitFor("challenge");
      if (i % 5 === 0) c.ws.send("not binary at all");
      else c.sendRaw(Uint8Array.from({ length: Math.floor(rnd() * 3000) }, () => Math.floor(rnd() * 256)));
      const info = await c.waitClosed();
      expect(GOOD_CLOSES.has(info.code)).toBe(true);
    }
    expect((await (await Conn.open(d.room)).auth(d, { firstDevice: true })).h.r).toBe("ok");
  }, 30_000);

  it("random bytes after authentication close the socket cleanly", async () => {
    const { room, devices } = await makeSet(["a"]);
    const rnd = prng(99);
    for (let i = 0; i < 30; i++) {
      const c = await Conn.open(room);
      await c.auth(devices[0]!);
      c.sendRaw(Uint8Array.from({ length: 1 + Math.floor(rnd() * 2000) }, () => Math.floor(rnd() * 256)));
      expect(GOOD_CLOSES.has((await c.waitClosed()).code)).toBe(true);
    }
  }, 30_000);

  it("well-framed messages with hostile field values never crash the relay or close it with an internal error", async () => {
    const { room, devices } = await makeSet(["a", "b"]);
    const weird: unknown[] = [null, true, false, 0, -1, 1.5, 2 ** 60, NaN, "", "x".repeat(5000), "ff".repeat(32), ["a"], { a: 1 }, [[[[]]]]];
    const ops = ["hold", "fetch-after", "received", "drop-group", "reg-get", "reg-list", "reg-set", "presence", "pass", "beat", "roster-add", "roster-remove", "usage", "does-not-exist"];
    const fields = ["g", "key", "seq", "through", "n", "from", "session", "to", "dev", "signKey", "expectToken", "sinceRev", "line", "id", "v", "sig"];
    for (const op of ops) {
      const c = await Conn.open(room);
      await c.auth(devices[0]!);
      for (const v of weird) {
        const h: Record<string, unknown> = { op };
        for (const f of fields) h[f] = v;
        c.send(h, v === 0 ? new Uint8Array(0) : bytesOf(5));
      }
      // The relay is still answering after the barrage: a clean `usage` round trip.
      const probe = await Conn.open(room);
      await probe.auth(devices[1]!);
      expect((await probe.call({ op: "usage" })).h.op).toBe("usage-result");
      const closed = await Promise.race([c.closed, new Promise<null>((r) => setTimeout(() => r(null), 100))]);
      if (closed) expect(closed.code).not.toBe(1011);
    }
  }, 60_000);

  it("never stores anything for a malformed hold", async () => {
    const { devices, conns } = await makeSet(["a"]);
    const a = conns[0]!;
    for (const bad of [
      { g: "", from: devices[0]!.dev, session: "a".repeat(32), n: 1 },
      { g: "ok", from: devices[0]!.dev, session: "short", n: 1 },
      { g: "ok", from: devices[0]!.dev, session: "a".repeat(32), n: 0 },
      { g: "ok", from: devices[0]!.dev, session: "a".repeat(32), n: "1" },
      { g: "has space", from: devices[0]!.dev, session: "a".repeat(32), n: 1 },
    ]) expect((await a.call({ op: "hold", ...bad } as any, bytesOf(10))).h.op).toBe("refused");
    expect((await usage(a)).bytes).toBe(0);
  });
});

describe("the relay never logs frame bodies, keys or full ids", () => {
  it("logs nothing that contains content, keys, signatures or ids, across hostile and normal traffic", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    try {
      const { room, devices, conns } = await makeSet(["a", "b"]);
      const MARK = "SECRET-FRAME-BODY-0123456789";
      const body = new TextEncoder().encode(MARK);
      await conns[0]!.call(holdHeader(devices[0]!, "chat:marker-group", 1) as any, body);
      await conns[0]!.call({ op: "reg-set", key: "head:marker-key", expectToken: 0 }, body);
      await conns[0]!.call(holdHeader(devices[1]!, "g", 2) as any, body);                 // forged
      conns[1]!.sendRaw(new Uint8Array(40).fill(0xee));                                      // malformed
      await conns[1]!.waitClosed();
      await conns[0]!.call({ op: "roster-remove", dev: devices[1]!.dev });
      const bad = await Conn.open(room); await bad.auth(devices[1]!);                        // removed device returns
      conns[0]!.send({ op: "roster-remove", dev: devices[0]!.dev });                         // erase path logs its one line
      await conns[0]!.waitClosed();
      await new Promise((r) => setTimeout(r, 50));
      const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" "))).join("\n");
      // Sanity: the spy does see the relay (its one "erased" line), so the empty result is meaningful.
      expect(logged).toContain("mesh-relay erased");
      for (const secret of [MARK, "marker-group", "marker-key", room, devices[0]!.signKey, devices[1]!.signKey, devices[0]!.dev, devices[1]!.dev]) {
        expect(logged).not.toContain(secret);
      }
    } finally { spies.forEach((s) => s.mockRestore()); }
  });

  it("structurally: the relay source has exactly one console call, and it is the truncated-prefix logger", () => {
    const sources = import.meta.glob("../src/mesh/*.ts", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const files = Object.keys(sources);
    expect(files.length).toBeGreaterThanOrEqual(4);
    const calls = files.flatMap((f) => (sources[f]!.match(/console\.\w+\(.*$/gm) ?? []).map((l) => `${f}: ${l}`));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/relay-room\.ts: console\.log\(`mesh-relay \$\{event\} room=\$\{\(room \?\? ""\)\.slice\(0, 8\)\}`\);/);
    // And no other output channel sneaks in.
    for (const f of files) expect(sources[f]).not.toMatch(/\b(console\[|process\.stdout|await fetch\(|\.waitUntil\()/);
  });
});

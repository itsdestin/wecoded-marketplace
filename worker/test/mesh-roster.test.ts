import { describe, expect, it } from "vitest";
import vectors from "./mesh-roster-vectors.json";
import { Conn, bytesOf, holdHeader, inRoom, makeSet, newDevice, rosterAdd, rosterPut, rosterRemove, sign } from "./mesh-helpers";
import { bytesToHex, hexToBytes, rosterStatementMessage, verifyEd25519 } from "../src/mesh/auth";
import { randomHex } from "../src/mesh/auth";

// Signed roster changes (review finding 8): the relay accepts a roster change only as a statement signed by a CURRENT member.

describe("roster statement: known answers shared with the app", () => {
  it("rebuilds every vector's message bytes and verifies its signature with the Worker's own encoder and WebCrypto", async () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(4);
    for (const c of vectors.cases) {
      const s = c.statement;
      const msg = rosterStatementMessage({ kind: s.kind as "add" | "remove", room: s.room, signer: s.signer, target: s.target, targetKey: s.targetKey, entry: s.entry, seen: s.seen, at: s.at });
      expect(bytesToHex(msg), c.name).toBe(c.messageHex);
      expect(await verifyEd25519(vectors.signerSignKey, msg, c.sigHex), c.name).toBe(true);
      const bad = new Uint8Array(msg); bad[bad.length - 1]! ^= 1;
      expect(await verifyEd25519(vectors.signerSignKey, bad, c.sigHex), `${c.name} tampered`).toBe(false);
    }
  });
});

describe("roster-put", () => {
  it("a member's signed add lets the new device in, and the other members hear of it", async () => {
    const { room, conns } = await makeSet(["a", "b"]);
    const late = await newDevice("late");
    const r = await rosterAdd(conns[0]!, late);
    expect(r.h).toMatchObject({ op: "ok", dev: late.dev });
    expect((await conns[1]!.waitFor("roster-changed")).h).toMatchObject({ change: "added", dev: late.dev });
    const c = await Conn.open(room);
    expect((await c.auth(late)).h.r).toBe("ok");
  });

  it("the old unsigned roster-add and roster-remove are gone (answered as unknown ops, nothing changes)", async () => {
    const { devices, conns } = await makeSet(["a"]);
    const other = await newDevice();
    expect((await conns[0]!.call({ op: "roster-add", signKey: other.signKey })).h).toMatchObject({ op: "error", reason: "unknown-op" });
    expect((await conns[0]!.call({ op: "roster-remove", dev: devices[0]!.dev })).h).toMatchObject({ op: "error", reason: "unknown-op" });
    expect(((await conns[0]!.call({ op: "presence" })).h.devices as string[])).toEqual([devices[0]!.dev]);
  });

  it("refuses a bad signature, a statement meant for another room, and a changed field (nothing is added)", async () => {
    const { devices, conns } = await makeSet(["a", "b"]);
    const victim = await newDevice();
    expect((await rosterAdd(conns[0]!, victim, { corruptSig: true })).h.reason).toBe("bad-signature");
    // signed for a DIFFERENT room (the room is inside the signed bytes): replaying it here fails
    expect((await rosterAdd(conns[0]!, victim, { room: "ab".repeat(32) })).h.reason).toBe("bad-signature");
    // the signature is for `victim`; point the same signature at another key
    const other = await newDevice();
    const msg = rosterStatementMessage({ kind: "add", room: conns[0]!.room, signer: devices[0]!.dev, target: victim.dev, targetKey: victim.signKey, entry: "11".repeat(32), seen: ["22".repeat(32)], at: 5 });
    const sig = await sign(devices[0]!, msg);
    const r = await conns[0]!.call({ op: "roster-put", kind: "add", signer: devices[0]!.dev, target: other.dev, targetKey: other.signKey, entry: "11".repeat(32), seen: ["22".repeat(32)], at: 5, sig });
    expect(r.h.reason).toBe("bad-signature");
    expect(await inRoom(conns[0]!.room, (r2) => (r2 as any).activeDevices().length)).toBe(2);
  });

  it("refuses a statement signed by someone who is not on the roster, even with a perfect signature", async () => {
    const { conns } = await makeSet(["a"]);
    const stranger = await newDevice("stranger");
    const victim = await newDevice();
    expect((await rosterAdd(conns[0]!, victim, { signer: stranger })).h.reason).toBe("not-a-member");
  });

  it("a replayed statement is refused (each entry id is accepted once)", async () => {
    const { conns } = await makeSet(["a"]);
    const d = await newDevice();
    const entry = randomHex(32);
    expect((await rosterAdd(conns[0]!, d, { entry })).h.op).toBe("ok");
    const again = await newDevice();
    expect((await rosterAdd(conns[0]!, again, { entry })).h.reason).toBe("duplicate");
  });

  it("never overwrites an existing device's key, and never re-adds a removed id", async () => {
    const { devices, conns, room } = await makeSet(["a", "b", "c"]);
    expect((await rosterAdd(conns[0]!, devices[1]!)).h.reason).toBe("already-member");
    // a different key cannot take b's id: the id must derive from the key
    const mallory = await newDevice();
    const forged = await conns[0]!.call({ op: "roster-put", kind: "add", signer: devices[0]!.dev, target: devices[1]!.dev, targetKey: mallory.signKey, entry: randomHex(32), seen: ["33".repeat(32)], at: 1, sig: "00".repeat(64) });
    expect(forged.h.reason).toBe("bad-header");
    expect(await inRoom(room, (r) => (r as any).q(`SELECT sign_key FROM roster WHERE dev=?`, devices[1]!.dev)[0].sign_key)).toBe(devices[1]!.signKey);
    expect((await rosterRemove(conns[0]!, devices[2]!.dev)).h.op).toBe("ok");
    expect((await rosterAdd(conns[0]!, devices[2]!)).h.reason).toBe("banned");
  });

  it("a removed device is closed, cannot sign back in, and cannot re-add itself or anyone else", async () => {
    const { devices, conns, room } = await makeSet(["a", "b", "c"]);
    const [a, b] = conns as [Conn, Conn, Conn];
    expect((await rosterRemove(a, devices[1]!.dev)).h.op).toBe("ok");
    expect((await b.waitClosed()).code).toBe(4003);
    const back = await Conn.open(room);
    expect((await back.auth(devices[1]!)).h.r).toBe("removed");
    // b's perfectly valid signature, carried by a still-connected member: the signer is no longer a member
    const friend = await newDevice();
    expect((await rosterAdd(a, friend, { signer: devices[1]! })).h.reason).toBe("signer-removed");
    expect((await rosterAdd(a, devices[1]!, { signer: devices[1]! })).h.reason).toBe("signer-removed");
    expect(await inRoom(room, (r) => (r as any).activeDevices().length)).toBe(2);
  });

  it("checks the stated ancestry: unknown history, a first statement from a non-creator, and a history that never admitted the signer", async () => {
    const { devices, conns } = await makeSet(["a", "b"]);
    const x = await newDevice();
    // history that leads nowhere the relay knows
    expect((await rosterAdd(conns[1]!, x, { seen: ["99".repeat(32)] })).h.reason).toBe("bad-ancestry");
    // b's statement that cites only a's genesis (not the entry that admitted b): b's admission is not in its ancestry
    const genesis = await inRoom(conns[0]!.room, (r) => (r as any).q(`SELECT entry FROM rintro WHERE dev=?`, devices[0]!.dev)[0].entry as string);
    expect((await rosterAdd(conns[1]!, x, { seen: [genesis] })).h.reason).toBe("bad-ancestry");
    // and the honest statement still works
    expect((await rosterAdd(conns[1]!, x)).h.op).toBe("ok");
    // malformed shapes
    expect((await rosterPut(conns[0]!, "remove", { dev: x.dev }, { seen: [] })).h.reason).toBe("bad-header");
    expect((await conns[0]!.call({ op: "roster-put", kind: "nope" })).h.reason).toBe("bad-header");
  });

  it("only the room's creator can make its first statement", async () => {
    const a = await newDevice();
    const c = await Conn.open(a.room);
    await c.auth(a, { firstDevice: true });
    const stranger = await newDevice();
    // a stranger's statement never reaches the ancestry step (not a member); the creator's with two seen ids is refused
    expect((await rosterAdd(c, await newDevice(), { signer: stranger })).h.reason).toBe("not-a-member");
    expect((await rosterAdd(c, await newDevice(), { seen: ["44".repeat(32), "55".repeat(32)] })).h.reason).toBe("bad-ancestry");
    expect((await rosterAdd(c, await newDevice())).h.op).toBe("ok");
  });

  it("removing the last device still retires the room (the retired-room rule is kept)", async () => {
    const { devices, conns, room } = await makeSet(["a"]);
    await rosterRemove(conns[0]!, devices[0]!.dev, { noReply: true });
    expect((await conns[0]!.waitClosed()).code).toBe(4003);
    await new Promise((r) => setTimeout(r, 30));
    const again = await Conn.open(room);
    expect((await again.auth(devices[0]!, { firstDevice: true })).h.r).toBe("refused");
  });
});

describe("doorbell", () => {
  it("a stored frame rings every OTHER connected member with only the group and the number", async () => {
    const { devices, conns } = await makeSet(["a", "b", "c"]);
    const [a, b, c] = conns as [Conn, Conn, Conn];
    const body = bytesOf(5000);
    const stored = await a.call(holdHeader(devices[0]!, "chat:x", 1) as any, body);
    expect(stored.h.op).toBe("stored");
    for (const m of [await b.waitFor("doorbell"), await c.waitFor("doorbell")]) {
      expect(Object.keys(m.h).sort()).toEqual(["g", "op", "seq"]);
      expect(m.h).toMatchObject({ g: "chat:x", seq: stored.h.seq });
      expect(m.payload.byteLength).toBe(0);
    }
    expect(a.inbox.some((m) => m.h.op === "doorbell")).toBe(false);
    // numbered: the second frame rings with the next number
    const second = await a.call(holdHeader(devices[0]!, "chat:x", 2) as any, bytesOf(10));
    expect((await b.waitFor("doorbell")).h.seq).toBe(second.h.seq);
  });

  it("a refused or duplicate hold rings nothing", async () => {
    const { devices, conns } = await makeSet(["a", "b"]);
    const [a, b] = conns as [Conn, Conn];
    await a.call(holdHeader(devices[0]!, "g", 1) as any, bytesOf(10));
    await b.waitFor("doorbell");
    expect((await a.call(holdHeader(devices[0]!, "g", 1) as any, bytesOf(10))).h.op).toBe("duplicate");
    expect((await a.call(holdHeader(devices[1]!, "g", 5) as any, bytesOf(10))).h.reason).toBe("forged-sender");
    await new Promise((r) => setTimeout(r, 30));
    expect(b.inbox.filter((m) => m.h.op === "doorbell")).toHaveLength(0);
  });
});

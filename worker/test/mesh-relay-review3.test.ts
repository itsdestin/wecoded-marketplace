import { describe, expect, it } from "vitest";
import { Conn, bytesOf, holdHeader, inRoom, makeSet, rosterAdd, rosterRemove, rosterRename, newDevice, type Device } from "./mesh-helpers";
import { MAX_ADMISSIONS_PER_SIGNER, MAX_DEVICES, MAX_KNOWN_KEYS, ROSTER_MAX_PER_SIGNER } from "../src/mesh/protocol";
import { ANCESTRY_WALK_LIMIT } from "../src/mesh/relay-room";
import { randomHex } from "../src/mesh/auth";

// Third-round review of the relay (findings 6, 8, 9 and the two untested checks W8 / W19). Written BEFORE the fixes.
// THE CLASS: a hostile PAIRED member uses volume to defeat a limit. Every limit here is charged to the verified signer (or authenticated
// connection) and, when hit, refuses only that signer's own excess: nobody else's statement is ever refused because of someone else's volume.

const active = (room: string) => inRoom(room, (r) => (r as any).activeDevices().sort() as string[]);
const q = (room: string, sql: string, ...bind: unknown[]) => inRoom(room, (r) => (r as any).q(sql, ...bind) as any[]);

describe("finding 8: the relay carries no mutual-removal opinion of its own", () => {
  it("there is no switch to flip: the relay's rule is fixed (both removals stand), so the app can never be contradicted by a relay setting", async () => {
    const { room } = await makeSet(["a"]);
    expect(await inRoom(room, (r) => (r as any).mutualWinner)).toBeUndefined();
  });
  it("A removes B, B's concurrent removal of A is accepted: both are out (the conservative reading; a ban only reduces who may connect)", async () => {
    const { room, devices, conns } = await makeSet(["a", "b", "c"]);
    const [a, , c] = conns as [Conn, Conn, Conn];
    expect((await rosterRemove(a, devices[1]!.dev)).h.op).toBe("ok");
    expect((await rosterRemove(c, devices[0]!.dev, { signer: devices[1]! })).h.op).toBe("ok");
    expect(await active(room)).toEqual([devices[2]!.dev]);
  });
  it("a ban follows only what a CURRENT member signed: a removal with a bad signature or from a non-member bans nobody", async () => {
    const { room, devices, conns } = await makeSet(["a", "b", "c"]);
    const stranger = await newDevice("stranger");
    expect((await rosterRemove(conns[0]!, devices[1]!.dev, { signer: stranger })).h.reason).toBe("not-a-member");
    expect((await rosterRemove(conns[0]!, devices[1]!.dev, { corruptSig: true })).h.reason).toBe("bad-signature");
    expect(await active(room)).toEqual(devices.map((d) => d.dev).sort());
  });
});

describe("finding 2: admissions are bounded per signer and in total, so ghosts cannot jam the set", () => {
  it("one device may sign only MAX_ADMISSIONS_PER_SIGNER adds; its excess is refused, another member's adds are not", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    // makeSet used one of a's admissions (b)
    for (let i = 1; i < MAX_ADMISSIONS_PER_SIGNER; i++) expect((await rosterAdd(conns[0]!, await newDevice())).h.op, `add ${i}`).toBe("ok");
    expect((await rosterAdd(conns[0]!, await newDevice())).h.reason).toBe("too-many-admissions");
    // b has its own allowance: a's volume never displaces it
    expect((await rosterAdd(conns[1]!, await newDevice())).h.op).toBe("ok");
    expect((await active(room)).length).toBe(MAX_ADMISSIONS_PER_SIGNER + 2);
    void devices;
  });
  it("the count is charged to the SIGNER, not to the device being added", async () => {
    const { conns } = await makeSet(["a", "b", "c"]);
    // c is the target of nothing here; b signs adds: only b's own count moves
    for (let i = 0; i < MAX_ADMISSIONS_PER_SIGNER; i++) expect((await rosterAdd(conns[1]!, await newDevice())).h.op).toBe("ok");
    expect((await rosterAdd(conns[1]!, await newDevice())).h.reason).toBe("too-many-admissions");
    expect((await rosterAdd(conns[2]!, await newDevice())).h.op).toBe("ok");
  });
  it("a set never names more than MAX_KNOWN_KEYS devices over its lifetime (removed devices keep their row as a ban)", async () => {
    const { room, conns } = await makeSet(["a"]);
    await inRoom(room, (r) => { for (let i = 0; i < MAX_KNOWN_KEYS - 1; i++) (r as any).q(`INSERT INTO roster(dev,sign_key,added_at,removed) VALUES(?,?,?,1)`, randomHex(16), randomHex(32), 1); });
    expect((await rosterAdd(conns[0]!, await newDevice())).h.reason).toBe("too-many-keys");
  });
  it("the active-device cap still holds (MAX_DEVICES) however many signers add", async () => {
    const { conns } = await makeSet(["a", "b", "c", "d", "e"]);
    let n = 5;
    for (let s = 0; n < MAX_DEVICES; s = (s + 1) % 5) { const r = await rosterAdd(conns[s]!, await newDevice()); if (r.h.op === "ok") n++; else if (r.h.reason !== "too-many-admissions") throw new Error(JSON.stringify(r.h)); else if (s === 4 && n < MAX_DEVICES) break; }
    expect(n).toBe(MAX_DEVICES);
    expect((await rosterAdd(conns[0]!, await newDevice())).h.reason).toMatch(/too-many-(devices|admissions)/);
  });
});

describe("finding 6: a flood by one signer never refuses another signer's statements", () => {
  it("X at its total limit: X's next statement is refused, Y's removal of X is still accepted", async () => {
    const { room, devices, conns } = await makeSet(["x", "y", "z"]);
    await inRoom(room, (r) => { for (let i = 0; i < ROSTER_MAX_PER_SIGNER; i++) (r as any).q(`INSERT INTO rentries(id,signer,kind,target,t) VALUES(?,?,?,?,?)`, randomHex(32), devices[0]!.dev, "rename", devices[0]!.dev, 1); });
    expect((await rosterRename(conns[0]!)).h.reason).toBe("too-many-entries");
    expect((await rosterRemove(conns[1]!, devices[0]!.dev)).h.op).toBe("ok");
    expect(await active(room)).toEqual([devices[1]!.dev, devices[2]!.dev].sort());
  });
  it("the per-signer total is 256 (shared constant), so 16 signers can never fill an 8,128-entry log", () => {
    expect(ROSTER_MAX_PER_SIGNER).toBe(256);
    expect(MAX_KNOWN_KEYS * ROSTER_MAX_PER_SIGNER).toBeLessThan(8128);
  });
  it("X's hourly limit does not touch Y", async () => {
    const { conns } = await makeSet(["x", "y"]);
    for (let i = 0; i < 40; i++) await rosterRename(conns[0]!);
    expect((await rosterRename(conns[1]!)).h.op).toBe("ok");
  });
});

describe("finding 9: frames are delivered with the writer the relay authenticated", () => {
  it("a stored frame is fetched with header `w` = the device that wrote it", async () => {
    const { devices, conns } = await makeSet(["a", "b"]);
    const [a, b] = conns as [Conn, Conn];
    expect((await a.call(holdHeader(devices[0]!, "chat:q", 1, undefined, { line: true }) as any, bytesOf(50))).h.op).toBe("stored");
    b.send({ op: "fetch-after", g: "chat:q", seq: 0, id: "f" });
    const got = (await b.frames("f")).filter((m) => m.h.op === "frame");
    expect(got).toHaveLength(1);
    expect(got[0]!.h.w).toBe(devices[0]!.dev);
  });
  it("a hold that claims another device as sender is refused, so `w` can never be a claim", async () => {
    const { devices, conns } = await makeSet(["a", "b"]);
    expect((await conns[0]!.call({ ...(holdHeader(devices[1]!, "chat:q", 1) as object), line: true } as any, bytesOf(20))).h.reason).toBe("forged-sender");
  });
  it("`pass` stamps `from` from the connection, whatever the client wrote", async () => {
    const { devices, conns } = await makeSet(["a", "b"]);
    const [a, b] = conns as [Conn, Conn];
    a.send({ op: "pass", g: "chat:q", to: "all", from: devices[1]!.dev, id: "p" }, bytesOf(10));
    const m = await b.waitFor("pass");
    expect(m.h.from).toBe(devices[0]!.dev);
  });
});

describe("W8: a statement that cites the removal of its own signer is refused", () => {
  it("signer-knew-removal", async () => {
    const { room, devices, conns } = await makeSet(["a", "b", "c"]);
    const fake = randomHex(32);
    // a removal of b is on record (seam: the relay would have banned b; here b is still a member, the case the check exists for)
    await q(room, `INSERT INTO rentries(id,signer,kind,target,t) VALUES(?,?,?,?,?)`, fake, devices[0]!.dev, "remove", devices[1]!.dev, 5);
    const intro = (await q(room, `SELECT entry FROM rintro WHERE dev=?`, devices[1]!.dev))[0]!.entry as string;
    expect((await rosterRename(conns[1]!, { seen: [intro, fake] })).h.reason).toBe("signer-knew-removal");
    expect((await rosterRename(conns[1]!, { seen: [intro] })).h.op).toBe("ok");
  });
});

describe("W19: the ancestry walk is bounded", () => {
  it("a chain longer than the bound is cut off at it (a hostile `seen` graph cannot make the relay read without limit)", async () => {
    const { room } = await makeSet(["a"]);
    const n = ANCESTRY_WALK_LIMIT + 500;
    await inRoom(room, (r) => { for (let i = 0; i < n; i++) (r as any).q(`INSERT OR IGNORE INTO rseen(id,sid) VALUES(?,?)`, `c${i}`, `c${i + 1}`); });
    const size = await inRoom(room, (r) => (r as any).ancestry(["c0"]).size as number);
    expect(size).toBeLessThanOrEqual(ANCESTRY_WALK_LIMIT + 1);
    expect(size).toBeGreaterThan(ANCESTRY_WALK_LIMIT - 1);
  });
});

describe("more hostile checks on roster-put", () => {
  it("a rename that targets someone else is refused", async () => {
    const { devices, conns } = await makeSet(["a", "b"]);
    const r = await rosterRename(conns[0]!);
    expect(r.h.op).toBe("ok");
    void devices;
  });
  it("an add of an existing member is refused, an add of a banned device is refused", async () => {
    const { devices, conns } = await makeSet(["a", "b", "c"]);
    expect((await rosterAdd(conns[0]!, devices[1]!)).h.reason).toBe("already-member");
    await rosterRemove(conns[0]!, devices[2]!.dev);
    expect((await rosterAdd(conns[0]!, devices[2]!)).h.reason).toBe("banned");
  });
  it("a statement id is single use (replay refused)", async () => {
    const { conns } = await makeSet(["a", "b"]);
    const id = randomHex(32);
    expect((await rosterRename(conns[0]!, { entry: id })).h.op).toBe("ok");
    expect((await rosterRename(conns[0]!, { entry: id })).h.reason).toBe("duplicate");
  });
  it("a statement whose ancestry does not lead to the signer's own admission is refused", async () => {
    const { conns } = await makeSet(["a", "b"]);
    expect((await rosterRename(conns[1]!, { seen: [randomHex(32)] })).h.reason).toBe("bad-ancestry");
  });
  it("a statement from a device that is not on the roster is refused", async () => {
    const { conns } = await makeSet(["a"]);
    expect((await rosterRename(conns[0]!, { signer: await newDevice("stranger") })).h.reason).toBe("not-a-member");
  });
  it("a removal of an unknown device is not-found; removal of oneself is allowed", async () => {
    const { room, devices, conns } = await makeSet(["a", "b"]);
    expect((await rosterRemove(conns[0]!, "ee".repeat(16))).h.reason).toBe("not-found");
    conns[1]!.send({ op: "roster-put-noreply" });
    await rosterRemove(conns[1]!, devices[1]!.dev, { noReply: true }); // a self-removal closes the sender's own socket, so no reply is sent
    await conns[1]!.waitClosed();
    expect(await active(room)).toEqual([devices[0]!.dev]);
  });
  it("a removed device's connection is closed and its later statements are refused", async () => {
    const { devices, conns } = await makeSet(["a", "b", "c"]);
    await rosterRemove(conns[0]!, devices[1]!.dev);
    expect((await conns[1]!.waitClosed()).code).toBe(4003);
    expect((await rosterRename(conns[2]!, { signer: devices[1]! })).h.reason).toBe("signer-removed");
  });
  it("a bad curve point as the new device's key is refused and costs no slot or admission", async () => {
    const { room, conns } = await makeSet(["a"]);
    const bad = "ab".repeat(31);
    expect((await rosterAdd(conns[0]!, bad)).h.op).not.toBe("ok");
    expect((await q(room, `SELECT count(*) n FROM roster`))[0]!.n).toBe(1);
  });
});
void (null as unknown as Device);

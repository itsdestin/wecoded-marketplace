/// <reference types="vite/client" />
import { env, createExecutionContext, waitOnExecutionContext, listDurableObjectIds } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { Conn, bytesOf, inRoom, joinMeeting, makeSet, newMeetId, openMeeting } from "./mesh-helpers";
import { MEET_LIFETIME_MS, MEET_MAX_GUEST_CONNECTS, MEET_MAX_HOST_MESSAGE_BYTES, MEET_MAX_MESSAGE_BYTES, MEET_MAX_TOTAL_BYTES, MEET_OPENS_PER_DEVICE_HOUR } from "../src/mesh/protocol";

// The pairing meeting point (T5 C10, threat model P-3 / P-9). The relay is a hostile pipe: every test here is something a
// hostile party on or beside it could try.

// The platform keeps its own _cf_ tables; ours must be gone after an erase.
const USER_TABLES = "SELECT count(*) n FROM sqlite_master WHERE name NOT LIKE '%cf%' AND name NOT LIKE 'sqlite%'";
const meetObj = <T>(m: string, fn: (r: any) => T | Promise<T>) => inRoom(`meet:${m}`, fn);
const relay = (c: Conn, n: number, payload: Uint8Array, id?: string) => c.send({ op: "meet-relay", n, ...(id ? { id } : {}) }, payload);

async function pair() {
  const { conns } = await makeSet(["owner"]);
  const o = await openMeeting(conns[0]!);
  const host = await joinMeeting(o.m, "host", o.ticket);
  const guest = await joinMeeting(o.m, "guest");
  return { owner: conns[0]!, m: o.m, ticket: o.ticket, host: host.c, guest: guest.c, hostFirst: host.first, guestFirst: guest.first };
}

describe("meeting point: the normal exchange", () => {
  it("a member opens it, the host and one guest join, and messages cross in both directions, tagged and numbered", async () => {
    const t = await pair();
    expect(t.hostFirst.h).toMatchObject({ op: "meet-joined", role: "host" });
    expect(t.guestFirst.h).toMatchObject({ op: "meet-joined", role: "guest", gen: 1, peer: true });
    expect((await t.host.waitFor("meet-peer")).h).toMatchObject({ state: "on", gen: 1 });
    relay(t.guest, 1, new TextEncoder().encode("pake1"));
    const atHost = await t.host.waitFor("meet-relay");
    expect(atHost.h).toMatchObject({ from: "guest", gen: 1, n: 1 });
    expect(new TextDecoder().decode(atHost.payload)).toBe("pake1");
    relay(t.host, 1, new TextEncoder().encode("pake2"));
    const atGuest = await t.guest.waitFor("meet-relay");
    expect(atGuest.h).toMatchObject({ from: "host", gen: 1, n: 1 });
  });

  it("opening replies with a ticket and the lifetime; the lifetime is the invite's five minutes", async () => {
    const { conns } = await makeSet(["owner"]);
    const o = await openMeeting(conns[0]!);
    expect(o.reply.h).toMatchObject({ op: "meet-opened", m: o.m, ttlMs: MEET_LIFETIME_MS });
    expect(MEET_LIFETIME_MS).toBe(5 * 60_000);
    expect(o.ticket).toMatch(/^[0-9a-f]{32}$/);
  });

  it("either side can close it: both are told, everything is erased, and the id is dead", async () => {
    const t = await pair();
    t.guest.send({ op: "meet-close" });
    expect((await t.host.waitFor("meet-ended")).h.why).toBe("closed");
    expect((await t.host.waitClosed()).code).toBe(4010);
    expect((await t.guest.waitClosed()).code).toBe(4010);
    await new Promise((r) => setTimeout(r, 30));
    await expect(Conn.openMeet(t.m)).rejects.toThrow(/404/);
    expect(await meetObj(t.m, (r) => r.sql.exec(USER_TABLES).one().n)).toBe(0); // no tables, so no rows
  });

  it("when the host leaves the meeting ends and is erased (no data after the parties are gone)", async () => {
    const t = await pair();
    t.host.ws.close(1000, "done");
    expect((await t.guest.waitFor("meet-ended")).h.why).toBe("host-left");
    await t.guest.waitClosed();
    await new Promise((r) => setTimeout(r, 30));
    await expect(Conn.openMeet(t.m)).rejects.toThrow(/404/);
  });
});

describe("meeting point: hostile parties", () => {
  it("an id nobody opened gives a 404 and leaves nothing behind", async () => {
    const m = newMeetId();
    await expect(Conn.openMeet(m)).rejects.toThrow(/404/);
    expect(await meetObj(m, (r) => r.sql.exec(USER_TABLES).one().n)).toBe(0);
  });

  it("a third party cannot join: a second guest is refused while one is in, and a wrong or missing ticket cannot be the host", async () => {
    const t = await pair();
    const second = await joinMeeting(t.m, "guest");
    expect(second.first.h).toMatchObject({ op: "refused", reason: "busy" });
    expect((await second.c.waitClosed()).code).toBe(4011);
    const fakeHost = await joinMeeting(t.m, "host", "00".repeat(16));
    expect(fakeHost.first.h.reason).toBe("bad-ticket");
    const noTicket = await joinMeeting(t.m, "host");
    expect(noTicket.first.h.reason).toBe("bad-ticket");
    const secondHost = await joinMeeting(t.m, "host", t.ticket);
    expect(secondHost.first.h.reason).toBe("host-taken");
    // the real pair still works and nothing the strangers sent reached them
    relay(t.guest, 1, bytesOf(10));
    expect((await t.host.waitFor("meet-relay")).h.from).toBe("guest");
    expect(t.host.inbox.filter((m) => m.h.op !== "meet-peer")).toHaveLength(0);
  });

  it("nobody who has not joined can send, and nothing is forwarded before the other party is there", async () => {
    const { conns } = await makeSet(["owner"]);
    const o = await openMeeting(conns[0]!);
    const c = await Conn.openMeet(o.m);
    relay(c, 1, bytesOf(10));
    expect((await c.waitClosed()).code).toBe(4001);
    const host = await joinMeeting(o.m, "host", o.ticket);
    relay(host.c, 1, bytesOf(10));
    expect((await host.c.waitFor("refused")).h.reason).toBe("peer-absent");
  });

  it("a replayed or older message number is dropped, not forwarded", async () => {
    const t = await pair();
    await t.host.waitFor("meet-peer");
    relay(t.guest, 5, bytesOf(10));
    await t.host.waitFor("meet-relay");
    relay(t.guest, 5, bytesOf(10));
    relay(t.guest, 3, bytesOf(10));
    expect((await t.guest.waitFor("refused")).h.reason).toBe("replay");
    await new Promise((r) => setTimeout(r, 40));
    expect(t.host.inbox.filter((m) => m.h.op === "meet-relay")).toHaveLength(0);
  });

  it("an oversized message closes the socket before it is passed on", async () => {
    const t = await pair();
    relay(t.guest, 1, new Uint8Array(MEET_MAX_MESSAGE_BYTES + 1));
    expect((await t.guest.waitClosed()).code).toBe(4007);
    await new Promise((r) => setTimeout(r, 30));
    expect(t.host.inbox.filter((m) => m.h.op === "meet-relay")).toHaveLength(0);
    // empty messages and junk framing are refused the same way
    const u = await pair();
    u.guest.sendRaw(new Uint8Array(40).fill(0xee));
    expect((await u.guest.waitClosed()).code).toBe(4006);
  });

  it("flooding is cut off at the per-socket ceiling", async () => {
    const t = await pair();
    for (let i = 1; i <= 80; i++) relay(t.guest, i, new Uint8Array(4));
    expect((await t.guest.waitClosed()).code).toBe(4008);
  });

  it("the whole meeting is capped in bytes and in messages; past the cap it ends and is erased", async () => {
    const t = await pair();
    await t.host.waitFor("meet-peer");
    // WHY host-to-guest 1 MiB messages: that direction is the wide one (the welcome); four of them reach the 4 MiB total.
    let n = 0;
    let sent = 0;
    while (sent + MEET_MAX_HOST_MESSAGE_BYTES <= MEET_MAX_TOTAL_BYTES) { relay(t.host, ++n, new Uint8Array(MEET_MAX_HOST_MESSAGE_BYTES)); sent += MEET_MAX_HOST_MESSAGE_BYTES; await t.guest.waitFor("meet-relay"); }
    relay(t.host, ++n, new Uint8Array(1000));
    expect((await t.guest.waitFor("meet-ended")).h.why).toBe("limit");
    await t.guest.waitClosed();
    await new Promise((r) => setTimeout(r, 30));
    await expect(Conn.openMeet(t.m)).rejects.toThrow(/404/);
  });

  it("squatting: a second open of the same id is refused (by anyone), the original owner's meeting is untouched", async () => {
    const one = await makeSet(["a"]);
    const two = await makeSet(["x"]);
    const o = await openMeeting(one.conns[0]!);
    const squat = await openMeeting(two.conns[0]!, o.m);
    expect(squat.reply.h).toMatchObject({ op: "refused", reason: "meeting-exists" });
    const host = await joinMeeting(o.m, "host", o.ticket);
    expect(host.first.h.op).toBe("meet-joined");
    // and the squatter's room did not keep a reservation for it
    expect(await inRoom(two.room, (r) => (r as any).q(`SELECT count(*) n FROM meets`)[0].n)).toBe(0);
  });

  it("a stranger who talks burns at most the guest-connection allowance, then the door is shut (the host's three tries are the app's)", async () => {
    const { conns } = await makeSet(["owner"]);
    const o = await openMeeting(conns[0]!);
    const host = await joinMeeting(o.m, "host", o.ticket);
    for (let i = 0; i < MEET_MAX_GUEST_CONNECTS; i++) {
      const g = await joinMeeting(o.m, "guest");
      expect(g.first.h.op).toBe("meet-joined");
      g.c.send({ op: "meet-relay", n: 1 }, bytesOf(8)); // a guest counts toward the allowance once it has said something
      await host.c.waitFor("meet-relay");
      g.c.ws.close(1000, "bye");
      await host.c.waitFor((m) => m.h.op === "meet-peer" && m.h.state === "off");
    }
    const late = await joinMeeting(o.m, "guest");
    expect(late.first.h).toMatchObject({ op: "refused", reason: "full" });
  });

  it("a guest that holds the slot without saying anything is dropped after the deadline; an unjoined socket likewise", async () => {
    const { conns } = await makeSet(["owner"]);
    const o = await openMeeting(conns[0]!);
    const idle = await joinMeeting(o.m, "guest");
    const mute = await Conn.openMeet(o.m);
    await meetObj(o.m, (r) => { const t0 = Date.now(); r.now = () => t0 + 11_000; return r.alarm(); });
    expect((await idle.c.waitClosed()).code).toBe(4011);
    expect((await mute.waitClosed()).code).toBe(4011);
    const next = await joinMeeting(o.m, "guest"); // the slot is free again
    expect(next.first.h.op).toBe("meet-joined");
  });

  it("it expires at the invite's lifetime: sockets closed, storage erased, the id is dead", async () => {
    const t = await pair();
    await meetObj(t.m, (r) => { const t0 = Date.now(); r.now = () => t0 + MEET_LIFETIME_MS + 1; return r.alarm(); });
    expect((await t.guest.waitFor("meet-ended")).h.why).toBe("expired");
    expect((await t.host.waitClosed()).code).toBe(4010);
    await new Promise((r) => setTimeout(r, 30));
    await expect(Conn.openMeet(t.m)).rejects.toThrow(/404/);
  });

  it("per device: at most two meetings open at once and six an hour; refused, not queued", async () => {
    const { conns, room } = await makeSet(["owner"]);
    expect((await openMeeting(conns[0]!)).reply.h.op).toBe("meet-opened");
    expect((await openMeeting(conns[0]!)).reply.h.op).toBe("meet-opened");
    expect((await openMeeting(conns[0]!)).reply.h).toMatchObject({ op: "refused", reason: "too-many-meetings" });
    // an hour-long sweep: expire the open ones, then fill the hourly allowance
    await inRoom(room, (r) => { (r as any).q(`UPDATE meets SET expires=1`); });
    for (let i = 0; i < MEET_OPENS_PER_DEVICE_HOUR - 2; i++) { expect((await openMeeting(conns[0]!)).reply.h.op).toBe("meet-opened"); await inRoom(room, (r) => { (r as any).q(`UPDATE meets SET expires=1`); }); }
    expect((await openMeeting(conns[0]!)).reply.h).toMatchObject({ op: "refused", reason: "rate-limited" });
  });

  it("a meeting that has ended frees its room's slot at once (the hourly allowance still counts it)", async () => {
    const { conns, room } = await makeSet(["owner"]);
    const one = await openMeeting(conns[0]!);
    await openMeeting(conns[0]!);
    const host = await joinMeeting(one.m, "host", one.ticket);
    host.c.send({ op: "meet-close" });
    await host.c.waitClosed();
    await new Promise((r) => setTimeout(r, 30));
    expect((await openMeeting(conns[0]!)).reply.h.op).toBe("meet-opened"); // slot freed
    expect(await inRoom(room, (r) => (r as any).q(`SELECT count(*) n FROM meets`)[0].n)).toBe(3); // all three still counted for the hour
  });

  it("only an authenticated member can open one: a socket that has not signed in cannot, and a bad id is refused", async () => {
    const { conns } = await makeSet(["owner"]);
    expect((await conns[0]!.call({ op: "meet-open", m: "nothex" })).h.reason).toBe("bad-header");
    const d = await Conn.open("cd".repeat(32));
    d.send({ op: "meet-open", m: newMeetId() });
    expect((await d.waitClosed()).code).toBe(4001);
  });

  it("a relay-side observer sees ids, sizes and timing only: the meeting object stores no message bytes, no code and no id of a room", async () => {
    const t = await pair();
    await t.host.waitFor("meet-peer");
    const MARK = new TextEncoder().encode("PAKE-MESSAGE-MARKER-0123456789");
    relay(t.guest, 1, MARK);
    await t.host.waitFor("meet-relay");
    const dump = await meetObj(t.m, (r) => JSON.stringify({ meta: r.q(`SELECT k,v FROM meta`), tables: r.q(`SELECT name FROM sqlite_master`), frames: r.q(`SELECT count(*) n FROM frames`), roster: r.q(`SELECT count(*) n FROM roster`) }));
    expect(dump).not.toContain("PAKE-MESSAGE-MARKER");
    expect(JSON.parse(dump).meta.map((x: any) => x.k).sort()).toEqual(["meet_bytes", "meet_created", "meet_gen", "meet_guests", "meet_id", "meet_msgs", "meet_room", "meet_ticket"]);
    expect(JSON.parse(dump).roster[0].n).toBe(0);
    expect(JSON.parse(dump).frames[0].n).toBe(0);
  });

  it("logs nothing about a meeting beyond an event name", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    try {
      const t = await pair();
      relay(t.guest, 1, new TextEncoder().encode("SECRET-PAIRING-BODY"));
      await t.host.waitFor("meet-relay");
      t.host.send({ op: "meet-close" });
      await t.guest.waitClosed();
      const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" "))).join("\n");
      expect(logged).not.toContain("SECRET-PAIRING-BODY");
      expect(logged).not.toContain(t.m);
      expect(logged).not.toContain(t.ticket);
    } finally { spies.forEach((s) => s.mockRestore()); }
  });
});

// ---- Front door: flag, mode gating, limiter, and "no object before the cheap checks" ----
function spyNamespace(real: DurableObjectNamespace, answer: (room: string) => number) {
  const touched: string[] = [];
  return {
    touched,
    idFromName(name: string) { touched.push(name.startsWith("meet:") ? "meet" : "room"); return { name } as any; },
    get(id: any) { return { fetch: async () => (String(id.name).startsWith("meet:") ? new Response("reached the meeting", { status: 200 }) : new Response(null, { status: answer(id.name) })) } as any; },
    real,
  };
}
async function front(extraEnv: Record<string, unknown>, id: string, headers: Record<string, string> = { Upgrade: "websocket" }, path = `/mesh/meet/${id}?v=1`) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://test.local${path}`, { headers }), { ...env, ...extraEnv } as any, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
const okLimiter = { limit: async () => ({ success: true }) };

describe("meeting point front door", () => {
  it("flag off, mode off or a typo: a plain 404 and no object is created or touched", async () => {
    const m = newMeetId();
    for (const e of [{ MESH_RELAY_ENABLED: "0" }, { MESH_RELAY_ENABLED: "1", MESH_RELAY_MODE: "off" }, { MESH_RELAY_ENABLED: "1", MESH_RELAY_MODE: "open" }, { MESH_RELAY_ENABLED: "1", MESH_RELAY_MODE: "allowlsit" }]) {
      const spy = spyNamespace(env.MESH_RELAY, () => 200);
      expect((await front({ ...e, MESH_RELAY: spy }, m)).status).toBe(404);
      expect(spy.touched).toEqual([]);
    }
  });

  it("allowlist mode: an id nobody on the list opened is a 404 and the meeting object is never touched; one that was opened gets through", async () => {
    const roomA = "aa".repeat(32);
    const spy = spyNamespace(env.MESH_RELAY, (room) => (room === roomA ? 200 : 404));
    const stranger = newMeetId();
    // no room answers 200 for this id
    const none = await front({ MESH_RELAY_MODE: "allowlist", MESH_ALLOWED_ROOMS: `${"bb".repeat(32)},${"cc".repeat(32)}`, EVENT_RATE_LIMITER: okLimiter, MESH_RELAY: spy }, stranger);
    expect(none.status).toBe(404);
    expect(spy.touched.every((x) => x === "room")).toBe(true);
    const opened = await front({ MESH_RELAY_MODE: "allowlist", MESH_ALLOWED_ROOMS: `${roomA}`, EVENT_RATE_LIMITER: okLimiter, MESH_RELAY: spy }, newMeetId());
    expect(opened.status).toBe(200);
    expect(spy.touched).toContain("meet");
  });

  it("allowlist mode with an empty or missing list admits nothing, and never wakes an object", async () => {
    for (const list of [undefined, "", " , "]) {
      const spy = spyNamespace(env.MESH_RELAY, () => 200);
      expect((await front({ MESH_RELAY_MODE: "allowlist", MESH_ALLOWED_ROOMS: list, EVENT_RATE_LIMITER: okLimiter, MESH_RELAY: spy }, newMeetId())).status).toBe(404);
      expect(spy.touched).toEqual([]);
    }
  });

  it("the per-address limiter fails closed: limited is 429, erroring or absent is 503 (except in test-open), and no object is touched", async () => {
    const m = newMeetId();
    const cases: Array<[unknown, number]> = [[{ limit: async () => ({ success: false }) }, 429], [{ limit: async () => { throw new Error("down"); } }, 503], [undefined, 503]];
    for (const [limiter, status] of cases) {
      const spy = spyNamespace(env.MESH_RELAY, () => 200);
      expect((await front({ MESH_RELAY_MODE: "allowlist", MESH_ALLOWED_ROOMS: "aa".repeat(32), EVENT_RATE_LIMITER: limiter, MESH_RELAY: spy }, m)).status).toBe(status);
      expect(spy.touched).toEqual([]);
    }
  });

  it("bad ids, plain GETs and refused versions never reach an object", async () => {
    const spy = spyNamespace(env.MESH_RELAY, () => 200);
    const e = { MESH_RELAY_MODE: "test-open", MESH_RELAY: spy };
    expect((await front(e, "short")).status).toBe(404);
    expect((await front(e, newMeetId(), {})).status).toBe(426);
    expect((await front(e, newMeetId(), { Upgrade: "websocket" }, `/mesh/meet/${newMeetId()}?v=99`)).status).toBe(404);
    expect(spy.touched).toEqual([]);
  });

  it("a client cannot forge the internal headers: X-Mesh-Kind on a relay or meeting upgrade changes nothing", async () => {
    const before = (await listDurableObjectIds(env.MESH_RELAY)).length;
    const m = newMeetId();
    const res = await front({}, m, { Upgrade: "websocket", "X-Mesh-Kind": "meet-create" });
    expect(res.status).toBe(404); // routed as an ordinary connect to an id nobody opened
    const res2 = await front({}, m, { Upgrade: "websocket", "X-Mesh-Kind": "meet-check", "X-Mesh-Meet": m });
    expect(res2.status).toBe(404);
    expect((await listDurableObjectIds(env.MESH_RELAY)).length - before).toBeLessThanOrEqual(1);
  });
});

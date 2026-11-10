import { SELF, env, runInDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { createTestAccount, issueTestSession } from "./helpers";
import { MAX_AGE_MS, IDLE_MS, MAX_MESSAGE_CHARS, RATE_MAX_MESSAGES } from "../src/games/relay-room";

// Versus-game relay rooms (src/games/relay-room.ts). Guards that the message shapes,
// room-full and reconnection behave as on the old hosted-PartyKit rooms, AND the
// 2026-11 hardening: sign-in ticket required, verified identity, size/rate limits,
// room lifetime.

type Sock = { ws: WebSocket; msgs: any[]; closed: Promise<{ code: number; reason: string }> };
type Player = { token: string; username: string };

// One signed-in test player per name; the shown name is the account handle.
const players = new Map<string, Player>();
async function player(name: string): Promise<Player> {
  const hit = players.get(name);
  if (hit) return hit;
  const acct = await createTestAccount({ login: name, handle: name });
  const p = { token: await issueTestSession(acct), username: name };
  players.set(name, p);
  return p;
}
// WHY cleared per file run only: each test resets D1 (setup.ts), so cached accounts die.
import { beforeEach } from "vitest";
beforeEach(() => players.clear());

async function ticketFor(p: Player, game: string, room: string): Promise<string> {
  const res = await SELF.fetch("https://test.local/games/ticket", {
    method: "POST",
    headers: { Authorization: `Bearer ${p.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ game, room }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { ticket: string }).ticket;
}

function wire(res: Response): Sock {
  const ws = res.webSocket!;
  const msgs: any[] = [];
  ws.addEventListener("message", (e) => { msgs.push(JSON.parse(e.data as string)); });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.addEventListener("close", (e) => resolve({ code: e.code, reason: e.reason })),
  );
  ws.accept();
  return { ws, msgs, closed };
}

async function join(party: string, room: string, name: string): Promise<Sock> {
  const t = await ticketFor(await player(name), party, room);
  const res = await SELF.fetch(`https://test.local/parties/${party}/${room}?ticket=${t}`, {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(101);
  return wire(res);
}
const until = async (fn: () => boolean, ms = 2000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const attempt = (party: string, room: string, query: string) =>
  SELF.fetch(`https://test.local/parties/${party}/${room}${query}`, { headers: { Upgrade: "websocket" } });

for (const party of ["connectfour", "chess"]) {
  describe(`${party} room`, () => {
    it("announces players to each other and relays messages to the other player only", async () => {
      const a = await join(party, "ABCDAA", "alice");
      const b = await join(party, "ABCDAA", "bob");
      await until(() => a.msgs.length >= 1 && b.msgs.length >= 1);
      expect(b.msgs[0]).toEqual({ type: "player-joined", username: "alice" });
      expect(a.msgs[0]).toEqual({ type: "player-joined", username: "bob", reconnect: false });

      a.ws.send(JSON.stringify({ type: "move", col: 3 }));
      await until(() => b.msgs.length >= 2);
      expect(b.msgs[1]).toEqual({ type: "move", col: 3 });
      expect(a.msgs.length).toBe(1); // sender does not get its own echo
    });

    it("stamps the verified name over a username a client writes inside a message", async () => {
      const a = await join(party, "ABCDAB", "alice");
      const b = await join(party, "ABCDAB", "bob");
      await until(() => a.msgs.length >= 1 && b.msgs.length >= 1);
      a.ws.send(JSON.stringify({ type: "chat", username: "bob", text: "hi" }));
      await until(() => b.msgs.length >= 2);
      expect(b.msgs[1]).toEqual({ type: "chat", username: "alice", text: "hi" });
    });

    it("turns away a third player with room-full and close code 4002", async () => {
      await join(party, "ABCDAC", "alice");
      await join(party, "ABCDAC", "bob");
      const c = await join(party, "ABCDAC", "carol");
      await until(() => c.msgs.length >= 1);
      expect(c.msgs[0]).toEqual({ type: "room-full" });
      expect((await c.closed).code).toBe(4002);
    });

    it("lets the same account reconnect: old socket closed 4001, opponent told reconnect:true", async () => {
      const a = await join(party, "ABCDAD", "alice");
      const b = await join(party, "ABCDAD", "bob");
      await until(() => a.msgs.length >= 1);
      const a2 = await join(party, "ABCDAD", "alice");
      expect((await a.closed).code).toBe(4001);
      await until(() => b.msgs.some((m) => m.reconnect === true));
      expect(b.msgs.find((m) => m.reconnect === true)).toEqual({ type: "player-joined", username: "alice", reconnect: true });
      await until(() => a2.msgs.length >= 1);
      expect(a2.msgs[0]).toEqual({ type: "player-joined", username: "bob" });
    });

    it("tells the opponent when a player leaves, and frees the seat", async () => {
      const a = await join(party, "ABCDAE", "alice");
      const b = await join(party, "ABCDAE", "bob");
      await until(() => a.msgs.length >= 1);
      b.ws.close(1000, "bye");
      await until(() => a.msgs.some((m) => m.type === "player-left"));
      expect(a.msgs.find((m) => m.type === "player-left")).toEqual({ type: "player-left", username: "bob" });
      const c = await join(party, "ABCDAE", "carol");
      await until(() => c.msgs.length >= 1);
      expect(c.msgs[0]).toEqual({ type: "player-joined", username: "alice" });
    });

    it("closes a connection that sends a message over the size cap (4012)", async () => {
      const a = await join(party, "ABCDAF", "alice");
      await join(party, "ABCDAF", "bob");
      a.ws.send("x".repeat(MAX_MESSAGE_CHARS + 1));
      expect(await a.closed).toEqual({ code: 4012, reason: "Message too large" });
    });

    it("closes a connection that floods messages (4013)", async () => {
      const a = await join(party, "ABCDAG", "alice");
      const b = await join(party, "ABCDAG", "bob");
      await until(() => b.msgs.length >= 1);
      for (let i = 0; i < RATE_MAX_MESSAGES + 5; i++) a.ws.send(JSON.stringify({ type: "chat", text: String(i) }));
      expect(await a.closed).toEqual({ code: 4013, reason: "Too many messages" });
    });

    it("closes everyone with 4010 and wipes stored state at the 6 hour limit", async () => {
      const a = await join(party, "ABCDAH", "alice");
      const b = await join(party, "ABCDAH", "bob");
      await until(() => a.msgs.length >= 1);
      const stub: any = (env as any)[party.toUpperCase()].getByName("ABCDAH");
      await (runInDurableObject as any)(stub, async (_i: any, state: any) => {
        await state.storage.put("createdAt", Date.now() - MAX_AGE_MS - 1000);
      });
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      expect((await a.closed).code).toBe(4010);
      expect((await b.closed).code).toBe(4010);
      await (runInDurableObject as any)(stub, async (_i: any, state: any) => {
        expect(await state.storage.get("createdAt")).toBeUndefined();
      });
    });

    it("closes everyone with 4011 after 30 idle minutes, but not while still active", async () => {
      const a = await join(party, "ABCDAK", "alice");
      const b = await join(party, "ABCDAK", "bob");
      await until(() => a.msgs.length >= 1);
      const stub: any = (env as any)[party.toUpperCase()].getByName("ABCDAK");
      // Active room: alarm fires early, nothing closes, a new alarm is set.
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      await new Promise((r) => setTimeout(r, 50));
      a.ws.send(JSON.stringify({ type: "move" }));
      await until(() => b.msgs.length >= 2);
      await (runInDurableObject as any)(stub, async (inst: any) => { inst.lastActivity = Date.now() - IDLE_MS - 1000; });
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      expect((await a.closed).code).toBe(4011);
      expect((await b.closed).code).toBe(4011);
    });
  });
}

describe("game room sign-in", () => {
  it("refuses a connection with no ticket (401)", async () => {
    expect((await attempt("connectfour", "ABCDBA", "")).status).toBe(401);
    // the old unverified form is no longer accepted
    expect((await attempt("connectfour", "ABCDBA", "?username=mallory")).status).toBe(401);
  });

  it("refuses a made-up, expired, reused or wrong-room/wrong-game ticket (401)", async () => {
    expect((await attempt("chess", "ABCDBB", `?ticket=${"0".repeat(48)}`)).status).toBe(401);
    expect((await attempt("chess", "ABCDBB", "?ticket=not-a-ticket")).status).toBe(401);

    const p = await player("alice");
    const wrongRoom = await ticketFor(p, "chess", "ABCDBB");
    expect((await attempt("chess", "ABCDBC", `?ticket=${wrongRoom}`)).status).toBe(401);
    expect((await attempt("connectfour", "ABCDBB", `?ticket=${wrongRoom}`)).status).toBe(401);

    // expired: age the stored ticket past its 60 seconds
    const old = await ticketFor(p, "chess", "ABCDBB");
    await env.DB.prepare("UPDATE game_tickets SET expires_at = expires_at - 120").run();
    expect((await attempt("chess", "ABCDBB", `?ticket=${old}`)).status).toBe(401);

    // one use only
    const once = await ticketFor(p, "chess", "ABCDBD");
    const first = await attempt("chess", "ABCDBD", `?ticket=${once}`);
    expect(first.status).toBe(101);
    first.webSocket!.accept();
    expect((await attempt("chess", "ABCDBD", `?ticket=${once}`)).status).toBe(401);
  });

  it("seats the player under the ticket's identity, ignoring a ?username= claim", async () => {
    const a = await join("chess", "ABCDBE", "alice");
    const t = await ticketFor(await player("bob"), "chess", "ABCDBE");
    const res = await attempt("chess", "ABCDBE", `?ticket=${t}&username=mallory`);
    expect(res.status).toBe(101);
    wire(res);
    await until(() => a.msgs.length >= 1);
    expect(a.msgs[0]).toEqual({ type: "player-joined", username: "bob", reconnect: false });
  });

  it("rejects a malformed room code before touching a room (400)", async () => {
    const t = await ticketFor(await player("alice"), "chess", "ABCDBF");
    expect((await attempt("chess", "r1", `?ticket=${t}`)).status).toBe(400);
    expect((await attempt("chess", "ABCDBF0", `?ticket=${t}`)).status).toBe(400);
  });
});

describe("POST /games/ticket", () => {
  const post = (token: string | null, body: unknown) =>
    SELF.fetch("https://test.local/games/ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });

  it("requires sign-in", async () => {
    expect((await post(null, { game: "chess", room: "ABCDCA" })).status).toBe(401);
    expect((await post("bad", { game: "chess", room: "ABCDCA" })).status).toBe(401);
  });

  it("answers { ticket, username, expires_in } and validates game and room", async () => {
    const p = await player("alice");
    const ok = await post(p.token, { game: "chess", room: "ABCDCA" });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as any;
    expect(body.ticket).toMatch(/^[0-9a-f]{48}$/);
    expect(body.username).toBe("alice");
    expect(body.expires_in).toBe(60);
    expect((await post(p.token, { game: "checkers", room: "ABCDCA" })).status).toBe(400);
    expect((await post(p.token, { game: "chess", room: "abc" })).status).toBe(400);
    expect((await post(p.token, { game: "chess" })).status).toBe(400);
  });

  it("is rate limited per user (429 after 20 in a minute)", async () => {
    const p = await player("alice");
    for (let i = 0; i < 20; i++) expect((await post(p.token, { game: "chess", room: "ABCDCB" })).status).toBe(200);
    expect((await post(p.token, { game: "chess", room: "ABCDCB" })).status).toBe(429);
    // another user is unaffected
    expect((await post((await player("bob")).token, { game: "chess", room: "ABCDCB" })).status).toBe(200);
  });
});

describe("game room routing", () => {
  it("keeps rooms with different codes or different games separate", async () => {
    const a = await join("connectfour", "SAMEAA", "alice");
    const b = await join("chess", "SAMEAA", "bob");
    const c = await join("connectfour", "XTHERA", "carol");
    await new Promise((r) => setTimeout(r, 100));
    expect(a.msgs).toEqual([]);
    expect(b.msgs).toEqual([]);
    expect(c.msgs).toEqual([]);
  });

  it("does not answer for unknown games and leaves existing routes alone", async () => {
    const bad = await SELF.fetch("https://test.local/parties/checkers/ABCDDA?username=a", { headers: { Upgrade: "websocket" } });
    expect(bad.status).toBe(400);
    const health = await SELF.fetch("https://test.local/health");
    expect(health.status).toBe(200);
  });

  it("answers a plain GET with 404 'Not implemented' (what services-watch.mjs treats as healthy)", async () => {
    const res = await SELF.fetch("https://test.local/parties/connectfour/probe");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not implemented");
  });
});

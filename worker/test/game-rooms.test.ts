import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// Versus-game relay rooms (src/games/relay-room.ts). Guards that behaviour is
// identical to the old hosted-PartyKit rooms: message shapes, room-full,
// reconnection, and that rooms of the two games / different codes are separate.

type Sock = { ws: WebSocket; msgs: any[]; closed: Promise<{ code: number; reason: string }> };

async function join(party: string, room: string, username?: string): Promise<Sock> {
  const q = username === undefined ? "" : `?username=${username}`;
  const res = await SELF.fetch(`https://test.local/parties/${party}/${room}${q}`, {
    headers: { Upgrade: "websocket" },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  const msgs: any[] = [];
  ws.addEventListener("message", (e) => { msgs.push(JSON.parse(e.data as string)); });
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    ws.addEventListener("close", (e) => resolve({ code: e.code, reason: e.reason })),
  );
  ws.accept();
  return { ws, msgs, closed };
}
const until = async (fn: () => boolean, ms = 2000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

for (const party of ["connectfour", "chess"]) {
  describe(`${party} room`, () => {
    it("announces players to each other and relays messages to the other player only", async () => {
      const a = await join(party, "r1", "alice");
      const b = await join(party, "r1", "bob");
      await until(() => a.msgs.length >= 1 && b.msgs.length >= 1);
      expect(b.msgs[0]).toEqual({ type: "player-joined", username: "alice" });
      expect(a.msgs[0]).toEqual({ type: "player-joined", username: "bob", reconnect: false });

      a.ws.send(JSON.stringify({ type: "move", col: 3 }));
      await until(() => b.msgs.length >= 2);
      expect(b.msgs[1]).toEqual({ type: "move", col: 3 });
      expect(a.msgs.length).toBe(1); // sender does not get its own echo
    });

    it("turns away a third player with room-full and close code 4002", async () => {
      await join(party, "r2", "alice");
      await join(party, "r2", "bob");
      const c = await join(party, "r2", "carol");
      await until(() => c.msgs.length >= 1);
      expect(c.msgs[0]).toEqual({ type: "room-full" });
      expect((await c.closed).code).toBe(4002);
    });

    it("closes a connection with no username using code 4000", async () => {
      const x = await join(party, "r3");
      expect((await x.closed).code).toBe(4000);
    });

    it("lets the same username reconnect: old socket closed 4001, opponent told reconnect:true", async () => {
      const a = await join(party, "r4", "alice");
      const b = await join(party, "r4", "bob");
      await until(() => a.msgs.length >= 1);
      const a2 = await join(party, "r4", "alice");
      expect((await a.closed).code).toBe(4001);
      await until(() => b.msgs.some((m) => m.reconnect === true));
      expect(b.msgs.find((m) => m.reconnect === true)).toEqual({ type: "player-joined", username: "alice", reconnect: true });
      // the reconnecting player is re-told who is in the room
      await until(() => a2.msgs.length >= 1);
      expect(a2.msgs[0]).toEqual({ type: "player-joined", username: "bob" });
    });

    it("tells the opponent when a player leaves, and frees the seat", async () => {
      const a = await join(party, "r5", "alice");
      const b = await join(party, "r5", "bob");
      await until(() => a.msgs.length >= 1);
      b.ws.close(1000, "bye");
      await until(() => a.msgs.some((m) => m.type === "player-left"));
      expect(a.msgs.find((m) => m.type === "player-left")).toEqual({ type: "player-left", username: "bob" });
      const c = await join(party, "r5", "carol");
      await until(() => c.msgs.length >= 1);
      expect(c.msgs[0]).toEqual({ type: "player-joined", username: "alice" });
    });
  });
}

describe("game room routing", () => {
  it("keeps rooms with different codes or different games separate", async () => {
    const a = await join("connectfour", "same", "alice");
    const b = await join("chess", "same", "bob");
    const c = await join("connectfour", "other", "carol");
    await new Promise((r) => setTimeout(r, 100));
    expect(a.msgs).toEqual([]);
    expect(b.msgs).toEqual([]);
    expect(c.msgs).toEqual([]);
  });

  it("does not answer for unknown games and leaves existing routes alone", async () => {
    const bad = await SELF.fetch("https://test.local/parties/checkers/x?username=a", { headers: { Upgrade: "websocket" } });
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

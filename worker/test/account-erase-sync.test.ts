// WHY (2026-11-05, Destin, owner-items deck Q-7): "Delete account" must erase EVERYTHING the
// server holds for the account. The D1 rows cascade (account.test.ts), but the account's own
// SyncGroupRoom (device names, sync-recency map, replay ring, session leases) lived in Durable
// Object storage that the delete never touched. The privacy policy had to admit it; this pins
// the fix so that sentence can stay deleted.
import { env, SELF, runInDurableObject } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { createTestAccount, issueTestSession } from "./helpers";

async function connect(token: string): Promise<WebSocket> {
  const res = await SELF.fetch("https://test.local/sync/hub?device=Laptop&deviceId=dev-1", {
    headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  return ws;
}

describe("DELETE /auth/account — sync storage", () => {
  it("erases the account's sync room storage and closes its live sync connections", async () => {
    const acct = await createTestAccount();
    const token = await issueTestSession(acct);
    const ws = await connect(token);
    const closed = new Promise<number>((resolve) => ws.addEventListener("close", (e) => resolve((e as CloseEvent).code)));
    ws.send(JSON.stringify({ type: "signal", kind: "space-updated", spaceKey: "tax-return-2026-ab12" }));
    await new Promise((r) => setTimeout(r, 150));

    const stub = env.SYNC_HUB.get(env.SYNC_HUB.idFromName(acct.userId));
    const before = await runInDurableObject(stub, async (_i, state) => (await state.storage.list()).size);
    expect(before).toBeGreaterThan(0); // the ring and recency map were written

    const res = await SELF.fetch("https://test.local/auth/account", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(204);

    const after = await runInDurableObject(stub, async (_i, state) => (await state.storage.list()).size);
    expect(after).toBe(0);
    expect(await closed).toBe(4001);
  });

  it("a client cannot reach the erase path through the public sync address", async () => {
    // The public route always forwards to the room's /connect path, so the erase request
    // can only come from the account-deletion code inside the server.
    const acct = await createTestAccount();
    const token = await issueTestSession(acct);
    const ws = await connect(token);
    ws.send(JSON.stringify({ type: "signal", kind: "space-updated", spaceKey: "keep-me" }));
    await new Promise((r) => setTimeout(r, 150));
    const res = await SELF.fetch("https://test.local/sync/hub/erase", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
    const stub = env.SYNC_HUB.get(env.SYNC_HUB.idFromName(acct.userId));
    const size = await runInDurableObject(stub, async (_i, state) => (await state.storage.list()).size);
    expect(size).toBeGreaterThan(0);
    ws.close();
  });
});

describe("GET /auth/export — games", () => {
  it("includes the caller's game scores and head-to-head matches, and no one else's", async () => {
    const me = await createTestAccount();
    const friend = await createTestAccount();
    const stranger = await createTestAccount();
    const now = Math.floor(Date.now() / 1000);
    const [low, high] = me.userId < friend.userId ? [me.userId, friend.userId] : [friend.userId, me.userId];
    await env.DB.batch([
      env.DB.prepare("INSERT INTO game_scores (user_id, game, best_score, best_at, runs, updated_at) VALUES (?, 'flappy', 42, ?, 7, ?)").bind(me.userId, now, now),
      env.DB.prepare("INSERT INTO game_scores (user_id, game, best_score, best_at, runs, updated_at) VALUES (?, 'flappy', 99, ?, 1, ?)").bind(stranger.userId, now, now),
      env.DB.prepare("INSERT INTO game_matches (user_low, user_high, game, match_id, winner, source, recorded_at) VALUES (?, ?, 'chess', 'm1', ?, 'attested', ?)").bind(low, high, me.userId, now),
    ]);
    const token = await issueTestSession(me);
    const res = await SELF.fetch("https://test.local/auth/export", { headers: { Authorization: `Bearer ${token}` } });
    const body = (await res.json()) as any;
    expect(body.game_scores).toEqual([expect.objectContaining({ game: "flappy", best_score: 42, runs: 7 })]);
    expect(body.game_matches).toEqual([expect.objectContaining({ game: "chess", match_id: "m1", winner: me.userId })]);
    expect(JSON.stringify(body)).not.toContain(stranger.userId);
  });
});

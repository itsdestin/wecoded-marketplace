import { env, SELF, runDurableObjectAlarm } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { createTestAccount, issueTestSession } from "./helpers";

// Hidden presence (incognito, per device): a socket that RECEIVES friends' presence but is never
// seen by anyone. The privacy promise these tests pin: a hidden connection never appears to any
// friend in any message, never counts as online, and never moves last_seen_at.

const presenceStub = () => env.PRESENCE.get(env.PRESENCE.idFromName("global"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function connect(token: string, hidden = false): Promise<WebSocket> {
  const res = await SELF.fetch(`https://test.local/social/presence${hidden ? "?hidden=1" : ""}`, {
    headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(101);
  const ws = res.webSocket!;
  ws.accept();
  return ws;
}
/** Every frame a socket receives, from now on. */
function record(ws: WebSocket): any[] {
  const seen: any[] = [];
  ws.addEventListener("message", (ev: MessageEvent) => { seen.push(JSON.parse(ev.data as string)); });
  return seen;
}
function nextMessage(ws: WebSocket, type: string, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
    const handler = (ev: MessageEvent) => {
      const data = JSON.parse(ev.data as string);
      if (data.type === type) { clearTimeout(timer); ws.removeEventListener("message", handler); resolve(data); }
    };
    ws.addEventListener("message", handler);
  });
}
async function befriend(aId: string, bId: string) {
  const [low, high] = aId < bId ? [aId, bId] : [bId, aId];
  await env.DB.prepare("INSERT INTO friendships (user_low, user_high, created_at) VALUES (?, ?, ?)")
    .bind(low, high, Math.floor(Date.now() / 1000)).run();
}
const lastSeen = async (id: string) =>
  (await env.DB.prepare("SELECT last_seen_at FROM users WHERE id = ?").bind(id).first<{ last_seen_at: number | null }>())!.last_seen_at;

describe("PresenceRoom — hidden mode (incognito)", () => {
  it("says it supports hidden mode, without needing a session", async () => {
    const res = await SELF.fetch("https://test.local/social/presence/capabilities");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hidden: true });
  });

  it("confirms hidden mode FIRST, then sends the hidden user their friends' presence", async () => {
    const a = await createTestAccount({ handle: `ha${Date.now() % 100000}` });
    const b = await createTestAccount({ handle: `hb${Date.now() % 100000}` });
    await befriend(a.userId, b.userId);
    const wsB = await connect(await issueTestSession(b));
    await nextMessage(wsB, "presence");

    const res = await SELF.fetch("https://test.local/social/presence?hidden=1", {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${await issueTestSession(a)}` },
    });
    const wsA = res.webSocket!;
    const frames = record(wsA);
    wsA.accept();
    await nextMessage(wsA, "presence");
    // The hello comes before anything else, so a client can refuse an older server.
    expect(frames[0]).toEqual({ type: "hello", hidden: true });
    expect(frames[1].users.map((u: any) => u.id)).toEqual([b.userId]); // A still sees B
    wsA.close(); wsB.close();
  });

  it("a hidden connection never appears to any friend in any message", async () => {
    const a = await createTestAccount({ handle: `hc${Date.now() % 100000}` });
    const b = await createTestAccount({ handle: `hd${Date.now() % 100000}` });
    const c = await createTestAccount({ handle: `he${Date.now() % 100000}` });
    await befriend(a.userId, b.userId);
    await befriend(a.userId, c.userId);
    const wsB = await connect(await issueTestSession(b));
    const atB = record(wsB);
    await nextMessage(wsB, "presence");

    // A connects hidden, tries everything a visible client could do, then leaves.
    const wsA = await connect(await issueTestSession(a), true);
    await nextMessage(wsA, "presence");
    wsA.send(JSON.stringify({ type: "status", status: "in-game" }));
    wsA.send(JSON.stringify({ type: "challenge", target: b.userId, gameType: "chess", code: "HID123" }));
    wsA.send(JSON.stringify({ type: "challenge-response", to: b.userId, accept: true }));
    // A friend who comes online while A is hidden: A is not in their snapshot.
    const wsC = await connect(await issueTestSession(c));
    const atC = record(wsC);
    await sleep(150);
    wsA.close();
    await sleep(150);

    const leaks = [...atB, ...atC].filter((f) => JSON.stringify(f).includes(a.userId));
    expect(leaks).toEqual([]);
    wsB.close(); wsC.close();
  });

  it("refuses status changes and challenges from a hidden connection, and says why", async () => {
    const a = await createTestAccount({ handle: `hf${Date.now() % 100000}` });
    const b = await createTestAccount({ handle: `hg${Date.now() % 100000}` });
    await befriend(a.userId, b.userId);
    const wsB = await connect(await issueTestSession(b));
    await nextMessage(wsB, "presence");
    const wsA = await connect(await issueTestSession(a), true);
    await nextMessage(wsA, "presence");

    const refusedStatus = nextMessage(wsA, "refused");
    wsA.send(JSON.stringify({ type: "status", status: "in-game" }));
    expect(await refusedStatus).toMatchObject({ for: "status", reason: "hidden" });
    const refusedChallenge = nextMessage(wsA, "refused");
    wsA.send(JSON.stringify({ type: "challenge", target: b.userId, gameType: "chess", code: "HID124" }));
    expect(await refusedChallenge).toMatchObject({ for: "challenge", reason: "hidden" });
    wsA.close(); wsB.close();
  });

  it("is not online: a challenge to a hidden-only user fails as if they were away", async () => {
    const a = await createTestAccount({ handle: `hh${Date.now() % 100000}` });
    const b = await createTestAccount({ handle: `hi${Date.now() % 100000}` });
    await befriend(a.userId, b.userId);
    const wsA = await connect(await issueTestSession(a), true);
    const atA = record(wsA);
    await nextMessage(wsA, "presence");
    const wsB = await connect(await issueTestSession(b));
    await nextMessage(wsB, "presence");
    const failed = nextMessage(wsB, "challenge-failed");
    wsB.send(JSON.stringify({ type: "challenge", target: a.userId, gameType: "chess", code: "HID125" }));
    expect((await failed).target).toBe(a.userId);
    await sleep(100);
    expect(atA.some((f) => f.type === "challenge")).toBe(false); // nothing reached the hidden socket
    wsA.close(); wsB.close();
  });

  it("never moves last_seen_at — not on close, not on the alarm", async () => {
    const a = await createTestAccount({ handle: `hj${Date.now() % 100000}` });
    const before = await lastSeen(a.userId);
    const wsA = await connect(await issueTestSession(a), true);
    await nextMessage(wsA, "presence");
    expect(await runDurableObjectAlarm(presenceStub())).toBe(true);
    expect(await lastSeen(a.userId)).toBe(before);
    wsA.close();
    await sleep(150);
    expect(await lastSeen(a.userId)).toBe(before);
  });

  it("per device: a visible device keeps the account online while another device is hidden", async () => {
    const a = await createTestAccount({ handle: `hk${Date.now() % 100000}` });
    const b = await createTestAccount({ handle: `hl${Date.now() % 100000}` });
    await befriend(a.userId, b.userId);
    const visible = await connect(await issueTestSession(a));
    await nextMessage(visible, "presence");
    const wsB = await connect(await issueTestSession(b));
    const snapB = await nextMessage(wsB, "presence");
    expect(snapB.users.map((u: any) => u.id)).toEqual([a.userId]);
    const atB = record(wsB);
    // A second device of A goes hidden and closes again: B hears nothing about A.
    const hidden = await connect(await issueTestSession(a), true);
    await nextMessage(hidden, "presence");
    hidden.close();
    await sleep(150);
    expect(atB.filter((f) => JSON.stringify(f).includes(a.userId))).toEqual([]);
    // The visible device leaving is still announced.
    const left = nextMessage(wsB, "user-left");
    visible.close();
    expect((await left).id).toBe(a.userId);
    wsB.close();
  });

  // Final review F28, privacy first: a forfeit claim against an incognito player must get exactly the
  // answer it gets against an absent one, or the claimer learns the incognito player is connected.
  it("a forfeit claim reveals nothing: an incognito opponent is answered exactly like an absent one", async () => {
    const claim = async (opponentConnectedHidden: boolean) => {
      const a = await createTestAccount({ handle: `hk${Date.now() % 100000}${opponentConnectedHidden ? "h" : "a"}` });
      const b = await createTestAccount({ handle: `hl${Date.now() % 100000}${opponentConnectedHidden ? "h" : "a"}` });
      await befriend(a.userId, b.userId);
      const wsA = await connect(await issueTestSession(a));
      await nextMessage(wsA, "presence");
      const wsB = opponentConnectedHidden ? await connect(await issueTestSession(b), true) : null;
      if (wsB) await nextMessage(wsB, "presence");
      const frames = record(wsA);
      const match = `M-forfeit-${opponentConnectedHidden ? "hidden" : "absent"}-${Date.now() % 1000000}`;
      wsA.send(JSON.stringify({ type: "game-forfeit", game: "chess", match_id: match, opponent: b.userId }));
      await nextMessage(wsA, "game-record");
      await sleep(100);
      wsA.close(); wsB?.close();
      // Ids and the match id differ between the two runs; everything else must match.
      return frames.map((f) => JSON.stringify(f).replaceAll(b.userId, "OPP").replaceAll(a.userId, "ME").replaceAll(match, "MATCH"));
    };
    expect(await claim(true)).toEqual(await claim(false));
  });
});

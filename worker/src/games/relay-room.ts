// Versus-game relay rooms (Connect 4 and Chess), hosted in this Worker.
//
// WHY THIS FILE EXISTS: these two rooms used to run on hosted PartyKit
// (youcoded-games.itsdestin.partykit.dev). That platform shut down on
// 2026-10-23 and deleted every project, so no match could start. They now live
// here as Durable Objects built with `partyserver` (the open-source library
// PartyKit's own migration guide points to).
//
// WHY A RELAY AND NOT A REFEREE: the rules live in the app (chess.js is a
// renderer dependency), so legality is enforced on BOTH clients. This room just
// seats two players and passes every message to the other one.
//
// 2026-11 HARDENING (owner decision: limits, a maximum lifetime, sign-in required):
//   - Who you are comes from a verified one-time ticket (see index.ts + games/tickets.ts),
//     never from the web address. The Worker sets X-Room-User-Id / X-Room-Username.
//   - Exactly two people per room. There are NO spectators in this protocol; a third
//     person is turned away. The same person reconnecting replaces their old connection.
//   - Messages are capped in size and rate; abusers are disconnected with a reason.
//   - A room dies after MAX_AGE (6 h from creation) or IDLE (30 min with no messages),
//     using the Durable Object alarm, and its stored state is wiped.
//
// Seating lives in memory (no hibernation): if the DO restarts, clients reconnect and
// the app's own resync logic takes over, as it did on PartyKit. Only the creation time
// is stored, so the hard lifetime survives a restart.
import { Server, type Connection, type ConnectionContext, type WSMessage } from "partyserver";

const MAX_PLAYERS = 2;
// WHY 4 KB: real messages are a move, a chat line or a rematch request (well under 1 KB).
export const MAX_MESSAGE_CHARS = 4096;
// WHY 30 per 10 s: a fast human sends a few messages a second at most; this is a flood.
export const RATE_WINDOW_MS = 10_000;
export const RATE_MAX_MESSAGES = 30;
export const MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const IDLE_MS = 30 * 60 * 1000;

// Close codes (4000 "missing username" is retired: sign-in is now checked before the room).
export const CLOSE_SUPERSEDED = 4001;
export const CLOSE_FULL = 4002;
export const CLOSE_EXPIRED = 4010;
export const CLOSE_IDLE = 4011;
export const CLOSE_TOO_LARGE = 4012;
export const CLOSE_TOO_FAST = 4013;
export const CLOSE_UNVERIFIED = 4014;

interface Seat { userId: string; username: string }

export class RelayRoom extends Server {
  // connectionId -> verified player
  private players = new Map<string, Seat>();
  // connectionId -> timestamps of recent messages (for the flood limit)
  private recent = new Map<string, number[]>();
  private lastActivity = Date.now();

  onConnect(connection: Connection, ctx: ConnectionContext) {
    // WHY these headers are trustworthy: only index.ts sets them, after spending a valid
    // ticket, and it overwrites any value the client sent.
    const userId = ctx.request.headers.get("X-Room-User-Id");
    const rawName = ctx.request.headers.get("X-Room-Username");
    if (!userId || !rawName) {
      connection.close(CLOSE_UNVERIFIED, "Not signed in");
      return;
    }
    let username: string;
    try { username = decodeURIComponent(rawName); } catch { username = rawName; }

    // Reconnection: the same PERSON (by account id, not by shown name) replaces their own
    // stale connection instead of being counted as a second player.
    let isReconnect = false;
    for (const [connId, seat] of this.players) {
      if (seat.userId === userId && connId !== connection.id) {
        this.players.delete(connId);
        this.recent.delete(connId);
        this.getConnection(connId)?.close(CLOSE_SUPERSEDED, "Superseded by reconnection");
        isReconnect = true;
        break;
      }
    }

    // Reject a third player (two different players already present).
    if (!isReconnect && this.players.size >= MAX_PLAYERS) {
      connection.send(JSON.stringify({ type: "room-full" }));
      connection.close(CLOSE_FULL, "Room is full");
      return;
    }

    this.players.set(connection.id, { userId, username });
    this.touch();
    void this.armLifetime();

    // Tell the arriving player who is already here.
    for (const [connId, seat] of this.players) {
      if (connId !== connection.id) {
        connection.send(JSON.stringify({ type: "player-joined", username: seat.username }));
      }
    }

    // Tell everyone else, marking reconnections so a client can tell a socket
    // blip from a brand-new opponent (and therefore not reset the position).
    this.broadcast(
      JSON.stringify({ type: "player-joined", username, reconnect: isReconnect }),
      [connection.id],
    );
  }

  onMessage(sender: Connection, message: WSMessage) {
    if (typeof message !== "string") return;
    // A rejected third connection (room-full) is closed but could still race a
    // message in; only seated players may relay.
    const seat = this.players.get(sender.id);
    if (!seat) return;

    // WHY size first: reject before doing any work on a huge payload.
    if (message.length > MAX_MESSAGE_CHARS) {
      sender.close(CLOSE_TOO_LARGE, "Message too large");
      return;
    }
    // Flood limit: at most RATE_MAX_MESSAGES in any RATE_WINDOW_MS for this connection.
    const now = Date.now();
    const times = (this.recent.get(sender.id) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    times.push(now);
    this.recent.set(sender.id, times);
    if (times.length > RATE_MAX_MESSAGES) {
      sender.close(CLOSE_TOO_FAST, "Too many messages");
      return;
    }
    this.touch();

    // WHY rewrite `username`: clients put their own name inside moves/chat. A cheater
    // could write someone else's name there, so the room stamps the verified name over
    // it. Non-JSON is dropped: every real client message is a JSON object.
    let parsed: unknown;
    try { parsed = JSON.parse(message); } catch { return; }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "username" in parsed) {
      (parsed as Record<string, unknown>).username = seat.username;
      this.broadcast(JSON.stringify(parsed), [sender.id]);
      return;
    }
    this.broadcast(message, [sender.id]);
  }

  onClose(connection: Connection) {
    this.leave(connection);
  }

  onError(connection: Connection) {
    this.leave(connection);
  }

  private leave(connection: Connection) {
    this.recent.delete(connection.id);
    const seat = this.players.get(connection.id);
    if (!seat) return;
    this.players.delete(connection.id);
    this.broadcast(JSON.stringify({ type: "player-left", username: seat.username }));
  }

  private touch() { this.lastActivity = Date.now(); }

  // WHY: record the creation time once (survives a restart so the 6 h cap is real) and
  // make sure an alarm is set for the earlier of "too old" and "too idle".
  private async armLifetime() {
    let created = await this.ctx.storage.get<number>("createdAt");
    if (created === undefined) {
      created = Date.now();
      await this.ctx.storage.put("createdAt", created);
    }
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(this.nextDeadline(created));
    }
  }

  private nextDeadline(created: number) {
    return Math.min(created + MAX_AGE_MS, this.lastActivity + IDLE_MS);
  }

  async onAlarm() {
    const created = (await this.ctx.storage.get<number>("createdAt")) ?? Date.now();
    const now = Date.now();
    let reason: { code: number; text: string } | null = null;
    if (now >= created + MAX_AGE_MS) reason = { code: CLOSE_EXPIRED, text: "Room closed: 6 hour limit reached" };
    else if (now >= this.lastActivity + IDLE_MS) reason = { code: CLOSE_IDLE, text: "Room closed: no activity for 30 minutes" };

    if (!reason) {
      // Activity happened since the alarm was set: check again at the new deadline.
      await this.ctx.storage.setAlarm(this.nextDeadline(created));
      return;
    }
    this.players.clear();
    this.recent.clear();
    for (const conn of this.getConnections()) conn.close(reason.code, reason.text);
    // Wipe everything stored for this room; a later join with the same code starts fresh.
    await this.ctx.storage.deleteAll();
  }
}

// Two classes (not one) so each game gets its own Durable Object namespace and
// URL name: /parties/connectfour/<room> and /parties/chess/<room>.
export class ConnectFourRoom extends RelayRoom {}
export class ChessRoom extends RelayRoom {}

// One-time join tickets for the versus-game rooms (Connect 4, Chess).
//
// WHY: rooms used to trust whatever username arrived in the web address and let anyone
// open any room. Now the app signs in over normal HTTP (POST /games/ticket), receives a
// ticket good for ~60 s for exactly one game + room, and presents it on the WebSocket
// address. The Worker checks it BEFORE the request reaches the room, and the room takes
// the player's identity from the ticket, never from anything the client typed.
import { randomToken, sha256Hex } from "../lib/crypto";

/** URL names of the two room types (the part after /parties/). */
export const ROOM_GAMES = ["connectfour", "chess"] as const;
export type RoomGame = (typeof ROOM_GAMES)[number];

export function isRoomGame(v: unknown): v is RoomGame {
  return typeof v === "string" && (ROOM_GAMES as readonly string[]).includes(v);
}

// WHY exactly this shape: it is what the app generates (usePartyGame.ts / useChessGame.ts):
// 6 characters from an alphabet with no 0/O/1/I. Anything else is not a real room code.
export const ROOM_CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
export const isRoomCode = (v: unknown): v is string => typeof v === "string" && ROOM_CODE_RE.test(v);

export const TICKET_TTL_SEC = 60;
// Per signed-in user: far above a real player (one ticket per join or reconnect),
// far below what it takes to make the table a cost problem.
export const TICKET_MAX_PER_USER_PER_MIN = 20;

export interface VerifiedPlayer { userId: string; username: string }

/** Issue a ticket. Returns null when the user is over their per-minute limit. */
export async function issueTicket(
  db: D1Database, userId: string, game: RoomGame, room: string, now: number,
): Promise<{ ticket: string; username: string; expiresIn: number } | null> {
  // WHY a D1 count (not the cache limiter): the cache-based limiter was measured to limit
  // nothing on some hostnames; the database count works everywhere.
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM game_tickets WHERE user_id = ? AND created_at > ?")
    .bind(userId, now - 60).first<{ n: number }>();
  if ((recent?.n ?? 0) >= TICKET_MAX_PER_USER_PER_MIN) return null;

  const u = await db.prepare("SELECT display_name, handle FROM users WHERE id = ?")
    .bind(userId).first<{ display_name: string | null; handle: string | null }>();
  // WHY display name first: it is the name the lobby, the challenge and the app's own "that message is mine"
  // check already use for this player (the app's usePresence: display_name ?? login). Naming the player by handle
  // here made the room disagree with the rest of the app about who is who. The room itself tells players apart
  // by account id, never by this name.
  const username = (u?.display_name || u?.handle || "Player").slice(0, 40);

  const ticket = randomToken(24);
  await db.prepare(
    "INSERT INTO game_tickets (ticket_hash, user_id, username, game, room, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(await sha256Hex(ticket), userId, username, game, room, now, now + TICKET_TTL_SEC).run();
  return { ticket, username, expiresIn: TICKET_TTL_SEC };
}

/** Spend a ticket. One use only; must match game + room and be unexpired, else null. */
export async function redeemTicket(
  db: D1Database, ticket: string | null, game: string, room: string, now: number,
): Promise<VerifiedPlayer | null> {
  if (!ticket || !/^[0-9a-f]{48}$/.test(ticket)) return null;
  // WHY one UPDATE ... RETURNING: checking and spending in a single statement means two
  // simultaneous connections cannot both use the same ticket.
  const row = await db.prepare(
    `UPDATE game_tickets SET used_at = ?
      WHERE ticket_hash = ? AND used_at IS NULL AND expires_at > ? AND game = ? AND room = ?
      RETURNING user_id, username`
  ).bind(now, await sha256Hex(ticket), now, game, room).first<{ user_id: string; username: string }>();
  return row ? { userId: row.user_id, username: row.username } : null;
}

-- Game-room join tickets.
--
-- WHY: a browser cannot attach a sign-in header to a WebSocket, and the long-lived
-- session token must never ride in a web address (addresses get logged). So a signed-in
-- app first asks POST /games/ticket for a one-time ticket good for ~60 seconds for ONE
-- game room, then puts that ticket on the WebSocket address. Only the hash of the ticket
-- is stored, so reading this table reveals nothing a player could reuse.
--
-- WHY rows are kept after use (used_at) instead of deleted: they double as the counter
-- the hourly security alarm reads ("how many tickets were issued this hour") and as the
-- per-user rate limit. The daily maintenance job deletes rows after a day.
CREATE TABLE game_tickets (
  ticket_hash TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  username    TEXT NOT NULL,   -- the name shown to the opponent, fixed when the ticket is issued
  game        TEXT NOT NULL,
  room        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);
CREATE INDEX idx_game_tickets_user ON game_tickets(user_id, created_at);
CREATE INDEX idx_game_tickets_created ON game_tickets(created_at);

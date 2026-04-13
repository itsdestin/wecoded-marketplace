// Session issuance/resolution/revocation. Raw bearer token is handed back to
// the caller of issueSession; only the hash is persisted in `sessions`.

import type { D1Database } from "@cloudflare/workers-types";
import { randomToken, sha256Hex } from "../lib/crypto";

export async function issueSession(db: D1Database, userId: string): Promise<string> {
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)")
    .bind(hash, userId, now, now)
    .run();
  return token;
}

export async function resolveSession(db: D1Database, token: string): Promise<string | null> {
  const hash = await sha256Hex(token);
  const row = await db
    .prepare("SELECT user_id FROM sessions WHERE token_hash = ?")
    .bind(hash)
    .first<{ user_id: string }>();
  if (!row) return null;
  await db
    .prepare("UPDATE sessions SET last_used_at = ? WHERE token_hash = ?")
    .bind(Math.floor(Date.now() / 1000), hash)
    .run();
  return row.user_id;
}

export async function revokeSession(db: D1Database, token: string): Promise<void> {
  const hash = await sha256Hex(token);
  await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(hash).run();
}

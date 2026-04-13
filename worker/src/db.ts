import type { D1Database } from "@cloudflare/workers-types";
import type { RatingRow, UserRow } from "./types";

export async function upsertUser(
  db: D1Database,
  user: { id: string; github_login: string; github_avatar_url: string | null }
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `INSERT INTO users (id, github_login, github_avatar_url, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET github_login = excluded.github_login,
                                     github_avatar_url = excluded.github_avatar_url`
    )
    .bind(user.id, user.github_login, user.github_avatar_url, now)
    .run();
}

export async function getUser(db: D1Database, id: string): Promise<UserRow | null> {
  return await db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export async function hasInstall(db: D1Database, userId: string, pluginId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS one FROM installs WHERE user_id = ? AND plugin_id = ?")
    .bind(userId, pluginId)
    .first<{ one: number }>();
  return row !== null;
}

export async function getRating(
  db: D1Database,
  userId: string,
  pluginId: string
): Promise<RatingRow | null> {
  return await db
    .prepare("SELECT * FROM ratings WHERE user_id = ? AND plugin_id = ?")
    .bind(userId, pluginId)
    .first<RatingRow>();
}

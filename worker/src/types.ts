export interface Env {
  DB: D1Database;
  AI: Ai;
  GH_CLIENT_ID: string;
  GH_CLIENT_SECRET: string;
  ADMIN_USER_IDS: string;  // comma-separated user ids
}

export interface UserRow {
  id: string;
  github_login: string;
  github_avatar_url: string | null;
  created_at: number;
}

export interface SessionRow {
  token_hash: string;
  user_id: string;
  created_at: number;
  last_used_at: number;
}

export interface RatingRow {
  user_id: string;
  plugin_id: string;
  stars: number;
  review_text: string | null;
  created_at: number;
  updated_at: number;
  hidden: number;
}

export type HonoEnv = { Bindings: Env; Variables: { userId: string } };

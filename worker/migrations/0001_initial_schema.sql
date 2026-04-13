-- users: one row per authenticated GitHub user
CREATE TABLE users (
  id TEXT PRIMARY KEY,              -- format: "github:<github_user_id>"
  github_login TEXT NOT NULL,
  github_avatar_url TEXT,
  created_at INTEGER NOT NULL       -- unix seconds
);

CREATE INDEX idx_users_login ON users(github_login);

-- sessions: opaque bearer tokens issued to clients
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,      -- sha256 hex of the bearer token
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);

-- device_codes: pending OAuth device-flow requests
CREATE TABLE device_codes (
  device_code TEXT PRIMARY KEY,     -- random 32-byte hex given to client
  user_code TEXT NOT NULL,          -- 8-char human-readable code shown on the auth page
  session_token_hash TEXT,          -- filled once auth completes; null means pending
  expires_at INTEGER NOT NULL,      -- unix seconds; 15 min after creation
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_device_codes_user_code ON device_codes(user_code);

-- installs: one row per (user, plugin) install event
CREATE TABLE installs (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin_id TEXT NOT NULL,
  installed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, plugin_id)
);

CREATE INDEX idx_installs_plugin ON installs(plugin_id);

-- ratings: one row per (user, plugin); stars 1-5, optional text
CREATE TABLE ratings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plugin_id TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK(stars BETWEEN 1 AND 5),
  review_text TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  hidden INTEGER NOT NULL DEFAULT 0,   -- 1 if moderated out
  PRIMARY KEY (user_id, plugin_id)
);

CREATE INDEX idx_ratings_plugin_visible ON ratings(plugin_id) WHERE hidden = 0;

-- theme_likes: toggle; one row per (user, theme)
CREATE TABLE theme_likes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  theme_id TEXT NOT NULL,
  liked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, theme_id)
);

CREATE INDEX idx_theme_likes_theme ON theme_likes(theme_id);

-- reports: a user flagged a rating for moderation review
CREATE TABLE reports (
  id TEXT PRIMARY KEY,                  -- random hex
  rating_user_id TEXT NOT NULL,
  rating_plugin_id TEXT NOT NULL,
  reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,                  -- null = open
  resolution TEXT                       -- 'hidden' | 'dismissed' | null
);

CREATE INDEX idx_reports_open ON reports(created_at) WHERE resolved_at IS NULL;

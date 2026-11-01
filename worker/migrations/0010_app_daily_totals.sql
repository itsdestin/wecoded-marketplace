-- Daily app-analytics totals kept past Analytics Engine's 90-day limit (analytics
-- deck U-4, 2026-10-31). Totals only: no device hash is ever stored here.
-- platform is 'desktop' or 'android' (phones that once checked in as "desktop"
-- are counted as android, see lib/admin-filter.ts PLATFORM_EXPR).
CREATE TABLE app_daily_totals (
  day TEXT NOT NULL,
  platform TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  new_devices INTEGER NOT NULL DEFAULT 0,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (day, platform)
);

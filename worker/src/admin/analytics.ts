// Privacy-by-construction contract: every query in this file aggregates
// install_id (blob2) via uniq() or omits it from SELECT entirely. Raw
// install_ids never leave the Worker — don't add a route that returns them,
// even for debugging.
//
// SQL dialect: Cloudflare Analytics Engine uses a narrow SQL subset — NOT
// full ClickHouse. Quirks learned the hard way (422 responses):
// - Cardinality is `count(DISTINCT col)`. ClickHouse's `uniq()` is rejected;
//   PostgreSQL's `COUNT_DISTINCT()` is also rejected.
// - `INTERVAL '30' DAY` — count must be a QUOTED STRING LITERAL ('30'),
//   not an unquoted integer (rejected as "Expected literal string").
// - `count()` alone works; use `count(DISTINCT col)` for cardinality.
// See: https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/
import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { requireAdminAuth } from "../auth/admin-middleware";
import { forbidden } from "../lib/errors";
import { runAnalyticsQuery } from "../lib/analytics-query";

function isAdmin(env: { ADMIN_USER_IDS: string }, userId: string): boolean {
  const admins = env.ADMIN_USER_IDS.split(",").map((s) => s.trim()).filter(Boolean);
  return admins.includes(userId);
}

// Clamp days param to [1, 90] — matches AE 90-day retention and prevents silly values.
function clampDays(raw: string | undefined, fallback: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(90, Math.floor(n)));
}

export const adminAnalyticsRoutes = new Hono<HonoEnv>();

// GET /admin/analytics/dau?days=30 — DAU by day for the last N days.
adminAnalyticsRoutes.get("/admin/analytics/dau", requireAdminAuth, async (c) => {
  if (!isAdmin(c.env, c.get("userId"))) throw forbidden("admin only");
  const days = clampDays(c.req.query("days"), 30);
  const rows = await runAnalyticsQuery<{ day: string; dau: number }>(
    c.env,
    `SELECT toDate(timestamp) AS day, count(DISTINCT blob2) AS dau
     FROM youcoded_app_events
     WHERE blob1 = 'heartbeat' AND timestamp > NOW() - INTERVAL '${days}' DAY
     GROUP BY day ORDER BY day`
  );
  return c.json(rows);
});

// GET /admin/analytics/mau — rolling 30-day unique active users.
adminAnalyticsRoutes.get("/admin/analytics/mau", requireAdminAuth, async (c) => {
  if (!isAdmin(c.env, c.get("userId"))) throw forbidden("admin only");
  const rows = await runAnalyticsQuery<{ mau: number }>(
    c.env,
    `SELECT count(DISTINCT blob2) AS mau
     FROM youcoded_app_events
     WHERE blob1 = 'heartbeat' AND timestamp > NOW() - INTERVAL '30' DAY`
  );
  return c.json({ mau: rows[0]?.mau ?? 0 });
});

// GET /admin/analytics/installs?days=90 — new installs per day.
adminAnalyticsRoutes.get("/admin/analytics/installs", requireAdminAuth, async (c) => {
  if (!isAdmin(c.env, c.get("userId"))) throw forbidden("admin only");
  const days = clampDays(c.req.query("days"), 90);
  const rows = await runAnalyticsQuery<{ day: string; installs: number }>(
    c.env,
    `SELECT toDate(timestamp) AS day, count() AS installs
     FROM youcoded_app_events
     WHERE blob1 = 'install' AND timestamp > NOW() - INTERVAL '${days}' DAY
     GROUP BY day ORDER BY day`
  );
  return c.json(rows);
});

// GET /admin/analytics/versions — active-user count by version, today only.
adminAnalyticsRoutes.get("/admin/analytics/versions", requireAdminAuth, async (c) => {
  if (!isAdmin(c.env, c.get("userId"))) throw forbidden("admin only");
  const rows = await runAnalyticsQuery<{ version: string; users: number }>(
    c.env,
    `SELECT blob3 AS version, count(DISTINCT blob2) AS users
     FROM youcoded_app_events
     WHERE blob1 = 'heartbeat' AND timestamp > NOW() - INTERVAL '1' DAY
     GROUP BY version ORDER BY users DESC`
  );
  return c.json(rows);
});

// GET /admin/analytics/platforms — rolling 30-day split by platform.
adminAnalyticsRoutes.get("/admin/analytics/platforms", requireAdminAuth, async (c) => {
  if (!isAdmin(c.env, c.get("userId"))) throw forbidden("admin only");
  const rows = await runAnalyticsQuery<{ platform: string; users: number }>(
    c.env,
    `SELECT blob4 AS platform, count(DISTINCT blob2) AS users
     FROM youcoded_app_events
     WHERE blob1 = 'heartbeat' AND timestamp > NOW() - INTERVAL '30' DAY
     GROUP BY platform ORDER BY users DESC`
  );
  return c.json(rows);
});

// GET /admin/analytics/countries — rolling 30-day top 20 countries.
adminAnalyticsRoutes.get("/admin/analytics/countries", requireAdminAuth, async (c) => {
  if (!isAdmin(c.env, c.get("userId"))) throw forbidden("admin only");
  const rows = await runAnalyticsQuery<{ country: string; users: number }>(
    c.env,
    `SELECT blob6 AS country, count(DISTINCT blob2) AS users
     FROM youcoded_app_events
     WHERE blob1 = 'heartbeat' AND timestamp > NOW() - INTERVAL '30' DAY
     GROUP BY country ORDER BY users DESC LIMIT 20`
  );
  return c.json(rows);
});

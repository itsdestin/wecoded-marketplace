// Privacy-by-construction contract: every query in this file aggregates
// device_id (blob2) via count(DISTINCT), count()/countIf() over a per-device
// subquery, or omits it from SELECT entirely. Raw device_id_hashes never
// leave the Worker — don't add a route that returns them, even for debugging.
//
// Dimension policy (Destin, 2026-09-13): time, app version (blob3) and
// platform (blob4) may be combined as filters/groupings. Country (blob6) and
// region (blob7) stay single-dimension — /countries and /regions ignore every
// filter param, and no other route filters or groups by them.
//
// SQL dialect: Cloudflare Analytics Engine uses a narrow SQL subset — NOT
// full ClickHouse. Quirks learned the hard way (422 responses):
// - Cardinality is `count(DISTINCT col)`. ClickHouse's `uniq()` is rejected.
// - `INTERVAL '30' DAY` — count must be a QUOTED STRING LITERAL; no WEEK unit.
// - `count()` alone works; use `count(DISTINCT col)` for cardinality.
// - No CASE WHEN, dateDiff, CTEs, JOIN or UNION — use countIf/if and
//   toUnixTimestamp arithmetic instead.
// See: https://developers.cloudflare.com/analytics/analytics-engine/sql-reference/
import { Hono } from "hono";
import type { HonoEnv } from "../types";
import { requireAdminAuth } from "../auth/admin-middleware";
import { runAnalyticsQuery } from "../lib/analytics-query";
import {
  adminFilterClause,
  cutoverClause,
  hideTestClause,
  localTimestampExpr,
  platformClause,
  versionClause,
} from "../lib/admin-filter";
import { requireAdminAccount } from "../auth/admin";

// Always returns an integer in [1, max], so it is safe to interpolate.
function clampInt(raw: string | undefined, fallback: number, max: number): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

function clampDays(raw: string | undefined, fallback: number): number {
  return clampInt(raw, fallback, 90);
}

function clampWeeks(raw: string | undefined, fallback: number): number {
  return clampInt(raw, fallback, 12);
}

function includeAdmins(query: string | undefined): boolean {
  return query === "1";
}

export const adminAnalyticsRoutes = new Hono<HonoEnv>();

// GET /admin/analytics/dau?days=30 — devices active per LOCAL day.
// Params: tz_offset, platform, version, hide_test.
adminAnalyticsRoutes.get("/admin/analytics/dau", requireAdminAuth, async (c) => {
  await requireAdminAccount(c);
  const days = clampDays(c.req.query("days"), 30);
  const local = localTimestampExpr(c.req.query("tz_offset"));
  const cutover = cutoverClause(c.env);
  const filter = adminFilterClause(c.env, includeAdmins(c.req.query("include_admins")));
  const platform = platformClause(c.req.query("platform"));
  const version = versionClause(c.req.query("version"));
  const hideTest = hideTestClause(c.req.query("hide_test"));
  // WHY N+1 days only with tz_offset: buckets are then LOCAL days but the window
  // is measured back from UTC NOW(), so one extra day keeps the oldest local day
  // fully covered (the client trims to N). Without an offset the window stays
  // exactly N days, so older callers (dashboard-html.ts, the /analytics skill)
  // get the same rows as before.
  const windowDays = local === "timestamp" ? days : days + 1;
  const rows = await runAnalyticsQuery<{ day: string; devices: number }>(
    c.env,
    `SELECT toDate(${local}) AS day, count(DISTINCT blob2) AS devices
     FROM youcoded_app_events
     WHERE blob1 = 'heartbeat' ${cutover} AND timestamp > NOW() - INTERVAL '${windowDays}' DAY ${filter} ${platform} ${version} ${hideTest}
     GROUP BY day ORDER BY day`
  );
  return c.json(rows);
});

// GET /admin/analytics/mau — rolling 30-day distinct devices.
// Params: platform, version, hide_test.
adminAnalyticsRoutes.get("/admin/analytics/mau", requireAdminAuth, async (c) => {
  await requireAdminAccount(c);
  const cutover = cutoverClause(c.env);
  const filter = adminFilterClause(c.env, includeAdmins(c.req.query("include_admins")));
  const platform = platformClause(c.req.query("platform"));
  const version = versionClause(c.req.query("version"));
  const hideTest = hideTestClause(c.req.query("hide_test"));
  const rows = await runAnalyticsQuery<{ devices: number }>(
    c.env,
    `SELECT count(DISTINCT blob2) AS devices
     FROM youcoded_app_events
     WHERE blob1 = 'heartbeat' ${cutover} AND timestamp > NOW() - INTERVAL '30' DAY ${filter} ${platform} ${version} ${hideTest}`
  );
  return c.json({ mau: rows[0]?.devices ?? 0 });
});

// GET /admin/analytics/installs?days=N — derived from first-seen device per LOCAL day.
// Params: tz_offset, platform, hide_test.
//
// WHY no `version` filter: a row filter on blob3 would redefine first-seen as
// "first heartbeat on that version", so every upgrade would count as an install.
// Platform is safe to filter — the device hash is per-platform.
//
// AE SQL subquery support: subqueries in FROM work in production.
adminAnalyticsRoutes.get("/admin/analytics/installs", requireAdminAuth, async (c) => {
  await requireAdminAccount(c);
  const days = clampDays(c.req.query("days"), 90);
  const local = localTimestampExpr(c.req.query("tz_offset"));
  const cutover = cutoverClause(c.env);
  const filter = adminFilterClause(c.env, includeAdmins(c.req.query("include_admins")));
  const platform = platformClause(c.req.query("platform"));
  const hideTest = hideTestClause(c.req.query("hide_test"));
  const rows = await runAnalyticsQuery<{ day: string; installs: number }>(
    c.env,
    `SELECT toDate(toStartOfDay(first_seen)) AS day, count() AS installs
     FROM (
       SELECT blob2, MIN(${local}) AS first_seen
       FROM youcoded_app_events
       WHERE blob1 = 'heartbeat' ${cutover} ${filter} ${platform} ${hideTest}
       GROUP BY blob2
     )
     WHERE first_seen > NOW() - INTERVAL '${days}' DAY
     GROUP BY day ORDER BY day`
  );
  return c.json(rows);
});

// GET /admin/analytics/versions?days=1 — devices by version over a rolling
// window (default 1 day = the original rolling 24h). Params: platform, hide_test.
adminAnalyticsRoutes.get("/admin/analytics/versions", requireAdminAuth, async (c) => {
  await requireAdminAccount(c);
  const days = clampDays(c.req.query("days"), 1);
  const cutover = cutoverClause(c.env);
  const filter = adminFilterClause(c.env, includeAdmins(c.req.query("include_admins")));
  const platform = platformClause(c.req.query("platform"));
  const hideTest = hideTestClause(c.req.query("hide_test"));
  const rows = await runAnalyticsQuery<{ version: string; devices: number }>(
    c.env,
    `SELECT blob3 AS version, count(DISTINCT blob2) AS devices
     FROM youcoded_app_events
     WHERE blob1 = 'heartbeat' ${cutover} AND timestamp > NOW() - INTERVAL '${days}' DAY ${filter} ${platform} ${hideTest}
     GROUP BY version ORDER BY devices DESC`
  );
  return c.json(rows);
});

// GET /admin/analytics/platforms — rolling 30-day split. Params: version, hide_test.
adminAnalyticsRoutes.get("/admin/analytics/platforms", requireAdminAuth, async (c) => {
  await requireAdminAccount(c);
  const cutover = cutoverClause(c.env);
  const filter = adminFilterClause(c.env, includeAdmins(c.req.query("include_admins")));
  const version = versionClause(c.req.query("version"));
  const hideTest = hideTestClause(c.req.query("hide_test"));
  const rows = await runAnalyticsQuery<{ platform: string; devices: number }>(
    c.env,
    `SELECT blob4 AS platform, count(DISTINCT blob2) AS devices
     FROM youcoded_app_events
     WHERE blob1 = 'heartbeat' ${cutover} AND timestamp > NOW() - INTERVAL '30' DAY ${filter} ${version} ${hideTest}
     GROUP BY platform ORDER BY devices DESC`
  );
  return c.json(rows);
});

// GET /admin/analytics/countries — rolling 30-day top 20.
// Deliberately ignores platform/version/hide_test/tz_offset: geography is never
// cross-tabulated with other dimensions (fingerprint risk at low cell counts).
adminAnalyticsRoutes.get("/admin/analytics/countries", requireAdminAuth, async (c) => {
  await requireAdminAccount(c);
  const cutover = cutoverClause(c.env);
  const filter = adminFilterClause(c.env, includeAdmins(c.req.query("include_admins")));
  const rows = await runAnalyticsQuery<{ country: string; devices: number }>(
    c.env,
    `SELECT blob6 AS country, count(DISTINCT blob2) AS devices
     FROM youcoded_app_events
     WHERE blob1 = 'heartbeat' ${cutover} AND timestamp > NOW() - INTERVAL '30' DAY ${filter}
     GROUP BY country ORDER BY devices DESC LIMIT 20`
  );
  return c.json(rows);
});

// GET /admin/analytics/regions — rolling 30-day top 20 ISO 3166-2 regions.
// Deliberately ignores every filter param — see /countries.
adminAnalyticsRoutes.get("/admin/analytics/regions", requireAdminAuth, async (c) => {
  await requireAdminAccount(c);
  const cutover = cutoverClause(c.env);
  const filter = adminFilterClause(c.env, includeAdmins(c.req.query("include_admins")));
  const rows = await runAnalyticsQuery<{ region: string; devices: number }>(
    c.env,
    `SELECT blob7 AS region, count(DISTINCT blob2) AS devices
     FROM youcoded_app_events
     WHERE blob1 = 'heartbeat' ${cutover} AND timestamp > NOW() - INTERVAL '30' DAY ${filter}
     GROUP BY region ORDER BY devices DESC LIMIT 20`
  );
  return c.json(rows);
});

// GET /admin/analytics/active-by-version?days=30 — devices per LOCAL day per
// version (for a stacked adoption chart). Params: tz_offset, platform, hide_test.
// Window is N+1 days only with tz_offset, for the same reason as /dau.
adminAnalyticsRoutes.get("/admin/analytics/active-by-version", requireAdminAuth, async (c) => {
  await requireAdminAccount(c);
  const days = clampDays(c.req.query("days"), 30);
  const local = localTimestampExpr(c.req.query("tz_offset"));
  const cutover = cutoverClause(c.env);
  const filter = adminFilterClause(c.env, includeAdmins(c.req.query("include_admins")));
  const platform = platformClause(c.req.query("platform"));
  const hideTest = hideTestClause(c.req.query("hide_test"));
  const windowDays = local === "timestamp" ? days : days + 1;
  const rows = await runAnalyticsQuery<{ day: string; version: string; devices: number }>(
    c.env,
    `SELECT toDate(${local}) AS day, blob3 AS version, count(DISTINCT blob2) AS devices
     FROM youcoded_app_events
     WHERE blob1 = 'heartbeat' ${cutover} AND timestamp > NOW() - INTERVAL '${windowDays}' DAY ${filter} ${platform} ${hideTest}
     GROUP BY day, version ORDER BY day`
  );
  return c.json(rows);
});

// GET /admin/analytics/weekly?weeks=12 — distinct devices per LOCAL week
// (weeks start SUNDAY: Analytics Engine's toStartOfWeek returns Sundays, measured
// live 2026-09-13, although its docs say Monday). Params: tz_offset, platform, version, hide_test.
// WHY W*7+7 capped at 90: the extra week lets the oldest requested week be
// complete even though the current week is still in progress; 90 days is the
// AE retention ceiling, so asking for more would only return nothing extra.
adminAnalyticsRoutes.get("/admin/analytics/weekly", requireAdminAuth, async (c) => {
  await requireAdminAccount(c);
  const weeks = clampWeeks(c.req.query("weeks"), 12);
  const windowDays = Math.min(90, weeks * 7 + 7);
  const local = localTimestampExpr(c.req.query("tz_offset"));
  const cutover = cutoverClause(c.env);
  const filter = adminFilterClause(c.env, includeAdmins(c.req.query("include_admins")));
  const platform = platformClause(c.req.query("platform"));
  const version = versionClause(c.req.query("version"));
  const hideTest = hideTestClause(c.req.query("hide_test"));
  const rows = await runAnalyticsQuery<{ week: string; devices: number }>(
    c.env,
    `SELECT toStartOfWeek(${local}) AS week, count(DISTINCT blob2) AS devices
     FROM youcoded_app_events
     WHERE blob1 = 'heartbeat' ${cutover} AND timestamp > NOW() - INTERVAL '${windowDays}' DAY ${filter} ${platform} ${version} ${hideTest}
     GROUP BY week ORDER BY week`
  );
  return c.json(rows);
});

// GET /admin/analytics/retention?weeks=8 — weekly install cohorts and how many
// of each came back. Params: tz_offset, platform (only).
//
// WHY this shape:
// - dN counts devices whose LAST local heartbeat is on or after local day N
//   (counting the install day as day 0) — "came back on or after day N",
//   i.e. unbounded retention, not "active exactly on day N". AE lacks
//   dateDiff/CASE, so it's toUnixTimestamp arithmetic inside countIf.
// - blob2 never leaves the subquery; the outer SELECT only counts devices.
// - No version/hide_test: row filters on blob3 would redefine first-seen
//   (see /installs).
// - Caveats for readers: devices whose history predates the 90-day AE
//   retention can look new in the oldest cohorts, and young cohorts haven't
//   had time to reach d14/d30 yet.
adminAnalyticsRoutes.get("/admin/analytics/retention", requireAdminAuth, async (c) => {
  await requireAdminAccount(c);
  const weeks = clampWeeks(c.req.query("weeks"), 8);
  const local = localTimestampExpr(c.req.query("tz_offset"));
  const cutover = cutoverClause(c.env);
  const filter = adminFilterClause(c.env, includeAdmins(c.req.query("include_admins")));
  const platform = platformClause(c.req.query("platform"));
  const sinceInstallDay = "toUnixTimestamp(last_seen) - toUnixTimestamp(toStartOfDay(first_seen))";
  const rows = await runAnalyticsQuery<{
    cohort: string;
    devices: number;
    d1: number;
    d7: number;
    d14: number;
    d30: number;
  }>(
    c.env,
    `SELECT toStartOfWeek(first_seen) AS cohort, count() AS devices,
            countIf(${sinceInstallDay} >= 86400) AS d1,
            countIf(${sinceInstallDay} >= 604800) AS d7,
            countIf(${sinceInstallDay} >= 1209600) AS d14,
            countIf(${sinceInstallDay} >= 2592000) AS d30
     FROM (
       SELECT blob2, MIN(${local}) AS first_seen, MAX(${local}) AS last_seen
       FROM youcoded_app_events
       WHERE blob1 = 'heartbeat' ${cutover} ${filter} ${platform}
       GROUP BY blob2
     )
     WHERE first_seen > NOW() - INTERVAL '${weeks * 7}' DAY
     GROUP BY cohort ORDER BY cohort`
  );
  return c.json(rows);
});

// Saves each finished UTC day's app totals into D1 so history outlives the
// 90-day Analytics Engine limit (analytics deck U-4, Destin 2026-10-31: "keep
// daily totals", never device IDs). Run by the daily cron (index.ts scheduled).
//
// WHY the last 7 days are re-saved every night: a check-in that arrives late
// (a phone offline over a weekend) still lands in its day. Older days are kept
// as first saved. WHY at most 60 days back: a device's "first seen" is only
// trustworthy well inside the 90-day window (see NEW_DEVICE_HORIZON).
import type { Env } from "../types";
import { runAnalyticsQuery } from "../lib/analytics-query";
import { adminFilterClause, cutoverClause, hideTestClause, historicalCiVersionClause, PLATFORM_EXPR } from "../lib/admin-filter";

const BACKFILL_DAYS = 60;
const REFRESH_DAYS = 7;

export async function saveDailyTotals(env: Env, now: Date = new Date()): Promise<number> {
  const today = now.toISOString().slice(0, 10);
  const oldest = new Date(now.getTime() - BACKFILL_DAYS * 86400000).toISOString().slice(0, 10);
  const refreshFrom = new Date(now.getTime() - REFRESH_DAYS * 86400000).toISOString().slice(0, 10);
  // The same exclusions the dashboard applies by default: team/listed devices,
  // test builds and the historical CI versions.
  const filter = `${cutoverClause(env)} ${adminFilterClause(env, false)}`;
  const [active, fresh] = await Promise.all([
    runAnalyticsQuery<{ day: string; platform: string; devices: number }>(
      env,
      `SELECT toDate(timestamp) AS day, ${PLATFORM_EXPR} AS platform, count(DISTINCT blob2) AS devices
       FROM youcoded_app_events
       WHERE blob1 = 'heartbeat' AND timestamp > NOW() - INTERVAL '${BACKFILL_DAYS + 1}' DAY
         ${filter} ${historicalCiVersionClause()} ${hideTestClause("1")}
       GROUP BY day, platform`
    ),
    runAnalyticsQuery<{ day: string; platform: string; devices: number }>(
      env,
      `SELECT toDate(first_seen) AS day, platform, count() AS devices
       FROM (
         SELECT blob2, ${PLATFORM_EXPR} AS platform, MIN(timestamp) AS first_seen
         FROM youcoded_app_events
         WHERE blob1 = 'heartbeat' ${filter}
         GROUP BY blob2, platform
       )
       WHERE first_seen > NOW() - INTERVAL '${BACKFILL_DAYS + 1}' DAY
       GROUP BY day, platform`
    ),
  ]);
  const rows = new Map<string, { day: string; platform: string; active: number; fresh: number }>();
  const key = (day: string, platform: string) => `${day}|${platform}`;
  const at = (r: { day: string; platform: string }) => {
    const day = String(r.day).slice(0, 10);
    const platform = r.platform === "android" ? "android" : "desktop";
    const k = key(day, platform);
    if (!rows.has(k)) rows.set(k, { day, platform, active: 0, fresh: 0 });
    return rows.get(k)!;
  };
  for (const r of active) at(r).active = Number(r.devices) || 0;
  for (const r of fresh) at(r).fresh = Number(r.devices) || 0;
  const savedAt = Math.floor(now.getTime() / 1000);
  // Only finished days inside the trusted window.
  const keep = [...rows.values()].filter((r) => r.day < today && r.day >= oldest);
  if (!keep.length) return 0;
  await env.DB.batch(keep.map((r) =>
    env.DB.prepare(
      r.day >= refreshFrom
        ? "INSERT OR REPLACE INTO app_daily_totals(day,platform,active,new_devices,saved_at) VALUES(?,?,?,?,?)"
        : "INSERT OR IGNORE INTO app_daily_totals(day,platform,active,new_devices,saved_at) VALUES(?,?,?,?,?)"
    ).bind(r.day, r.platform, r.active, r.fresh, savedAt)
  ));
  return keep.length;
}

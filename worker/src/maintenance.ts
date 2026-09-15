// Daily hygiene (spec §5): one job prunes everything with a TTL. Pure function
// of (db, now) so tests don't depend on SELF.scheduled() plumbing.
import type { D1Database } from "@cloudflare/workers-types";
import { SESSION_MAX_IDLE_SEC } from "./auth/sessions";

export const HANDLE_COOLDOWN_SEC = 30 * 24 * 3600; // spec §2: 30-day handle cooldown
export const FRIEND_REQUEST_MAX_AGE_SEC = 90 * 24 * 3600; // spec §5 cron hygiene
export const SITE_ANALYTICS_RETENTION_SEC = 90 * 24 * 3600;

export async function pruneExpired(db: D1Database, now: number): Promise<void> {
  // One batch (implicit transaction): all-or-nothing — no run can leave some
  // tables pruned and others not; a failed run rolls back entirely and retries
  // tomorrow. Previously three sequential .run()s meant a throw on statement N
  // left tables N+1..end unpruned while 1..N-1 had committed (knowledge-debt #3).
  // Strict `<` on sessions is INTENTIONALLY identical to resolveSession's expiry
  // check (sessions.ts): both compare last_used_at against `now -
  // SESSION_MAX_IDLE_SEC` strictly, so the cron never deletes a row
  // resolveSession would still accept.
  try {
    await db.batch([
    db.prepare("DELETE FROM sessions WHERE last_used_at < ?").bind(now - SESSION_MAX_IDLE_SEC),
    db.prepare("DELETE FROM handle_releases WHERE released_at < ?").bind(now - HANDLE_COOLDOWN_SEC),
    db.prepare("DELETE FROM device_codes WHERE expires_at < ?").bind(now),
    db.prepare("DELETE FROM friend_requests WHERE created_at < ?").bind(now - FRIEND_REQUEST_MAX_AGE_SEC),
    // WHY aggregate and snapshot retention share this one cutoff; delayed cleanup never expands queries.
    db.prepare("DELETE FROM site_journeys WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM site_daily WHERE day < date(?, 'unixepoch', '-89 days')").bind(now),
    db.prepare("DELETE FROM site_daily_domains WHERE day < date(?, 'unixepoch', '-89 days')").bind(now),
    db.prepare("DELETE FROM site_daily_budget WHERE day < date(?, 'unixepoch', '-89 days')").bind(now),
    // WHY health reports a persisted successful sweep rather than assuming cron ran.
    db.prepare("INSERT INTO site_analytics_health(id,last_sweep_at,last_sweep_ok,last_sweep_error) VALUES(1,?,1,NULL) ON CONFLICT(id) DO UPDATE SET last_sweep_at=excluded.last_sweep_at,last_sweep_ok=1,last_sweep_error=NULL").bind(now),
    ]);
  } catch (error) {
    // WHY best effort: the original batch must still fail; a broken DB may also reject health writes.
    try {
      await db.prepare("INSERT INTO site_analytics_health(id,last_sweep_at,last_sweep_ok,last_sweep_error) VALUES(1,?,0,'cleanup_failed') ON CONFLICT(id) DO UPDATE SET last_sweep_at=excluded.last_sweep_at,last_sweep_ok=0,last_sweep_error='cleanup_failed'")
        .bind(now).run();
    } catch { /* stale/unknown health remains honest when storage itself is unavailable */ }
    throw error;
  }
}

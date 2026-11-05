// Hourly attack alarms (security apparatus layer 3, 2026-11).
//
// WHY: the worker already refuses abuse one caller at a time (per-network sign-in caps, rate
// limits), but nobody was told when it happened. This hourly check looks at the last hour as a
// whole and pushes a phone alert (ntfy) when something looks like an attack, so Destin hears
// about it in minutes instead of never.
//
// WHY alerts carry no detail: an ntfy channel is readable by anyone who knows its name, so an
// alert only says "look at the dashboard"; the numbers go to the server log (console.error),
// which only the Cloudflare account can read.
//
// Signals, each from data the worker already keeps (no new table):
//   - sign-in starts in the last hour (device_codes.created_at) above SIGNIN_START_LIMIT:
//     a phishing campaign or someone hammering the sign-in;
//   - networks that hit the per-network sign-in cap (ip_bucket rows >= START cap): bots;
//   - new login sessions in the last hour above NEW_SESSION_LIMIT: mass account access;
//   - ANY new session for an admin account (ADMIN_USER_IDS): like Google's "new sign-in"
//     notice. Destin signing in himself also triggers it, which is the point: one he did not
//     do is the alarm.

export interface AlarmEnv {
  DB: D1Database;
  NTFY_TOPIC?: string;
  ADMIN_USER_IDS?: string;
  ALARM_SIGNIN_START_LIMIT?: string;
  ALARM_NEW_SESSION_LIMIT?: string;
}

export interface Alarm {
  key: string;
  // "high" pushes with urgent priority (sound even on quiet hours); "default" is a normal notice.
  priority: "high" | "default";
  // Vague, public-safe wording. Never put a count, name or address here.
  title: string;
  // Full detail for the server log only.
  detail: string;
}

// WHY these defaults: real traffic is a few sign-ins an hour; 100 starts or 50 new sessions in
// one hour is far beyond any honest day, so a crossing is worth a look without false alarms.
const DEFAULT_START_LIMIT = 100;
const DEFAULT_SESSION_LIMIT = 50;
// Must match auth/routes.ts START_MAX_PER_BUCKET / START_WINDOW_SEC: a network that reached it.
const CAPPED_BUCKET_MIN = 10;
const CAPPED_NETWORKS_LIMIT = 3;

function limit(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function checkAlarms(env: AlarmEnv, now: number): Promise<Alarm[]> {
  const since = now - 3600;
  const alarms: Alarm[] = [];

  const starts = await env.DB.prepare("SELECT COUNT(*) AS n FROM device_codes WHERE created_at > ?")
    .bind(since).first<{ n: number }>();
  const startLimit = limit(env.ALARM_SIGNIN_START_LIMIT, DEFAULT_START_LIMIT);
  if ((starts?.n ?? 0) >= startLimit) {
    alarms.push({ key: "signin-burst", priority: "high", title: "Unusual sign-in activity on the YouCoded server",
      detail: `${starts?.n} sign-in starts in the last hour (limit ${startLimit})` });
  }

  const capped = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM (SELECT ip_bucket FROM device_codes
       WHERE created_at > ? AND ip_bucket IS NOT NULL GROUP BY ip_bucket HAVING COUNT(*) >= ?)`
  ).bind(since, CAPPED_BUCKET_MIN).first<{ n: number }>();
  if ((capped?.n ?? 0) >= CAPPED_NETWORKS_LIMIT) {
    alarms.push({ key: "signin-capped", priority: "default", title: "Several networks hit the sign-in limit",
      detail: `${capped?.n} networks reached the per-network sign-in cap in the last hour` });
  }

  const sessions = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE created_at > ?")
    .bind(since).first<{ n: number }>();
  const sessionLimit = limit(env.ALARM_NEW_SESSION_LIMIT, DEFAULT_SESSION_LIMIT);
  if ((sessions?.n ?? 0) >= sessionLimit) {
    alarms.push({ key: "session-burst", priority: "high", title: "Unusual number of new logins on the YouCoded server",
      detail: `${sessions?.n} new sessions in the last hour (limit ${sessionLimit})` });
  }

  const admins = (env.ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (admins.length) {
    const marks = admins.map(() => "?").join(",");
    // WHY the join: ADMIN_USER_IDS holds bare GitHub numeric ids (same as auth/admin.ts), while
    // sessions hold the platform's own account ids; identities links the two.
    const adminNew = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM sessions s JOIN identities i ON i.user_id = s.user_id
        WHERE s.created_at > ? AND i.provider = 'github' AND i.provider_user_id IN (${marks})`
    ).bind(since, ...admins).first<{ n: number }>();
    if ((adminNew?.n ?? 0) > 0) {
      alarms.push({ key: "admin-signin", priority: "default",
        title: "New sign-in to a YouCoded admin account. If this wasn't you, check now",
        detail: `${adminNew?.n} new admin session(s) in the last hour` });
    }
  }
  return alarms;
}

export async function sendAlarms(
  env: AlarmEnv,
  alarms: Alarm[],
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  let sent = 0;
  for (const a of alarms) {
    console.error(`security alarm [${a.key}]: ${a.detail}`);
    if (!env.NTFY_TOPIC) continue; // not configured: the log line above is all we can do
    try {
      const res = await fetchImpl(`https://ntfy.sh/${encodeURIComponent(env.NTFY_TOPIC)}`, {
        method: "POST",
        headers: { Title: "YouCoded security", Priority: a.priority, Tags: "warning" },
        body: a.title,
      });
      if (res.ok) sent++;
      else console.error(`security alarm [${a.key}]: ntfy answered ${res.status}`);
    } catch (e) {
      // WHY swallow: a failed alert must never stop the next one or the nightly maintenance.
      console.error(`security alarm [${a.key}]: ntfy unreachable: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return sent;
}

import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { HonoEnv } from '../types';
import { websiteAdminRoutes } from './admin';
import { DAY, dayOf, fail, labels, domain, counters, parseFields, validDay } from './validation';

export const siteAnalyticsEnabled = (value: string | undefined) => value === '1';
type Journey = { day: string; expires_at: number; campaign_id: number; instructions: number; windows: number; macos: number; linux: number; android: number };
const startFields = ['version', 'nonce', 'createdAt', 'source', 'campaign', 'referrerDomain', 'instructions', 'downloads'];
const updateFields = ['version', 'capability', 'instructions', 'downloads'];
const expiryFor = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000 + 90 * DAY;
async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
function guard(c: Context<HonoEnv>) {
  // WHY first: disabled collection never parses visitor bodies or accesses storage.
  if (!siteAnalyticsEnabled(c.env.SITE_ANALYTICS_ENABLED)) throw fail(404, 'not_found');
  const u = new URL(c.req.url);
  if (u.protocol !== 'https:' || u.host !== 'api.youcoded.ai' || u.search || c.req.header('Origin') !== 'https://youcoded.ai'
    || c.req.header('Cookie') || c.req.header('Authorization') || c.req.header('X-GitHub-PAT')) throw fail(403, 'forbidden');
}
async function capability(secret: string, key: string, day: string, expiry: number) {
  return `${key}.${day}.${expiry}.${await hmac(secret, `site-analytics:capability:${key}:${day}:${expiry}`)}`;
}
async function storedReply(db: D1Database, secret: string, pageKey: string) {
  const row = await db.prepare('SELECT day,expires_at,campaign_id FROM site_journeys WHERE page_key=?').bind(pageKey).first<Journey>();
  if (!row) return null;
  if (Math.floor(Date.now() / 1000) >= row.expires_at) throw fail(410, 'expired');
  const attribution = row.campaign_id
    ? await db.prepare('SELECT source,campaign FROM site_campaigns WHERE id=?').bind(row.campaign_id).first<{ source: string; campaign: string }>()
    : { source: null, campaign: null };
  return { version: 1, capability: await capability(secret, pageKey, row.day, row.expires_at), attribution };
}
function storageError(error: unknown): never {
  if (error instanceof HTTPException) throw error;
  // Only known quota failures are limits; an unknown DB error must not invent that cause.
  if (error instanceof Error && /site_(?:start|cell|change)_limit/.test(error.message)) throw fail(429, 'limited');
  throw fail(503, 'unavailable');
}
export const siteAnalyticsRoutes = new Hono<HonoEnv>();
siteAnalyticsRoutes.route('/', websiteAdminRoutes);
siteAnalyticsRoutes.post('/site-analytics/start', async c => {
  try {
    guard(c);
    const input = await parseFields(c, startFields), now = Math.floor(Date.now() / 1000), d = counters(input.downloads);
    if (input.version !== 1 || typeof input.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(input.nonce)
      || typeof input.createdAt !== 'number' || !Number.isSafeInteger(input.createdAt) || Math.abs(now - input.createdAt) > 300
      || !domain(input.referrerDomain) || typeof input.instructions !== 'boolean' || !d) throw fail(400, 'invalid_request');
    const secret = c.env.SITE_ANALYTICS_SECRET;
    if (!secret) throw fail(503, 'unavailable');
    // The raw random page label never reaches persistence, logs, or the returned capability.
    const pageKey = await hmac(secret, `site-analytics:page-key:${input.nonce}`);
    const old = await storedReply(c.env.DB, secret, pageKey);
    if (old) return c.json(old);
    const day = dayOf(now);
    const found = labels(input.source) && labels(input.campaign) && input.source && input.campaign
      ? await c.env.DB.prepare('SELECT id FROM site_campaigns WHERE source=? AND campaign=?').bind(input.source, input.campaign).first<{ id: number }>() : null;
    const candidate = input.referrerDomain;
    // WHY one transaction: admission and the visit either both commit or both roll back.
    // The domain trigger ignores overflow, so the SELECT maps it to the bounded Other bucket.
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT OR IGNORE INTO site_daily_domains(day,domain) SELECT ?,? WHERE ?<>\'\' AND NOT EXISTS(SELECT 1 FROM site_journeys WHERE page_key=?)').bind(day, candidate, candidate, pageKey),
      c.env.DB.prepare(`INSERT OR IGNORE INTO site_journeys(page_key,day,campaign_id,referrer_domain,expires_at,update_day,instructions,windows,macos,linux,android)
        VALUES(?,?,?,CASE WHEN ?='' THEN '' WHEN EXISTS(SELECT 1 FROM site_daily_domains WHERE day=? AND domain=?) THEN ? ELSE 'Other referring sites' END,?,?,?,?,?,?,?)`)
        .bind(pageKey, day, found?.id ?? 0, candidate, day, candidate, candidate, expiryFor(day), day, input.instructions ? 1 : 0, d.Windows, d.macOS, d.Linux, d.Android),
    ]);
    const reply = await storedReply(c.env.DB, secret, pageKey);
    if (!reply) throw fail(503, 'unavailable');
    return c.json(reply);
  } catch (error) { return storageError(error); }
});
siteAnalyticsRoutes.post('/site-analytics/update', async c => {
  try {
    guard(c);
    const input = await parseFields(c, updateFields), d = counters(input.downloads), secret = c.env.SITE_ANALYTICS_SECRET;
    if (input.version !== 1 || typeof input.capability !== 'string' || input.capability.length > 256 || typeof input.instructions !== 'boolean' || !d) throw fail(400, 'invalid_request');
    if (!secret) throw fail(503, 'unavailable');
    const parts = input.capability.split('.');
    if (parts.length !== 4 || !/^[a-f0-9]{64}$/.test(parts[0]!) || !validDay(parts[1]) || !/^\d+$/.test(parts[2]!) || !/^[a-f0-9]{64}$/.test(parts[3]!)) throw fail(403, 'forbidden');
    const [pageKey, visitDay, rawExpiry, supplied] = parts as [string, string, string, string];
    const expiry = Number(rawExpiry);
    if (!Number.isSafeInteger(expiry) || expiry !== expiryFor(visitDay) || !equal(supplied, await hmac(secret, `site-analytics:capability:${pageKey}:${visitDay}:${expiry}`))) throw fail(403, 'forbidden');
    if (Math.floor(Date.now() / 1000) >= expiry) throw fail(410, 'expired');
    const old = await c.env.DB.prepare('SELECT * FROM site_journeys WHERE page_key=? AND day=? AND expires_at=?').bind(pageKey, visitDay, expiry).first<Journey>();
    if (!old) throw fail(410, 'expired');
    const merged = Math.max(old.windows, d.Windows) + Math.max(old.macos, d.macOS) + Math.max(old.linux, d.Linux) + Math.max(old.android, d.Android);
    if (merged > 100) throw fail(400, 'invalid_request');
    // Maxima plus SQL CHECK protect the cap even if concurrent updates advance other platforms.
    await c.env.DB.prepare(`UPDATE site_journeys SET update_day=?,instructions=MAX(instructions,?),windows=MAX(windows,?),macos=MAX(macos,?),linux=MAX(linux,?),android=MAX(android,?)
      WHERE page_key=? AND expires_at>?`)
      .bind(dayOf(Math.floor(Date.now() / 1000)), input.instructions ? 1 : 0, d.Windows, d.macOS, d.Linux, d.Android, pageKey, Math.floor(Date.now() / 1000)).run();
    return c.json({ ok: true });
  } catch (error) { return storageError(error); }
});

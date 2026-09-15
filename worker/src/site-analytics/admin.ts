import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { requireAdminAuth } from '../auth/admin-middleware';
import { requireAdminAccount } from '../auth/admin';
import type { HonoEnv } from '../types';
import { DAY, dayOf, fail, labels, parseFields, validDay } from './validation';

type Cursor = [string, number, string];
type Row = { day: string; campaign_id: number; source: string; campaign: string; referrerDomain: string; visits: number; instructions: number; clickedVisits: number; Windows: number; macOS: number; Linux: number; Android: number };
function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw fail(400, 'invalid_query');
  try {
    const data: unknown = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/')));
    if (Array.isArray(data) && data.length === 3 && validDay(data[0]) && Number.isSafeInteger(data[1]) && data[1] >= 0 && typeof data[2] === 'string' && data[2].length <= 253) return data as Cursor;
  } catch { /* fixed error below; never echo a cursor */ }
  throw fail(400, 'invalid_query');
}
const encodeCursor = (row: Row) => btoa(JSON.stringify([row.day, row.campaign_id, row.referrerDomain])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const websiteAdminRoutes = new Hono<HonoEnv>();
websiteAdminRoutes.get('/admin/analytics/website', requireAdminAuth, async c => {
  await requireAdminAccount(c);
  const nowSeconds = Math.floor(Date.now() / 1000), today = dayOf(nowSeconds), oldest = dayOf(nowSeconds - 89 * DAY);
  const end = c.req.query('end') ?? today;
  if (!validDay(end) || end > today || end < oldest || [...new URL(c.req.url).searchParams.keys()].some(k => !['end', 'cursor'].includes(k))) throw fail(400, 'invalid_query');
  const cursor = decodeCursor(c.req.query('cursor'));
  if (cursor && (cursor[0] < oldest || cursor[0] > end)) throw fail(400, 'invalid_query');
  // WHY an internal tuple: campaign labels may contain any printable punctuation, including separators.
  const sql = `SELECT d.day,d.campaign_id,coalesce(c.source, nullif(d.referrer_domain,''), 'Direct / unknown') source,
    coalesce(c.campaign,'') campaign,d.referrer_domain referrerDomain,d.visits,d.instructions,d.clicked_visits clickedVisits,
    d.windows Windows,d.macos macOS,d.linux Linux,d.android Android
    FROM site_daily d LEFT JOIN site_campaigns c ON c.id=d.campaign_id
    WHERE d.day>=? AND d.day<=? ${cursor ? 'AND (d.day,d.campaign_id,d.referrer_domain)>(?,?,?)' : ''}
    ORDER BY d.day,d.campaign_id,d.referrer_domain LIMIT 1000`;
  // Retention is anchored to today even when pagination's fixed end is yesterday.
  const rows = (await c.env.DB.prepare(sql).bind(oldest, end, ...(cursor ?? [])).all<Row>()).results;
  const health = await c.env.DB.prepare('SELECT last_sweep_at,last_sweep_ok,collection_started_day FROM site_analytics_health WHERE id=1').first<{ last_sweep_at: number | null; last_sweep_ok: number | null; collection_started_day: string | null }>();
  const budgets = await c.env.DB.prepare('SELECT starts,changes,cells FROM site_daily_budget WHERE day=?').bind(today).first<{ starts: number; changes: number; cells: number }>();
  return c.json({ version: 1, end, enabled: c.env.SITE_ANALYTICS_ENABLED === '1',
    retentionStart: oldest, collectionStart: health?.collection_started_day ?? null,
    health: !health || health.last_sweep_at === null ? 'unknown' : !health.last_sweep_ok ? 'failed' : nowSeconds - health.last_sweep_at > 2 * DAY ? 'stale' : 'ok',
    limited: !!budgets && (budgets.starts >= 10000 || budgets.changes >= 50000 || budgets.cells >= 1000),
    lastSweepAt: health?.last_sweep_at ?? null,
    rows: rows.map(r => ({ day: r.day, source: r.source, campaign: r.campaign, referrerDomain: r.referrerDomain, visits: r.visits, instructions: r.instructions, clickedVisits: r.clickedVisits,
      downloads: { Windows: r.Windows, macOS: r.macOS, Linux: r.Linux, Android: r.Android } })),
    cursor: rows.length === 1000 ? encodeCursor(rows[rows.length - 1]!) : null });
});
websiteAdminRoutes.post('/admin/analytics/website-campaigns', requireAdminAuth, async c => {
  await requireAdminAccount(c);
  const input = await parseFields(c, ['source', 'campaign']);
  const source = input.source, campaign = input.campaign;
  if (!labels(source) || !labels(campaign) || !source || !campaign) throw fail(400, 'invalid_request');
  const capacity = Number(c.env.SITE_CAMPAIGN_CAPACITY ?? '1000');
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100000) throw fail(503, 'unavailable');
  try {
    // Serialized SQLite INSERT plus trigger reservations prevent concurrent quota over-allocation.
    const result = await c.env.DB.prepare(`INSERT INTO site_campaigns(source,campaign,created_at) SELECT ?,?,?
      WHERE (SELECT count(*) FROM site_campaigns)<? ON CONFLICT(source,campaign) DO NOTHING`)
      .bind(source, campaign, Math.floor(Date.now() / 1000), capacity).run();
    if (result.meta.changes) return c.json({ source, campaign, created: true });
    const exists = await c.env.DB.prepare('SELECT 1 FROM site_campaigns WHERE source=? AND campaign=?').bind(source, campaign).first();
    if (exists) return c.json({ source, campaign, created: false });
    throw fail(429, 'limited');
  } catch (e) {
    if (e instanceof HTTPException) throw e;
    if (e instanceof Error && e.message.includes('site_registration_limit')) throw fail(429, 'limited');
    throw fail(503, 'unavailable');
  }
});

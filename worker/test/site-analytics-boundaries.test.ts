import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createTestAccount, issueTestSession } from './helpers';
import { siteAnalyticsRoutes } from '../src/site-analytics/routes';

const base = 'https://api.youcoded.ai';
async function ownerHeaders() {
  const account = await createTestAccount({ githubId: '424242' });
  return { Authorization: `Bearer ${await issueTestSession(account)}`, 'Content-Type': 'application/json' };
}
const day = (ago: number) => new Date(Date.now() - ago * 86400000).toISOString().slice(0, 10);

describe('website analytics request boundaries', () => {
  it('caps streamed campaign JSON even without Content-Length', async () => {
    const response = await SELF.fetch(`${base}/admin/analytics/website-campaigns`, {
      method: 'POST', headers: await ownerHeaders(), body: ' '.repeat(4200) + JSON.stringify({ source: 'reddit', campaign: 'launch' }),
    });
    expect(response.status).toBe(413);
  });
  it('retains valid emoji pairs but rejects unpaired surrogates and reserved labels', async () => {
    const headers = await ownerHeaders();
    for (const [campaign, status] of [['launch-🚀', 200], ['bad\ud800', 400], ['(untagged)', 400]] as const) {
      const response = await SELF.fetch(`${base}/admin/analytics/website-campaigns`, { method: 'POST', headers, body: JSON.stringify({ source: 'reddit', campaign }) });
      expect(response.status, campaign).toBe(status);
    }
  });
  it('historical end cannot reveal records outside today’s retained window', async () => {
    await env.DB.prepare('INSERT INTO site_daily(day,visits) VALUES(?,1)').bind(day(100)).run();
    const response = await SELF.fetch(`${base}/admin/analytics/website?end=${day(50)}`, { headers: await ownerHeaders() });
    expect(response.status).toBe(200);
    expect((await response.json() as { rows: unknown[] }).rows).toEqual([]);
  });
  it('untagged traffic uses the referring domain as the displayed source', async () => {
    await env.DB.prepare('INSERT INTO site_daily(day,referrer_domain,visits) VALUES(?,?,1)').bind(day(0), 'reddit.com').run();
    const response = await SELF.fetch(`${base}/admin/analytics/website`, { headers: await ownerHeaders() });
    expect((await response.json() as { rows: { source: string }[] }).rows[0]?.source).toBe('reddit.com');
  });
  it('rejects impossible dates and oversized or wrong-shaped cursors', async () => {
    const headers = await ownerHeaders();
    for (const query of ['end=2026-02-30', `cursor=${'x'.repeat(2000)}`, `cursor=${btoa(JSON.stringify(['bad', -1, 'domain']))}`]) {
      expect((await SELF.fetch(`${base}/admin/analytics/website?${query}`, { headers })).status).toBe(400);
    }
  });
  it('partial campaign tags still count an untagged visit without retaining the rejected label', async () => {
    const response = await SELF.fetch(`${base}/site-analytics/start`, { method: 'POST', headers: { Origin: 'https://youcoded.ai', 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, nonce: 'ab'.repeat(16), createdAt: Math.floor(Date.now()/1000), source: 'unregistered-tag', campaign: null, referrerDomain: '', instructions: false, downloads: { Windows: 0, macOS: 0, Linux: 0, Android: 0 } }) });
    expect(response.status).toBe(200);
    const report = await (await SELF.fetch(`${base}/admin/analytics/website`, { headers: await ownerHeaders() })).json() as { retentionStart: string; collectionStart: string; health: string; rows: unknown[] };
    expect(report.collectionStart).toBe(day(0));
    expect(report.retentionStart).toBe(day(89));
    expect(report.health).toBe('unknown');
    expect(JSON.stringify(report.rows)).not.toContain('unregistered-tag');
  });
  it('OFF stops before body access or database use', async () => {
    const request = new Request(`${base}/site-analytics/start`, { method: 'POST', body: 'invalid' });
    const response = await siteAnalyticsRoutes.request(request, undefined, { ...env, SITE_ANALYTICS_ENABLED: '0', DB: undefined });
    expect(response.status).toBe(404);
  });
  it('pages a full retained report without collisions from campaign punctuation', async () => {
    await env.DB.prepare("INSERT INTO site_campaigns(source,campaign,created_at) VALUES('a|b','launch|one',?)").bind(Math.floor(Date.now()/1000)).run();
    await env.DB.prepare(`WITH RECURSIVE n(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM n WHERE x<1001)
      INSERT INTO site_daily(day,campaign_id,referrer_domain,visits) SELECT ?,1,printf('d%04d.example.com',x),1 FROM n`).bind(day(0)).run();
    const headers = await ownerHeaders();
    const first = await (await SELF.fetch(`${base}/admin/analytics/website`, { headers })).json() as { rows: { referrerDomain: string }[]; cursor: string; end: string };
    expect(first.rows).toHaveLength(1000);
    const second = await (await SELF.fetch(`${base}/admin/analytics/website?end=${first.end}&cursor=${first.cursor}`, { headers })).json() as { rows: { referrerDomain: string }[]; cursor: null };
    expect(second.rows).toHaveLength(2);
    expect(second.cursor).toBeNull();
    expect(new Set([...first.rows, ...second.rows].map(r => r.referrerDomain)).size).toBe(1002);
  });
  it('refuses numeric credential-like campaign bodies without storing them', async () => {
    const response = await SELF.fetch(`${base}/admin/analytics/website-campaigns`, { method: 'POST', headers: await ownerHeaders(), body: JSON.stringify({ source: 1, campaign: 'launch', token: 'not-allowed' }) });
    expect(response.status).toBe(400);
  });
});

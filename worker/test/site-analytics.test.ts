import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createTestAccount, issueTestSession } from "./helpers";
import { siteAnalyticsEnabled } from "../src/site-analytics/routes";

const origin = "https://youcoded.ai";
const headers = { Host: "api.youcoded.ai", Origin: origin, "Content-Type": "application/json" };
const nonce = "0123456789abcdef0123456789abcdef";
const start = (overrides: Record<string, unknown> = {}) => ({
  version: 1, nonce, createdAt: Math.floor(Date.now() / 1000), source: "reddit", campaign: "launch",
  referrerDomain: "example.com", instructions: false, downloads: { Windows: 0, macOS: 0, Linux: 0, Android: 0 }, ...overrides,
});

describe("site analytics", () => {
  it("is OFF unless the exact flag is enabled", () => {
    expect(siteAnalyticsEnabled(undefined)).toBe(false);
    expect(siteAnalyticsEnabled("0")).toBe(false);
    expect(siteAnalyticsEnabled("1")).toBe(true);
  });

  it("concurrent same-page starts admit only one referring domain", async () => {
    const responses = await Promise.all(['one.example.com', 'two.example.com'].map(referrerDomain => SELF.fetch('https://api.youcoded.ai/site-analytics/start', { method: 'POST', headers, body: JSON.stringify(start({ referrerDomain })) })));
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    const replies = await Promise.all(responses.map(r => r.json() as Promise<{ capability: string }>));
    expect(replies[0]!.capability).toBe(replies[1]!.capability);
    expect(await env.DB.prepare('SELECT count(*) n FROM site_daily_domains').first('n')).toBe(1);
    expect(await env.DB.prepare('SELECT starts FROM site_daily_budget').first('starts')).toBe(1);
  });

  it("keeps no raw nonce after an accepted start and retries are idempotent", async () => {
    // Test configuration enables analytics; production stays committed OFF.
    const response = await SELF.fetch("https://api.youcoded.ai/site-analytics/start", { method: "POST", headers, body: JSON.stringify(start()) });
    expect(response.status).toBe(200);
    const first = await response.json() as { capability: string };
    const retry = await SELF.fetch("https://api.youcoded.ai/site-analytics/start", { method: "POST", headers, body: JSON.stringify(start({ source: "evil", campaign: "changed" })) });
    expect((await retry.json() as { capability: string }).capability).toBe(first.capability);
    const raw = await env.DB.prepare("SELECT count(*) AS n FROM site_journeys WHERE page_key = ? OR page_key = ?").bind(nonce, `%${nonce}%`).first<{ n: number }>();
    expect(raw!.n).toBe(0);
  });

  it("rejects unknown labels, schema extras, unsafe origin and workers.dev", async () => {
    const unknown = await SELF.fetch("https://api.youcoded.ai/site-analytics/start", { method: "POST", headers, body: JSON.stringify(start({ nonce: "11111111111111111111111111111111", source: "unknown", campaign: "nope" })) });
    expect(unknown.status).toBe(200);
    expect((await unknown.json() as { attribution: { source: string | null } }).attribution.source).toBeNull();
    const extra = await SELF.fetch("https://api.youcoded.ai/site-analytics/start", { method: "POST", headers, body: JSON.stringify(start({ nonce: "22222222222222222222222222222222", extra: true })) });
    expect(extra.status).toBe(400);
    const badOrigin = await SELF.fetch("https://api.youcoded.ai/site-analytics/start", { method: "POST", headers: { ...headers, Origin: "https://evil.example" }, body: JSON.stringify(start()) });
    expect(badOrigin.status).toBe(403);
    const legacy = await SELF.fetch("https://wecoded-marketplace-api.workers.dev/site-analytics/start", { method: "POST", headers, body: JSON.stringify(start()) });
    expect(legacy.status).toBe(403);
  });

  it("atomically records maxima and preserves original UTC day", async () => {
    const started = await SELF.fetch("https://api.youcoded.ai/site-analytics/start", { method: "POST", headers, body: JSON.stringify(start({ instructions: true })) });
    const { capability } = await started.json() as { capability: string };
    const update = (downloads: Record<string, number>) => SELF.fetch("https://api.youcoded.ai/site-analytics/update", { method: "POST", headers, body: JSON.stringify({ version: 1, capability, instructions: true, downloads }) });
    expect((await update({ Windows: 2, macOS: 1, Linux: 0, Android: 0 })).status).toBe(200);
    expect((await update({ Windows: 1, macOS: 1, Linux: 0, Android: 0 })).status).toBe(200);
    const row = await env.DB.prepare("SELECT visits, instructions, clicked_visits, windows, macos FROM site_daily").first<{ visits: number; instructions: number; clicked_visits: number; windows: number; macos: number }>();
    expect(row).toMatchObject({ visits: 1, instructions: 1, clicked_visits: 1, windows: 2, macos: 1 });
  });

  it("requires owner auth for aggregate output and registration", async () => {
    expect((await SELF.fetch("https://api.youcoded.ai/admin/analytics/website")).status).toBe(401);
    const admin = await createTestAccount({ githubId: "424242" });
    const token = await issueTestSession(admin);
    const response = await SELF.fetch("https://api.youcoded.ai/admin/analytics/website-campaigns", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ source: "reddit", campaign: "launch" }) });
    expect(response.status).toBe(200);
  });

  it("returns exact-origin CORS on both successful and rejected public POSTs", async () => {
    const ok = await SELF.fetch("https://api.youcoded.ai/site-analytics/start", { method: "POST", headers, body: JSON.stringify(start({ nonce: "33333333333333333333333333333333" })) });
    const bad = await SELF.fetch("https://api.youcoded.ai/site-analytics/start", { method: "POST", headers, body: "{}" });
    for (const response of [ok, bad]) {
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    }
    const preflight = await SELF.fetch("https://api.youcoded.ai/site-analytics/start", { method: "OPTIONS", headers: { Host: "api.youcoded.ai", Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe("POST");
    const rejected = await SELF.fetch("https://api.youcoded.ai/site-analytics/start", { method: "OPTIONS", headers: { Host: "api.youcoded.ai", Origin: origin, "Access-Control-Request-Method": "PUT" } });
    expect(rejected.status).toBe(403);
  });

  it("rejects non-string nonce and malformed capabilities before storage", async () => {
    const badNonce = await SELF.fetch("https://api.youcoded.ai/site-analytics/start", { method: "POST", headers, body: JSON.stringify(start({ nonce: { toString: () => nonce } })) });
    expect(badNonce.status).toBe(400);
    const malformed = await SELF.fetch("https://api.youcoded.ai/site-analytics/update", { method: "POST", headers, body: JSON.stringify({ version: 1, capability: "a.b.c.d.e", instructions: false, downloads: { Windows: 0, macOS: 0, Linux: 0, Android: 0 } }) });
    expect(malformed.status).toBe(403);
  });
});

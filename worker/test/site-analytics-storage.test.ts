import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { pruneExpired } from "../src/maintenance";

const day = "2026-09-14";
const tomorrow = "2026-09-15";
const timestamp = Date.parse(`${day}T00:00:00Z`) / 1000;
const key = (id: number) => id.toString(16).padStart(64, "0");
const run = (sql: string, ...args: (string | number)[]) => env.DB.prepare(sql).bind(...args).run();
const budget = (date = day) => env.DB.prepare("SELECT starts, changes, registrations, cells FROM site_daily_budget WHERE day=?").bind(date).first();
const daily = (date = day) => env.DB.prepare("SELECT visits, instructions, clicked_visits, windows, macos, linux, android FROM site_daily WHERE day=? AND campaign_id=0 AND referrer_domain=''").bind(date).first();
const start = (id = 1, domain = "", date = day, expiry = timestamp + 3600) => run(
  "INSERT OR IGNORE INTO site_journeys(page_key,day,referrer_domain,expires_at,update_day) VALUES(?,?,?,?,?)",
  key(id), date, domain, expiry, date,
);
const register = (campaign = "launch", createdAt = timestamp) => run(
  "INSERT OR IGNORE INTO site_campaigns(source,campaign,created_at) VALUES('reddit',?,?)", campaign, createdAt,
);
// WHY use the same atomic maxima shape as ingestion, but hit real D1 directly:
// route-level duplicate short circuits would conceal BEFORE INSERT trigger bugs.
const update = (windows = 0, macos = 0, instructions = 0, updateDay = day) => run(
  "UPDATE site_journeys SET windows=max(windows,?),macos=max(macos,?),instructions=max(instructions,?),update_day=? WHERE page_key=?",
  windows, macos, instructions, updateDay, key(1),
);

describe("site analytics storage invariants (real D1)", () => {
  it("keeps trigger CASE expressions parenthesized for the remote D1 statement splitter", async () => {
    // WHY local SQLite is insufficient: D1 /query mistakes a bare CASE END for a trigger END.
    // Regression for workers-sdk#4727, observed by the production migration on 2026-09-15.
    const triggers = await env.DB.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'site_%'").all<{ sql: string }>();
    expect(triggers.results).toHaveLength(6);
    for (const { sql } of triggers.results) {
      let depth = 0;
      for (const [token] of sql.matchAll(/--[^\n]*|'(?:''|[^'])*'|"(?:""|[^"])*"|\bCASE\b|[()]/gi)) {
        if (token === '(') depth++;
        if (token === ')') depth--;
        if (token.toUpperCase() === 'CASE') expect(depth, sql).toBeGreaterThan(0);
      }
    }
  });
  it("concurrent duplicate starts reserve one start, cell and visit", async () => {
    await Promise.all(Array.from({ length: 8 }, () => start()));
    expect(await budget()).toEqual({ starts: 1, changes: 0, registrations: 0, cells: 1 });
    expect(await daily()).toMatchObject({ visits: 1 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM site_journeys").first()).toEqual({ n: 1 });
  });

  it("concurrent duplicate campaigns reserve one registration", async () => {
    await Promise.all(Array.from({ length: 8 }, () => register()));
    expect(await budget()).toMatchObject({ registrations: 1 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM site_campaigns").first()).toEqual({ n: 1 });
  });

  it("at 10000 starts rejects a new page but accepts an existing page", async () => {
    await run("INSERT INTO site_daily_budget(day,starts) VALUES(?,9999)", day);
    await start();
    const before = await budget();
    await expect(start(2)).rejects.toThrow("site_start_limit");
    await expect(start()).resolves.toMatchObject({ success: true });
    expect(await budget()).toEqual(before);
    expect(await daily()).toMatchObject({ visits: 1 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM site_journeys").first()).toEqual({ n: 1 });
  });

  it("at 1000 cells rejects a new cell but accepts a new page in an existing cell", async () => {
    await run("INSERT INTO site_daily_budget(day,cells) VALUES(?,999)", day);
    await start();
    await expect(start(2, "new.example")).rejects.toThrow("site_cell_limit");
    expect(await budget()).toMatchObject({ starts: 1, cells: 1000 });
    await start(2);
    expect(await budget()).toMatchObject({ starts: 2, cells: 1000 });
    expect(await daily()).toMatchObject({ visits: 2 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM site_daily").first()).toEqual({ n: 1 });
  });

  it("at 50000 changes rejects changed maxima but permits duplicate and stale updates", async () => {
    await start();
    await run("UPDATE site_daily_budget SET changes=49999 WHERE day=?", day);
    await update(2, 0, 1);
    const before = await daily();
    await expect(update(3, 0, 1)).rejects.toThrow("site_change_limit");
    await update(2, 0, 1);
    await update(1);
    expect(await budget()).toMatchObject({ changes: 50000 });
    expect(await daily()).toEqual(before);
    expect(await env.DB.prepare("SELECT windows,instructions FROM site_journeys").first()).toEqual({ windows: 2, instructions: 1 });
  });

  it("merged platform totals over 100 roll back journey, aggregate and change reservation", async () => {
    await start();
    await update(60);
    const beforeBudget = await budget();
    const beforeDaily = await daily();
    // Each incoming platform total fits on its own; their stored maxima do not.
    await expect(update(0, 60)).rejects.toThrow("CHECK constraint failed");
    expect(await budget()).toEqual(beforeBudget);
    expect(await daily()).toEqual(beforeDaily);
    expect(await env.DB.prepare("SELECT windows,macos FROM site_journeys").first()).toEqual({ windows: 60, macos: 0 });
  });

  it("concurrent changed maxima count each independent change once, including retries", async () => {
    await start();
    await Promise.all([update(2), update(0, 3), update(0, 0, 1), update(2), update(0, 3), update(0, 0, 1)]);
    expect(await budget()).toMatchObject({ changes: 3 });
    expect(await daily()).toEqual({ visits: 1, instructions: 1, clicked_visits: 1, windows: 2, macos: 3, linux: 0, android: 0 });
  });

  it("charges new update_day, not the exhausted original day, while retaining attribution", async () => {
    await start();
    await run("UPDATE site_daily_budget SET changes=50000 WHERE day=?", day);
    await update(1, 0, 0, tomorrow);
    expect(await budget()).toMatchObject({ changes: 50000 });
    expect(await budget(tomorrow)).toEqual({ starts: 0, changes: 1, registrations: 0, cells: 0 });
    expect(await daily()).toMatchObject({ windows: 1, clicked_visits: 1 });
    expect(await daily(tomorrow)).toBeNull();
  });

  it("rejects an exhausted new update_day even when the original day has capacity", async () => {
    await start();
    await run("INSERT INTO site_daily_budget(day,changes) VALUES(?,50000)", tomorrow);
    await expect(update(1, 0, 0, tomorrow)).rejects.toThrow("site_change_limit");
    expect(await budget()).toMatchObject({ changes: 0 });
    expect(await budget(tomorrow)).toMatchObject({ changes: 50000 });
    expect(await daily()).toMatchObject({ windows: 0 });
    expect(await env.DB.prepare("SELECT update_day FROM site_journeys").first()).toEqual({ update_day: day });
  });

  it("ignores domain 129 after 128 without disturbing existing or overflow domains", async () => {
    await run("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<128) INSERT INTO site_daily_domains(day,domain) SELECT ?, 'domain-'||x||'.example' FROM n", day);
    await run("INSERT OR IGNORE INTO site_daily_domains(day,domain) VALUES(?, 'domain-129.example')", day);
    await run("INSERT OR IGNORE INTO site_daily_domains(day,domain) VALUES(?, 'domain-1.example')", day);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM site_daily_domains").first()).toEqual({ n: 128 });
    expect(await env.DB.prepare("SELECT domain FROM site_daily_domains WHERE domain='domain-129.example'").first()).toBeNull();
    await run("INSERT INTO site_daily_domains(day,domain) VALUES(?, 'Other referring sites')", day);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM site_daily_domains").first()).toEqual({ n: 129 });
  });

  it("rejects campaign 31 that day but still accepts an existing campaign", async () => {
    await run("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<30) INSERT INTO site_campaigns(source,campaign,created_at) SELECT 'reddit','campaign-'||x,? FROM n", timestamp);
    await expect(register("campaign-31")).rejects.toThrow("site_registration_limit");
    await expect(register("campaign-1")).resolves.toMatchObject({ success: true });
    expect(await budget()).toMatchObject({ registrations: 30 });
    expect(await env.DB.prepare("SELECT count(*) AS n FROM site_campaigns").first()).toEqual({ n: 30 });
  });

  it("duplicate campaign on a later day neither charges that day nor changes its creation time", async () => {
    await register();
    await register("launch", timestamp + 86400);
    expect(await budget()).toMatchObject({ registrations: 1 });
    expect(await budget(tomorrow)).toBeNull();
    expect(await env.DB.prepare("SELECT created_at FROM site_campaigns").first()).toEqual({ created_at: timestamp });
  });

  it("pruneExpired removes expired journeys and old aggregates but keeps the retention boundary", async () => {
    const boundary = new Date((timestamp - 89 * 86400) * 1000).toISOString().slice(0, 10);
    const expiredDay = new Date((timestamp - 90 * 86400) * 1000).toISOString().slice(0, 10);
    await start(1, "", expiredDay, timestamp - 1);
    await start(2, "", boundary, timestamp);
    await start(3, "", day, timestamp + 1);
    for (const date of [expiredDay, boundary, day]) {
      await run("INSERT INTO site_daily_domains(day,domain) VALUES(?,'example.com')", date);
    }
    await register();
    await pruneExpired(env.DB, timestamp);
    expect(await env.DB.prepare("SELECT page_key FROM site_journeys").all()).toMatchObject({ results: [{ page_key: key(3) }] });
    for (const table of ["site_daily", "site_daily_domains", "site_daily_budget"]) {
      expect((await env.DB.prepare(`SELECT DISTINCT day FROM ${table} ORDER BY day`).all()).results).toEqual([{ day: boundary }, { day }]);
    }
    expect(await env.DB.prepare("SELECT count(*) AS n FROM site_campaigns").first()).toEqual({ n: 1 });
    expect(await env.DB.prepare("SELECT last_sweep_at,last_sweep_ok,last_sweep_error FROM site_analytics_health").first()).toEqual({ last_sweep_at: timestamp, last_sweep_ok: 1, last_sweep_error: null });
  });
});

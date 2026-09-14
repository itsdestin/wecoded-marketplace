import { env, SELF } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTestAccount, issueTestSession } from "./helpers";

// Admin caller: an account whose github identity id matches ADMIN_USER_IDS
// ("424242" in [env.test.vars]). isAdminAccount looks this up in `identities`.
async function seedAdmin(): Promise<string> {
  const acct = await createTestAccount({ githubId: "424242" });
  return issueTestSession(acct);
}

function mockCfSql(rows: unknown[]) {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ meta: [], data: rows }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  ) as any;
}

const origFetch = globalThis.fetch;

async function clearAuth() {
  for (const t of ["sessions", "identities", "users"]) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
}

// Fetches `path` as the admin and returns the SQL sent to the (mocked) AE API.
async function sqlFor(token: string, path: string): Promise<string> {
  const res = await SELF.fetch(`https://test.local${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status).toBe(200);
  const calls = (globalThis.fetch as any).mock.calls;
  return calls[calls.length - 1][1].body as string;
}

// Params that must never leak into the SQL: an unsupported platform, a version
// carrying a quote, a non-numeric offset and a non-"1" hide_test.
const INVALID_FILTERS =
  `platform=ios&version=${encodeURIComponent("1';DROP")}&tz_offset=abc&hide_test=yes`;

function expectNoRowFilters(sql: string) {
  expect(sql).not.toContain("blob4 =");
  expect(sql).not.toContain("blob3 =");
  expect(sql).not.toContain("NOT LIKE");
  expect(sql).not.toContain("MINUTE");
  expect(sql).not.toContain("DROP");
}

describe("GET /admin/analytics/dau", () => {
  beforeEach(async () => { await clearAuth(); mockCfSql([{ day: "2026-05-15", devices: 5 }]); });
  afterEach(() => { globalThis.fetch = origFetch; });

  it("returns 401 without auth", async () => {
    const res = await SELF.fetch("https://test.local/admin/analytics/dau");
    expect(res.status).toBe(401);
  });

  it("returns 'devices' column for an admin", async () => {
    const token = await seedAdmin();
    const res = await SELF.fetch("https://test.local/admin/analytics/dau", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json<Array<{ day: string; devices: number }>>();
    expect(body).toEqual([{ day: "2026-05-15", devices: 5 }]);
    const sql = (globalThis.fetch as any).mock.calls[0][1].body as string;
    expect(sql).toContain("count(DISTINCT blob2) AS devices");
  });

  // Test env config: CUTOVER_TIMESTAMP and KNOWN_DEV_DEVICES are set as
  // non-empty in [env.test.vars] (wrangler.toml). They flow into c.env at
  // route-handle time and should be interpolated into the SQL.
  it("includes cutover clause from CUTOVER_TIMESTAMP", async () => {
    const token = await seedAdmin();
    await SELF.fetch("https://test.local/admin/analytics/dau", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sql = (globalThis.fetch as any).mock.calls[0][1].body as string;
    expect(sql).toContain("toDateTime('2026-05-15T00:00:00Z')");
  });

  it("includes admin filter from KNOWN_DEV_DEVICES", async () => {
    const token = await seedAdmin();
    await SELF.fetch("https://test.local/admin/analytics/dau", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sql = (globalThis.fetch as any).mock.calls[0][1].body as string;
    expect(sql).toContain(`AND blob2 NOT IN ('${"a".repeat(64)}')`);
  });

  it("?include_admins=1 omits the admin filter", async () => {
    const token = await seedAdmin();
    await SELF.fetch("https://test.local/admin/analytics/dau?include_admins=1", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sql = (globalThis.fetch as any).mock.calls[0][1].body as string;
    expect(sql).not.toContain("NOT IN");
  });

  it("without params keeps the original N-day UTC window (older callers unchanged)", async () => {
    const token = await seedAdmin();
    const sql = await sqlFor(token, "/admin/analytics/dau");
    expect(sql).toContain("toDate(timestamp) AS day");
    expect(sql).toContain("INTERVAL '30' DAY");
    expectNoRowFilters(sql);
  });

  it("applies tz_offset, platform, version and hide_test", async () => {
    const token = await seedAdmin();
    const sql = await sqlFor(
      token,
      "/admin/analytics/dau?days=7&tz_offset=-300&platform=android&version=1.2.3&hide_test=1"
    );
    expect(sql).toContain("toDate((timestamp - INTERVAL '300' MINUTE)) AS day");
    expect(sql).toContain("INTERVAL '8' DAY");
    expect(sql).toContain("AND blob4 = 'android'");
    expect(sql).toContain("AND blob3 = '1.2.3'");
    expect(sql).toContain("AND blob3 NOT LIKE '%-releasetest' AND blob3 NOT LIKE '%-dev'");
  });

  it("drops invalid params and clamps days", async () => {
    const token = await seedAdmin();
    const sql = await sqlFor(token, `/admin/analytics/dau?days=999&${INVALID_FILTERS}`);
    expect(sql).toContain("toDate(timestamp) AS day");
    expect(sql).toContain("INTERVAL '90' DAY");
    expectNoRowFilters(sql);
  });
});

describe("GET /admin/analytics/mau", () => {
  beforeEach(async () => { await clearAuth(); mockCfSql([{ devices: 16 }]); });
  afterEach(() => { globalThis.fetch = origFetch; });

  it("returns devices count under mau key", async () => {
    const token = await seedAdmin();
    const res = await SELF.fetch("https://test.local/admin/analytics/mau", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ mau: number }>();
    expect(body).toEqual({ mau: 16 });
    const sql = (globalThis.fetch as any).mock.calls[0][1].body as string;
    expect(sql).toContain("count(DISTINCT blob2) AS devices");
    expectNoRowFilters(sql);
  });

  it("applies platform, version and hide_test but not tz_offset", async () => {
    const token = await seedAdmin();
    const sql = await sqlFor(
      token,
      "/admin/analytics/mau?platform=desktop&version=1.0&hide_test=1&tz_offset=60"
    );
    expect(sql).toContain("INTERVAL '30' DAY");
    expect(sql).toContain("AND blob4 = 'desktop'");
    expect(sql).toContain("AND blob3 = '1.0'");
    expect(sql).toContain("NOT LIKE '%-dev'");
    expect(sql).not.toContain("MINUTE");
  });

  it("drops invalid params", async () => {
    const token = await seedAdmin();
    expectNoRowFilters(await sqlFor(token, `/admin/analytics/mau?${INVALID_FILTERS}`));
  });
});

describe("GET /admin/analytics/versions", () => {
  beforeEach(async () => { await clearAuth(); mockCfSql([{ version: "1.3.0", devices: 5 }]); });
  afterEach(() => { globalThis.fetch = origFetch; });

  it("returns devices column", async () => {
    const token = await seedAdmin();
    const res = await SELF.fetch("https://test.local/admin/analytics/versions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const sql = (globalThis.fetch as any).mock.calls[0][1].body as string;
    expect(sql).toContain("count(DISTINCT blob2) AS devices");
    expect(sql).toContain("blob3 AS version");
    // Default stays the original rolling 24h.
    expect(sql).toContain("INTERVAL '1' DAY");
    expectNoRowFilters(sql);
  });

  it("applies days, platform and hide_test but not version", async () => {
    const token = await seedAdmin();
    const sql = await sqlFor(
      token,
      "/admin/analytics/versions?days=7&platform=android&hide_test=1&version=1.0"
    );
    expect(sql).toContain("INTERVAL '7' DAY");
    expect(sql).toContain("AND blob4 = 'android'");
    expect(sql).toContain("NOT LIKE '%-releasetest'");
    expect(sql).not.toContain("blob3 =");
  });

  it("clamps days and drops invalid params", async () => {
    const token = await seedAdmin();
    const sql = await sqlFor(token, `/admin/analytics/versions?days=999&${INVALID_FILTERS}`);
    expect(sql).toContain("INTERVAL '90' DAY");
    expectNoRowFilters(sql);
  });
});

describe("GET /admin/analytics/platforms", () => {
  beforeEach(async () => { await clearAuth(); mockCfSql([{ platform: "desktop", devices: 11 }]); });
  afterEach(() => { globalThis.fetch = origFetch; });

  it("returns devices column", async () => {
    const token = await seedAdmin();
    const res = await SELF.fetch("https://test.local/admin/analytics/platforms", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const sql = (globalThis.fetch as any).mock.calls[0][1].body as string;
    expect(sql).toContain("count(DISTINCT blob2) AS devices");
    expect(sql).toContain("blob4 AS platform");
    expectNoRowFilters(sql);
  });

  it("applies version and hide_test but not platform", async () => {
    const token = await seedAdmin();
    const sql = await sqlFor(
      token,
      "/admin/analytics/platforms?version=1.0&hide_test=1&platform=android"
    );
    expect(sql).toContain("AND blob3 = '1.0'");
    expect(sql).toContain("NOT LIKE '%-dev'");
    expect(sql).not.toContain("blob4 =");
  });

  it("drops invalid params", async () => {
    const token = await seedAdmin();
    expectNoRowFilters(await sqlFor(token, `/admin/analytics/platforms?${INVALID_FILTERS}`));
  });
});

describe("GET /admin/analytics/countries", () => {
  beforeEach(async () => { await clearAuth(); mockCfSql([{ country: "US", devices: 15 }]); });
  afterEach(() => { globalThis.fetch = origFetch; });

  it("returns devices column", async () => {
    const token = await seedAdmin();
    const res = await SELF.fetch("https://test.local/admin/analytics/countries", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const sql = (globalThis.fetch as any).mock.calls[0][1].body as string;
    expect(sql).toContain("count(DISTINCT blob2) AS devices");
    expect(sql).toContain("blob6 AS country");
    expect(sql).toContain("LIMIT 20");
  });

  // Privacy policy (2026-09-13): geography is never combined with other dimensions.
  it("ignores every filter param", async () => {
    const token = await seedAdmin();
    const plain = await sqlFor(token, "/admin/analytics/countries");
    const filtered = await sqlFor(
      token,
      "/admin/analytics/countries?platform=android&version=1.0&hide_test=1&tz_offset=60"
    );
    expect(filtered).toBe(plain);
  });
});

describe("GET /admin/analytics/regions", () => {
  beforeEach(async () => {
    await clearAuth();
    mockCfSql([
      { region: "US-CA", devices: 5 },
      { region: "US-TX", devices: 3 },
    ]);
  });
  afterEach(() => { globalThis.fetch = origFetch; });

  it("returns top regions for an admin", async () => {
    const token = await seedAdmin();
    const res = await SELF.fetch("https://test.local/admin/analytics/regions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json<Array<{ region: string; devices: number }>>();
    expect(body).toEqual([
      { region: "US-CA", devices: 5 },
      { region: "US-TX", devices: 3 },
    ]);
    const sql = (globalThis.fetch as any).mock.calls[0][1].body as string;
    expect(sql).toContain("blob7 AS region");
    expect(sql).toContain("LIMIT 20");
  });

  it("returns 401 without auth", async () => {
    const res = await SELF.fetch("https://test.local/admin/analytics/regions");
    expect(res.status).toBe(401);
  });

  // Privacy policy (2026-09-13): geography is never combined with other dimensions.
  it("ignores every filter param", async () => {
    const token = await seedAdmin();
    const plain = await sqlFor(token, "/admin/analytics/regions");
    const filtered = await sqlFor(
      token,
      "/admin/analytics/regions?platform=android&version=1.0&hide_test=1&tz_offset=60"
    );
    expect(filtered).toBe(plain);
  });
});

describe("GET /admin/analytics/installs (derived from first-seen)", () => {
  beforeEach(async () => {
    await clearAuth();
    mockCfSql([{ day: "2026-05-15", installs: 7 }]);
  });
  afterEach(() => { globalThis.fetch = origFetch; });

  it("returns derived first-seen counts for an admin", async () => {
    const token = await seedAdmin();
    const res = await SELF.fetch("https://test.local/admin/analytics/installs?days=7", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json<Array<{ day: string; installs: number }>>();
    expect(body).toEqual([{ day: "2026-05-15", installs: 7 }]);
    const sql = (globalThis.fetch as any).mock.calls[0][1].body as string;
    expect(sql).toContain("MIN(timestamp) AS first_seen");
    expect(sql).toContain("INTERVAL '7' DAY");
    expectNoRowFilters(sql);
  });

  it("applies tz_offset, platform and hide_test but not version", async () => {
    const token = await seedAdmin();
    const sql = await sqlFor(
      token,
      "/admin/analytics/installs?tz_offset=60&platform=desktop&hide_test=1&version=1.0"
    );
    expect(sql).toContain("MIN((timestamp + INTERVAL '60' MINUTE)) AS first_seen");
    expect(sql).toContain("toDate(toStartOfDay(first_seen)) AS day");
    expect(sql).toContain("AND blob4 = 'desktop'");
    expect(sql).toContain("NOT LIKE '%-releasetest'");
    expect(sql).not.toContain("blob3 =");
  });

  it("drops invalid params", async () => {
    const token = await seedAdmin();
    expectNoRowFilters(await sqlFor(token, `/admin/analytics/installs?${INVALID_FILTERS}`));
  });
});

describe("GET /admin/analytics/active-by-version", () => {
  const rows = [
    { day: "2026-09-12", version: "1.4.0", devices: 4 },
    { day: "2026-09-12", version: "1.3.9", devices: 2 },
  ];
  beforeEach(async () => { await clearAuth(); mockCfSql(rows); });
  afterEach(() => { globalThis.fetch = origFetch; });

  it("returns 401 without auth", async () => {
    const res = await SELF.fetch("https://test.local/admin/analytics/active-by-version");
    expect(res.status).toBe(401);
  });

  it("returns rows as-is with the day × version grouping", async () => {
    const token = await seedAdmin();
    const res = await SELF.fetch("https://test.local/admin/analytics/active-by-version", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
    const sql = (globalThis.fetch as any).mock.calls[0][1].body as string;
    expect(sql).toContain(
      "SELECT toDate(timestamp) AS day, blob3 AS version, count(DISTINCT blob2) AS devices"
    );
    expect(sql).toContain("INTERVAL '30' DAY");
    expect(sql).toContain("GROUP BY day, version ORDER BY day");
    expect(sql).toContain("toDateTime('2026-05-15T00:00:00Z')");
    expect(sql).toContain(`AND blob2 NOT IN ('${"a".repeat(64)}')`);
    expectNoRowFilters(sql);
  });

  it("applies tz_offset, platform and hide_test but not version", async () => {
    const token = await seedAdmin();
    const sql = await sqlFor(
      token,
      "/admin/analytics/active-by-version?days=14&tz_offset=120&platform=android&hide_test=1&version=1.0"
    );
    expect(sql).toContain("toDate((timestamp + INTERVAL '120' MINUTE)) AS day");
    expect(sql).toContain("INTERVAL '15' DAY");
    expect(sql).toContain("AND blob4 = 'android'");
    expect(sql).toContain("NOT LIKE '%-dev'");
    expect(sql).not.toContain("blob3 =");
  });

  it("drops invalid params and clamps days", async () => {
    const token = await seedAdmin();
    const sql = await sqlFor(
      token,
      `/admin/analytics/active-by-version?days=999&${INVALID_FILTERS}`
    );
    expect(sql).toContain("INTERVAL '90' DAY");
    expectNoRowFilters(sql);
  });
});

describe("GET /admin/analytics/weekly", () => {
  const rows = [{ week: "2026-09-07", devices: 12 }];
  beforeEach(async () => { await clearAuth(); mockCfSql(rows); });
  afterEach(() => { globalThis.fetch = origFetch; });

  it("returns 401 without auth", async () => {
    const res = await SELF.fetch("https://test.local/admin/analytics/weekly");
    expect(res.status).toBe(401);
  });

  it("defaults to 12 weeks, capped at the 90-day window", async () => {
    const token = await seedAdmin();
    const res = await SELF.fetch("https://test.local/admin/analytics/weekly", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
    const sql = (globalThis.fetch as any).mock.calls[0][1].body as string;
    expect(sql).toContain("SELECT toStartOfWeek(timestamp) AS week, count(DISTINCT blob2) AS devices");
    expect(sql).toContain("INTERVAL '90' DAY");
    expect(sql).toContain("GROUP BY week ORDER BY week");
    expect(sql).toContain(`AND blob2 NOT IN ('${"a".repeat(64)}')`);
    expectNoRowFilters(sql);
  });

  it("applies weeks, tz_offset, platform, version and hide_test", async () => {
    const token = await seedAdmin();
    const sql = await sqlFor(
      token,
      "/admin/analytics/weekly?weeks=2&tz_offset=-60&platform=desktop&version=1.4.0&hide_test=1"
    );
    expect(sql).toContain("toStartOfWeek((timestamp - INTERVAL '60' MINUTE)) AS week");
    expect(sql).toContain("INTERVAL '21' DAY");
    expect(sql).toContain("AND blob4 = 'desktop'");
    expect(sql).toContain("AND blob3 = '1.4.0'");
    expect(sql).toContain("NOT LIKE '%-releasetest'");
  });

  it("clamps weeks and drops invalid params", async () => {
    const token = await seedAdmin();
    const high = await sqlFor(token, `/admin/analytics/weekly?weeks=999&${INVALID_FILTERS}`);
    expect(high).toContain("INTERVAL '90' DAY");
    expectNoRowFilters(high);
    const low = await sqlFor(token, "/admin/analytics/weekly?weeks=-5");
    expect(low).toContain("INTERVAL '14' DAY");
    const junk = await sqlFor(token, "/admin/analytics/weekly?weeks=abc");
    expect(junk).toContain("INTERVAL '90' DAY");
  });
});

describe("GET /admin/analytics/retention", () => {
  const rows = [{ cohort: "2026-08-31", devices: 10, d1: 6, d7: 4, d14: 3, d30: 0 }];
  beforeEach(async () => { await clearAuth(); mockCfSql(rows); });
  afterEach(() => { globalThis.fetch = origFetch; });

  it("returns 401 without auth", async () => {
    const res = await SELF.fetch("https://test.local/admin/analytics/retention");
    expect(res.status).toBe(401);
  });

  it("returns cohort rows over an 8-week default window", async () => {
    const token = await seedAdmin();
    const res = await SELF.fetch("https://test.local/admin/analytics/retention", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rows);
    const sql = (globalThis.fetch as any).mock.calls[0][1].body as string;
    expect(sql).toContain("SELECT toStartOfWeek(first_seen) AS cohort, count() AS devices");
    const since = "toUnixTimestamp(last_seen) - toUnixTimestamp(toStartOfDay(first_seen))";
    expect(sql).toContain(`countIf(${since} >= 86400) AS d1`);
    expect(sql).toContain(`countIf(${since} >= 604800) AS d7`);
    expect(sql).toContain(`countIf(${since} >= 1209600) AS d14`);
    expect(sql).toContain(`countIf(${since} >= 2592000) AS d30`);
    expect(sql).toContain("MIN(timestamp) AS first_seen, MAX(timestamp) AS last_seen");
    expect(sql).toContain("INTERVAL '56' DAY");
    expect(sql).toContain("GROUP BY cohort ORDER BY cohort");
    expect(sql).toContain(`AND blob2 NOT IN ('${"a".repeat(64)}')`);
    // Privacy: blob2 only appears inside the per-device subquery.
    expect(sql.slice(0, sql.indexOf("FROM ("))).not.toContain("blob2");
    expectNoRowFilters(sql);
  });

  it("applies weeks, tz_offset and platform but not version or hide_test", async () => {
    const token = await seedAdmin();
    const sql = await sqlFor(
      token,
      "/admin/analytics/retention?weeks=4&tz_offset=120&platform=desktop&version=1.0&hide_test=1"
    );
    expect(sql).toContain(
      "MIN((timestamp + INTERVAL '120' MINUTE)) AS first_seen, MAX((timestamp + INTERVAL '120' MINUTE)) AS last_seen"
    );
    expect(sql).toContain("INTERVAL '28' DAY");
    expect(sql).toContain("AND blob4 = 'desktop'");
    expect(sql).not.toContain("blob3");
    expect(sql).not.toContain("NOT LIKE");
  });

  it("clamps weeks and drops invalid params", async () => {
    const token = await seedAdmin();
    const sql = await sqlFor(token, `/admin/analytics/retention?weeks=999&${INVALID_FILTERS}`);
    expect(sql).toContain("INTERVAL '84' DAY");
    expectNoRowFilters(sql);
  });
});

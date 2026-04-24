import { env, SELF } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

async function seed(userId: string, login = "u"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("INSERT INTO users (id, github_login, created_at) VALUES (?, ?, ?)")
    .bind(userId, login, now).run();
  const token = `tok-${userId}`;
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(token))))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)")
    .bind(hash, userId, now, now).run();
  return token;
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

describe("GET /admin/analytics/dau", () => {
  beforeEach(async () => {
    for (const t of ["sessions","users"]) {
      await env.DB.prepare(`DELETE FROM ${t}`).run();
    }
    mockCfSql([{ day: "2026-04-22", dau: 42 }]);
  });
  afterEach(() => { globalThis.fetch = origFetch; });

  it("returns 401 without auth", async () => {
    const res = await SELF.fetch("https://test.local/admin/analytics/dau");
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    const token = await seed("github:notadmin");
    const res = await SELF.fetch("https://test.local/admin/analytics/dau", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("returns the SQL rows for an admin", async () => {
    const token = await seed("github:admin");
    const res = await SELF.fetch("https://test.local/admin/analytics/dau", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json<Array<{ day: string; dau: number }>>();
    expect(body).toEqual([{ day: "2026-04-22", dau: 42 }]);
  });

  it("clamps the days param to a safe range", async () => {
    const token = await seed("github:admin");
    const res = await SELF.fetch("https://test.local/admin/analytics/dau?days=9999", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const sqlBody = (globalThis.fetch as any).mock.calls[0][1].body as string;
    // SQL is built server-side — clamped to at most 90 (ClickHouse takes an
    // unquoted integer literal for INTERVAL).
    expect(sqlBody).toMatch(/INTERVAL 90 DAY/);
  });
});

describe("GET /admin/analytics/mau", () => {
  beforeEach(async () => {
    for (const t of ["sessions","users"]) {
      await env.DB.prepare(`DELETE FROM ${t}`).run();
    }
    mockCfSql([{ mau: 1337 }]);
  });
  afterEach(() => { globalThis.fetch = origFetch; });

  it("returns the mau number for admin", async () => {
    const token = await seed("github:admin");
    const res = await SELF.fetch("https://test.local/admin/analytics/mau", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ mau: number }>();
    expect(body.mau).toBe(1337);
  });
});

describe("GET /admin/analytics/versions", () => {
  beforeEach(async () => {
    for (const t of ["sessions","users"]) {
      await env.DB.prepare(`DELETE FROM ${t}`).run();
    }
    mockCfSql([{ version: "1.2.1", users: 10 }, { version: "1.2.0", users: 3 }]);
  });
  afterEach(() => { globalThis.fetch = origFetch; });

  it("returns rows as provided", async () => {
    const token = await seed("github:admin");
    const res = await SELF.fetch("https://test.local/admin/analytics/versions", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json<Array<{ version: string; users: number }>>();
    expect(body.length).toBe(2);
    expect(body[0]?.version).toBe("1.2.1");
  });
});

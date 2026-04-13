import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";

async function seed(userId = "github:42"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("INSERT INTO users (id, github_login, created_at) VALUES (?, ?, ?)")
    .bind(userId, "testy", now).run();
  const token = `tok-${userId}`;
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(token))))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)")
    .bind(hash, userId, now, now).run();
  return token;
}

async function seedInstall(userId: string, pluginId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("INSERT INTO installs (user_id, plugin_id, installed_at) VALUES (?, ?, ?)")
    .bind(userId, pluginId, now).run();
}

describe("POST /ratings", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM sessions").run();
    await env.DB.prepare("DELETE FROM users").run();
    await env.DB.prepare("DELETE FROM installs").run();
    await env.DB.prepare("DELETE FROM ratings").run();
  });

  it("403s when the user has not installed the plugin", async () => {
    const token = await seed();
    const res = await SELF.fetch("https://test.local/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plugin_id: "foo:bar", stars: 5 }),
    });
    expect(res.status).toBe(403);
  });

  it("accepts a rating when the user has installed the plugin", async () => {
    const token = await seed();
    await seedInstall("github:42", "foo:bar");
    const res = await SELF.fetch("https://test.local/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plugin_id: "foo:bar", stars: 4, review_text: "solid" }),
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT stars, review_text FROM ratings WHERE user_id = ? AND plugin_id = ?")
      .bind("github:42", "foo:bar").first<{ stars: number; review_text: string }>();
    expect(row).toEqual({ stars: 4, review_text: "solid" });
  });

  it("updates an existing rating (upsert)", async () => {
    const token = await seed();
    await seedInstall("github:42", "foo:bar");
    const post = (body: unknown) => SELF.fetch("https://test.local/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    await post({ plugin_id: "foo:bar", stars: 4, review_text: "solid" });
    await post({ plugin_id: "foo:bar", stars: 2, review_text: "changed my mind" });
    const row = await env.DB.prepare("SELECT stars, review_text FROM ratings WHERE user_id = ? AND plugin_id = ?")
      .bind("github:42", "foo:bar").first();
    expect(row).toEqual({ stars: 2, review_text: "changed my mind" });
    const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM ratings").all<{ n: number }>();
    expect(results[0]?.n).toBe(1);
  });

  it("rejects stars outside 1-5", async () => {
    const token = await seed();
    await seedInstall("github:42", "foo:bar");
    for (const bad of [0, 6, 3.5, -1]) {
      const res = await SELF.fetch("https://test.local/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plugin_id: "foo:bar", stars: bad }),
      });
      expect(res.status).toBe(400);
    }
  });
});

describe("GET /ratings/:plugin_id", () => {
  beforeEach(async () => {
    for (const t of ["sessions", "users", "installs", "ratings"]) {
      await env.DB.prepare(`DELETE FROM ${t}`).run();
    }
  });

  // Helper: insert a user + rating row directly (bypasses install/moderation checks).
  async function seedRating(opts: {
    userId: string;
    login: string;
    avatarUrl?: string | null;
    pluginId: string;
    stars: number;
    reviewText?: string | null;
    hidden?: number;
    createdAt?: number;
  }): Promise<void> {
    const now = opts.createdAt ?? Math.floor(Date.now() / 1000);
    await env.DB
      .prepare("INSERT INTO users (id, github_login, github_avatar_url, created_at) VALUES (?, ?, ?, ?)")
      .bind(opts.userId, opts.login, opts.avatarUrl ?? null, now)
      .run();
    await env.DB
      .prepare(
        `INSERT INTO ratings (user_id, plugin_id, stars, review_text, created_at, updated_at, hidden)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(opts.userId, opts.pluginId, opts.stars, opts.reviewText ?? null, now, now, opts.hidden ?? 0)
      .run();
  }

  it("returns empty array when plugin has no ratings", async () => {
    const res = await SELF.fetch("https://test.local/ratings/no-such:plugin");
    expect(res.status).toBe(200);
    const body = await res.json() as { ratings: unknown[] };
    expect(body.ratings).toEqual([]);
  });

  it("returns visible ratings with joined user fields", async () => {
    await seedRating({
      userId: "github:10",
      login: "alice",
      avatarUrl: "https://avatars.githubusercontent.com/u/10",
      pluginId: "foo:bar",
      stars: 5,
      reviewText: "love it",
    });

    const res = await SELF.fetch("https://test.local/ratings/foo:bar");
    expect(res.status).toBe(200);
    const body = await res.json() as { ratings: Array<Record<string, unknown>> };
    expect(body.ratings).toHaveLength(1);
    // Non-null assertion is safe: we just asserted length === 1 above.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const r = body.ratings[0]!;
    expect(r.user_id).toBe("github:10");
    expect(r.user_login).toBe("alice");
    expect(r.user_avatar_url).toBe("https://avatars.githubusercontent.com/u/10");
    expect(r.stars).toBe(5);
    expect(r.review_text).toBe("love it");
    expect(typeof r.created_at).toBe("number");
    // id is a stable composite key for React list rendering
    expect(r.id).toBe("github:10:foo:bar");
  });

  it("excludes hidden ratings", async () => {
    // Visible rating
    await seedRating({ userId: "github:11", login: "bob", pluginId: "foo:bar", stars: 4, hidden: 0 });
    // Hidden (moderated) rating
    await seedRating({ userId: "github:12", login: "mallory", pluginId: "foo:bar", stars: 1, reviewText: "bad content", hidden: 1 });

    const res = await SELF.fetch("https://test.local/ratings/foo:bar");
    const body = await res.json() as { ratings: Array<Record<string, unknown>> };
    // Only the visible one should appear
    expect(body.ratings).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(body.ratings[0]!.user_id).toBe("github:11");
  });

  it("returns results ordered by created_at DESC (newest first)", async () => {
    const base = Math.floor(Date.now() / 1000);
    await seedRating({ userId: "github:20", login: "old", pluginId: "p:1", stars: 3, createdAt: base - 200 });
    await seedRating({ userId: "github:21", login: "newer", pluginId: "p:1", stars: 4, createdAt: base - 100 });
    await seedRating({ userId: "github:22", login: "newest", pluginId: "p:1", stars: 5, createdAt: base });

    const res = await SELF.fetch("https://test.local/ratings/p:1");
    const body = await res.json() as { ratings: Array<{ user_login: string }> };
    expect(body.ratings.map((r) => r.user_login)).toEqual(["newest", "newer", "old"]);
  });

  it("caps results at 50 rows", async () => {
    // Seed 55 distinct users all rating the same plugin.
    const base = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 55; i++) {
      await seedRating({
        userId: `github:cap${i}`,
        login: `user${i}`,
        pluginId: "cap:test",
        stars: (i % 5) + 1,
        createdAt: base + i,  // distinct timestamps so order is deterministic
      });
    }

    const res = await SELF.fetch("https://test.local/ratings/cap:test");
    const body = await res.json() as { ratings: unknown[] };
    expect(body.ratings).toHaveLength(50);
  });
});

describe("DELETE /ratings/:plugin_id", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM sessions").run();
    await env.DB.prepare("DELETE FROM users").run();
    await env.DB.prepare("DELETE FROM installs").run();
    await env.DB.prepare("DELETE FROM ratings").run();
  });

  it("deletes only the caller's rating", async () => {
    const tokenA = await seed("github:1");
    const tokenB = await seed("github:2");
    await seedInstall("github:1", "foo:bar");
    await seedInstall("github:2", "foo:bar");
    const postA = await SELF.fetch("https://test.local/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenA}` },
      body: JSON.stringify({ plugin_id: "foo:bar", stars: 5 }),
    });
    expect(postA.status).toBe(200);
    const postB = await SELF.fetch("https://test.local/ratings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenB}` },
      body: JSON.stringify({ plugin_id: "foo:bar", stars: 1 }),
    });
    expect(postB.status).toBe(200);

    const del = await SELF.fetch("https://test.local/ratings/foo:bar", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    expect(del.status).toBe(200);

    const { results } = await env.DB.prepare("SELECT user_id FROM ratings").all<{ user_id: string }>();
    expect(results.map(r => r.user_id)).toEqual(["github:2"]);
  });
});

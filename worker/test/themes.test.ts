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

describe("POST /themes/:id/like", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM sessions").run();
    await env.DB.prepare("DELETE FROM users").run();
    await env.DB.prepare("DELETE FROM theme_likes").run();
  });

  it("adds a like on first call", async () => {
    const token = await seed();
    const res = await SELF.fetch("https://test.local/themes/strawberry-kitty/like", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ liked: true });
  });

  it("toggles off on second call", async () => {
    const token = await seed();
    for (let i = 0; i < 2; i++) {
      await SELF.fetch("https://test.local/themes/strawberry-kitty/like", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM theme_likes").all<{ n: number }>();
    expect(results[0]?.n).toBe(0);
  });
});

import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";

async function seedUserAndToken(userId = "github:42", login = "testy"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("INSERT INTO users (id, github_login, created_at) VALUES (?, ?, ?)")
    .bind(userId, login, now).run();
  const token = "test-token-abcd";
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(token))))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES (?, ?, ?, ?)")
    .bind(hash, userId, now, now).run();
  return token;
}

describe("POST /installs", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM sessions").run();
    await env.DB.prepare("DELETE FROM users").run();
    await env.DB.prepare("DELETE FROM installs").run();
  });

  it("401s without a token", async () => {
    const res = await SELF.fetch("https://test.local/installs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plugin_id: "commit-commands:commit" }),
    });
    expect(res.status).toBe(401);
  });

  it("records an install for an authenticated user", async () => {
    const token = await seedUserAndToken();
    const res = await SELF.fetch("https://test.local/installs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ plugin_id: "commit-commands:commit" }),
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare("SELECT user_id, plugin_id FROM installs WHERE plugin_id = ?")
      .bind("commit-commands:commit").first();
    expect(row).toEqual(expect.objectContaining({ user_id: "github:42" }));
  });

  it("is idempotent (re-installing the same plugin does not error)", async () => {
    const token = await seedUserAndToken();
    for (let i = 0; i < 2; i++) {
      const res = await SELF.fetch("https://test.local/installs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plugin_id: "commit-commands:commit" }),
      });
      expect(res.status).toBe(200);
    }
    const { results } = await env.DB.prepare("SELECT COUNT(*) AS n FROM installs").all<{ n: number }>();
    expect(results[0]?.n).toBe(1);
  });
});

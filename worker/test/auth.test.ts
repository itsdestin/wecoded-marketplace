import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("POST /auth/github/start", () => {
  it("returns a device_code, user_code, and auth URL", async () => {
    const res = await SELF.fetch("https://test.local/auth/github/start", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as { device_code: string; user_code: string; auth_url: string; expires_in: number };
    expect(body.device_code).toMatch(/^[0-9a-f]{64}$/);
    expect(body.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // Plan's /auth/github/start returns a URL pointing at our own /start-redirect
    // page (which 302s to GitHub's authorize URL, which has the callback as
    // redirect_uri). So we assert against the actual returned string.
    expect(body.auth_url).toContain("/auth/github/start-redirect");
    expect(body.expires_in).toBe(900);
  });

  it("persists the device_code in the database", async () => {
    const res = await SELF.fetch("https://test.local/auth/github/start", { method: "POST" });
    const { device_code } = await res.json() as { device_code: string };
    const row = await env.DB.prepare("SELECT * FROM device_codes WHERE device_code = ?")
      .bind(device_code).first();
    expect(row).not.toBeNull();
  });
});

describe("POST /auth/github/poll", () => {
  it("returns pending when the device code is not yet completed", async () => {
    const start = await SELF.fetch("https://test.local/auth/github/start", { method: "POST" });
    const { device_code } = await start.json() as { device_code: string };

    const poll = await SELF.fetch("https://test.local/auth/github/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code }),
    });
    expect(poll.status).toBe(202);
    expect(await poll.json()).toEqual({ status: "pending" });
  });

  it("returns complete + token after callback sets session_token_hash", async () => {
    const start = await SELF.fetch("https://test.local/auth/github/start", { method: "POST" });
    const { device_code, user_code } = await start.json() as { device_code: string; user_code: string };

    // Simulate the callback storing a raw token into session_token_hash (bypasses GitHub exchange)
    await env.DB
      .prepare("UPDATE device_codes SET session_token_hash = ? WHERE user_code = ?")
      .bind("fake-raw-token", user_code)
      .run();

    const poll = await SELF.fetch("https://test.local/auth/github/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code }),
    });
    expect(poll.status).toBe(200);
    const body = await poll.json() as { status: string; token: string };
    expect(body).toEqual({ status: "complete", token: "fake-raw-token" });

    // device_codes row should be deleted
    const row = await env.DB.prepare("SELECT 1 FROM device_codes WHERE device_code = ?")
      .bind(device_code).first();
    expect(row).toBeNull();
  });
});

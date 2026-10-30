// Card #55: a sign-in is bound to the app/computer that started it, plus the start cap,
// sign-out-everywhere and the absolute session lifetime.
import { env, SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { app } from "../src/index";
import { authorizeDeviceCode, ipBucket, isValidLoopbackPort, loopbackSecretOk } from "../src/auth/device-flow";
import { pruneExpired } from "../src/maintenance";
import { SESSION_MAX_AGE_SEC } from "../src/auth/sessions";
import { sha256Hex } from "../src/lib/crypto";
import { createTestAccount, issueTestSession } from "./helpers";

const startReq = (body?: unknown, headers: Record<string, string> = {}) =>
  SELF.fetch("https://test.local/auth/github/start", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const poll = (device_code: string, loopback_secret?: string) =>
  SELF.fetch("https://test.local/auth/github/poll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_code, ...(loopback_secret ? { loopback_secret } : {}) }),
  });

describe("sign-in start: loopback port", () => {
  it("still works with no body at all (older apps)", async () => {
    const res = await startReq();
    expect(res.status).toBe(200);
  });

  it("stores a valid loopback port", async () => {
    const res = await startReq({ loopback_port: 53123 });
    expect(res.status).toBe(200);
    const { device_code } = (await res.json()) as { device_code: string };
    const row = await env.DB.prepare("SELECT loopback_port FROM device_codes WHERE device_code = ?").bind(device_code).first<{ loopback_port: number }>();
    expect(row!.loopback_port).toBe(53123);
  });

  it.each([80, 70000, "8080", 1.5, -1, true])("rejects a bad port %s", async (port) => {
    expect((await startReq({ loopback_port: port })).status).toBe(400);
  });

  it("isValidLoopbackPort only allows ordinary high ports", () => {
    expect(isValidLoopbackPort(1024)).toBe(true);
    expect(isValidLoopbackPort(1023)).toBe(false);
    expect(isValidLoopbackPort(65535)).toBe(true);
    expect(isValidLoopbackPort(65536)).toBe(false);
  });

  it("refuses link-only sign-ins when the switch is on (426), but accepts bound ones", async () => {
    const strict = { ...env, REQUIRE_LOOPBACK_SIGNIN: "1" };
    const legacy = await app.request("/auth/github/start", { method: "POST" }, strict);
    expect(legacy.status).toBe(426);
    const bound = await app.request("/auth/github/start", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ loopback_port: 40000 }),
    }, strict);
    expect(bound.status).toBe(200);
  });
});

describe("sign-in poll: a bound sign-in needs the secret only the real app receives", () => {
  it("attacker holding only the device_code cannot collect the session", async () => {
    const acct = await createTestAccount({ login: "victim" });
    const start = await startReq({ loopback_port: 41000 });
    const { device_code, user_code } = (await start.json()) as { device_code: string; user_code: string };
    // The victim approves in their browser: the server authorises the row and the secret goes
    // to the victim's own computer (returned here as `loopback`), never to the poller.
    const state = (await env.DB.prepare("SELECT csrf_state FROM device_codes WHERE user_code = ?").bind(user_code).first<{ csrf_state: string }>())!.csrf_state;
    const loopback = await authorizeDeviceCode(env.DB, state, acct.userId);
    expect(loopback).not.toBeNull();
    expect(loopback!.port).toBe(41000);
    expect(loopback!.secret).toMatch(/^[0-9a-f]{64}$/);

    // Attacker polls with no secret / a wrong secret: looks like "still waiting", row survives.
    expect(await (await poll(device_code)).json()).toEqual({ status: "pending" });
    expect(await (await poll(device_code, "0".repeat(64))).json()).toEqual({ status: "pending" });
    const still = await env.DB.prepare("SELECT 1 AS x FROM device_codes WHERE device_code = ?").bind(device_code).first();
    expect(still).not.toBeNull();

    // The real app presents the secret it got from the browser redirect: signed in.
    const ok = await poll(device_code, loopback!.secret);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { status: string; token: string };
    expect(body.status).toBe("complete");
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    // And it can only be collected once.
    expect((await poll(device_code, loopback!.secret)).status).toBe(404);
  });

  it("older sign-ins (no port) finish exactly as before", async () => {
    const acct = await createTestAccount({ login: "olduser" });
    const start = await startReq();
    const { device_code, user_code } = (await start.json()) as { device_code: string; user_code: string };
    const state = (await env.DB.prepare("SELECT csrf_state FROM device_codes WHERE user_code = ?").bind(user_code).first<{ csrf_state: string }>())!.csrf_state;
    expect(await authorizeDeviceCode(env.DB, state, acct.userId)).toBeNull();
    expect((await poll(device_code)).status).toBe(200);
  });

  it("loopbackSecretOk: no stored hash needs nothing; stored hash needs the exact secret", async () => {
    expect(await loopbackSecretOk(null, undefined)).toBe(true);
    const secret = "ab".repeat(32);
    const hash = await sha256Hex(secret);
    expect(await loopbackSecretOk(hash, secret)).toBe(true);
    expect(await loopbackSecretOk(hash, "cd".repeat(32))).toBe(false);
    expect(await loopbackSecretOk(hash, undefined)).toBe(false);
    expect(await loopbackSecretOk(hash, 123)).toBe(false);
  });
});

describe("sign-in start: per-network cap", () => {
  it("stops one network after 10 starts per window, not another network", async () => {
    for (let i = 0; i < 10; i++) expect((await startReq(undefined, { "CF-Connecting-IP": "203.0.113.7" })).status).toBe(200);
    expect((await startReq(undefined, { "CF-Connecting-IP": "203.0.113.7" })).status).toBe(429);
    expect((await startReq(undefined, { "CF-Connecting-IP": "203.0.113.8" })).status).toBe(200);
  });

  it("stores a keyed fingerprint, never the address", async () => {
    await startReq(undefined, { "CF-Connecting-IP": "198.51.100.9" });
    const row = await env.DB.prepare("SELECT ip_bucket FROM device_codes WHERE ip_bucket IS NOT NULL").first<{ ip_bucket: string }>();
    expect(row!.ip_bucket).toMatch(/^[0-9a-f]{24}$/);
    expect(row!.ip_bucket).not.toContain("198");
  });

  it("groups IPv6 callers by /64 and changes day to day", async () => {
    const now = 1_800_000_000;
    expect(await ipBucket("s", "2001:db8:1:2:aaaa::1", now)).toBe(await ipBucket("s", "2001:db8:1:2:bbbb::9", now));
    expect(await ipBucket("s", "203.0.113.7", now)).not.toBe(await ipBucket("s", "203.0.113.7", now + 86400));
  });
});

describe("sessions: sign out everywhere and absolute lifetime", () => {
  it("POST /auth/logout-all kills every session of the account and nobody else's", async () => {
    const a = await createTestAccount();
    const b = await createTestAccount();
    const a1 = await issueTestSession(a);
    const a2 = await issueTestSession(a);
    const b1 = await issueTestSession(b);
    const res = await SELF.fetch("https://test.local/auth/logout-all", { method: "POST", headers: { Authorization: `Bearer ${a1}` } });
    expect(res.status).toBe(204);
    for (const t of [a1, a2]) {
      expect((await SELF.fetch("https://test.local/auth/me", { headers: { Authorization: `Bearer ${t}` } })).status).toBe(401);
    }
    expect((await SELF.fetch("https://test.local/auth/me", { headers: { Authorization: `Bearer ${b1}` } })).status).toBe(200);
  });

  it("requires a signed-in caller", async () => {
    expect((await SELF.fetch("https://test.local/auth/logout-all", { method: "POST" })).status).toBe(401);
  });

  it("a session older than the absolute lifetime stops working even if used yesterday", async () => {
    const acct = await createTestAccount();
    const token = await issueTestSession(acct);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare("UPDATE sessions SET created_at = ?, last_used_at = ? WHERE user_id = ?")
      .bind(now - SESSION_MAX_AGE_SEC - 10, now - 86400, acct.userId).run();
    expect((await SELF.fetch("https://test.local/auth/me", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it("the daily cleanup removes over-age sessions too", async () => {
    const acct = await createTestAccount();
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, last_used_at) VALUES ('oldbutactive', ?, ?, ?)")
      .bind(acct.userId, now - SESSION_MAX_AGE_SEC - 10, now - 3600).run();
    await pruneExpired(env.DB, now);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = 'oldbutactive'").first<{ n: number }>();
    expect(n!.n).toBe(0);
  });
});

describe("generic 500s", () => {
  it("does not echo internal error text on ordinary routes", async () => {
    // Break the database binding for one request so a route throws a non-HTTP error.
    const broken = { ...env, DB: { prepare: () => { throw new Error("no such table: secret_internal_table"); } } };
    const res = await app.request("/auth/github/start", { method: "POST" }, broken as any);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret_internal_table");
  });
});

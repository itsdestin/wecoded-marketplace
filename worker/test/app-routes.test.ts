import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import app from "../src/index";

const VALID_PAYLOAD = {
  installId: "c4b2a8f0-0000-4000-8000-000000000000",
  appVersion: "1.2.1",
  platform: "desktop",
  os: "mac",
};

describe("POST /app/install", () => {
  it("accepts a valid payload", async () => {
    const res = await app.request("/app/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_PAYLOAD),
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);
  });

  it("rejects non-UUID installId", async () => {
    const res = await app.request("/app/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...VALID_PAYLOAD, installId: "not-a-uuid" }),
    }, env);
    expect(res.status).toBe(400);
  });

  it("rejects unknown platform", async () => {
    const res = await app.request("/app/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...VALID_PAYLOAD, platform: "windows-phone" }),
    }, env);
    expect(res.status).toBe(400);
  });

  it("rejects missing fields", async () => {
    const res = await app.request("/app/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installId: VALID_PAYLOAD.installId }),
    }, env);
    expect(res.status).toBe(400);
  });
});

describe("POST /app/heartbeat", () => {
  it("accepts a valid Android payload (empty os)", async () => {
    const res = await app.request("/app/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        installId: "c4b2a8f0-0000-4000-8000-000000000001",
        appVersion: "1.2.1",
        platform: "android",
        os: "",
      }),
    }, env);
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean }>();
    expect(body.ok).toBe(true);
  });

  it("rejects malformed JSON body (parse fails → missing fields)", async () => {
    const res = await app.request("/app/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    }, env);
    expect(res.status).toBe(400);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { env } from "cloudflare:test";
import { app } from "../src/index";

const LEGACY_PAYLOAD = {
  installId: "c4b2a8f0-0000-4000-8000-000000000000",
  appVersion: "1.2.1",
  platform: "desktop",
  os: "mac",
};
const NEW_PAYLOAD = {
  deviceIdHash: "0123456789abcdef".repeat(4), // realistic: the forged-hash filter rejects repeated characters
  appVersion: "1.3.0",
  platform: "desktop",
  os: "mac",
};

describe("POST /app/heartbeat — new device-hash payload", () => {
  let writes: any[];
  let writeDataPoint: any;

  beforeEach(() => {
    writes = [];
    writeDataPoint = vi.fn((dp: any) => writes.push(dp));
    (env as any).APP_ANALYTICS = { writeDataPoint };
  });

  afterEach(() => {
    delete (env as any).APP_ANALYTICS;
  });

  it("accepts deviceIdHash and writes to AE", async () => {
    const res = await app.request("/app/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-IPCountry": "US", "CF-IPRegionCode": "CA" },
      body: JSON.stringify(NEW_PAYLOAD),
    }, env);
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(writes[0].blobs[1]).toBe("0123456789abcdef".repeat(4));
    expect(writes[0].blobs[5]).toBe("US");
    expect(writes[0].blobs[6]).toBe("CA");
  });

  it("accepts legacy installId payload but does NOT write to AE (soak drop)", async () => {
    const res = await app.request("/app/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(LEGACY_PAYLOAD),
    }, env);
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(0);
  });

  it("rejects malformed deviceIdHash (wrong length)", async () => {
    const res = await app.request("/app/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...NEW_PAYLOAD, deviceIdHash: "abc" }),
    }, env);
    expect(res.status).toBe(400);
  });

  it("rejects payload with neither installId nor deviceIdHash", async () => {
    const res = await app.request("/app/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appVersion: "1.0", platform: "desktop", os: "mac" }),
    }, env);
    expect(res.status).toBe(400);
  });

  it("rejects payload where deviceIdHash is valid but installId is malformed (strict)", async () => {
    const res = await app.request("/app/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...NEW_PAYLOAD, installId: "not-a-uuid" }),
    }, env);
    expect(res.status).toBe(400);
  });
});

describe("POST /app/install — deprecated, returns 410", () => {
  it("returns 410 Gone with no AE write", async () => {
    const writes: any[] = [];
    (env as any).APP_ANALYTICS = { writeDataPoint: (dp: any) => writes.push(dp) };
    const res = await app.request("/app/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(LEGACY_PAYLOAD),
    }, env);
    expect(res.status).toBe(410);
    expect(writes).toHaveLength(0);
    delete (env as any).APP_ANALYTICS;
  });
});

describe("POST /app/heartbeat, /app/milestone and /app/opt-out — one-time messages and team devices", () => {
  let writes: any[];
  beforeEach(() => {
    writes = [];
    (env as any).APP_ANALYTICS = { writeDataPoint: (dp: any) => writes.push(dp) };
  });
  afterEach(() => { delete (env as any).APP_ANALYTICS; });

  const post = (path: string, body: unknown) => app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, env);

  it("a team device's check-in is stored with the team mark", async () => {
    expect((await post("/app/heartbeat", { ...NEW_PAYLOAD, team: true })).status).toBe(200);
    expect(writes[0].blobs[7]).toBe("team");
    expect((await post("/app/heartbeat", NEW_PAYLOAD)).status).toBe(200);
    expect(writes[1].blobs[7]).toBe("");
  });

  it("rejects a team field that is not true or false", async () => {
    expect((await post("/app/heartbeat", { ...NEW_PAYLOAD, team: "yes" })).status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it("stores a known milestone name and refuses free text", async () => {
    expect((await post("/app/milestone", { ...NEW_PAYLOAD, milestone: "setup_failed_node" })).status).toBe(200);
    expect(writes[0].blobs[0]).toBe("milestone");
    expect(writes[0].blobs[8]).toBe("setup_failed_node");
    for (const bad of ["", "hello world", "setup_failed_/home/me", "first_open; DROP"]) {
      expect((await post("/app/milestone", { ...NEW_PAYLOAD, milestone: bad })).status).toBe(400);
    }
    expect((await post("/app/milestone", { ...LEGACY_PAYLOAD, milestone: "first_open" })).status).toBe(400);
    expect(writes).toHaveLength(1);
  });

  it("an opt-out notice is stored without any device hash, and one carrying a hash is refused", async () => {
    expect((await post("/app/opt-out", { appVersion: "1.4.0", platform: "desktop", os: "win" })).status).toBe(200);
    expect(writes[0].blobs[0]).toBe("opt_out");
    expect(writes[0].blobs[1]).toBe("");
    expect((await post("/app/opt-out", { ...NEW_PAYLOAD })).status).toBe(400);
    expect(writes).toHaveLength(1);
  });
});

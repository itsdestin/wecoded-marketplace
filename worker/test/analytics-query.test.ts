import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runAnalyticsQuery } from "../src/lib/analytics-query";

describe("runAnalyticsQuery", () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          meta: [{ name: "day", type: "Date" }, { name: "dau", type: "UInt64" }],
          data: [{ day: "2026-04-22", dau: 42 }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    ) as any;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("POSTs the SQL to the CF SQL API with bearer auth", async () => {
    const env = { CF_ACCOUNT_ID: "acc123", CF_ANALYTICS_TOKEN: "tok456" } as any;
    const rows = await runAnalyticsQuery(env, "SELECT 1");
    expect(rows).toEqual([{ day: "2026-04-22", dau: 42 }]);
    const call = (globalThis.fetch as any).mock.calls[0];
    expect(call[0]).toBe("https://api.cloudflare.com/client/v4/accounts/acc123/analytics_engine/sql");
    expect(call[1].method).toBe("POST");
    expect(call[1].headers.Authorization).toBe("Bearer tok456");
    expect(call[1].body).toBe("SELECT 1");
  });

  it("throws on non-200 from CF", async () => {
    globalThis.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as any;
    const env = { CF_ACCOUNT_ID: "acc123", CF_ANALYTICS_TOKEN: "tok456" } as any;
    await expect(runAnalyticsQuery(env, "SELECT 1")).rejects.toThrow(/analytics query failed/i);
  });
});

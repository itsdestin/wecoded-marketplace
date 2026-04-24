import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolvePat, __resetPatCacheForTests } from "../src/auth/pat";

const origFetch = globalThis.fetch;

describe("resolvePat", () => {
  beforeEach(() => {
    __resetPatCacheForTests();
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("returns github:<id> when GitHub /user returns 200", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ id: 12345, login: "destin" }), { status: 200 })
    ) as any;
    const userId = await resolvePat("ghp_test");
    expect(userId).toBe("github:12345");
  });

  it("returns null on 401 from GitHub", async () => {
    globalThis.fetch = vi.fn(async () => new Response("bad credentials", { status: 401 })) as any;
    const userId = await resolvePat("ghp_bad");
    expect(userId).toBeNull();
  });

  it("caches a successful lookup (second call does not re-fetch)", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 999, login: "x" }), { status: 200 })
    );
    globalThis.fetch = fetchMock as any;
    await resolvePat("ghp_cache");
    await resolvePat("ghp_cache");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache a failed lookup", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 401 }));
    globalThis.fetch = fetchMock as any;
    await resolvePat("ghp_fail");
    await resolvePat("ghp_fail");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null for an empty token without calling fetch", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as any;
    const userId = await resolvePat("");
    expect(userId).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

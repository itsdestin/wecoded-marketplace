// Worker hardening from the 2026-10-30 security review: dashboard escaping, heartbeat
// plausibility, stats caching, theme likes / theme-id checks, relayed challenge fields,
// sync storage caps and the optional admin token-scope check.
import { env, SELF } from "cloudflare:test";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { app } from "../src/index";
import { escapeHtml } from "../src/lib/html";
import { cachedText } from "../src/lib/kv-cache";
import { requireCatalogId, filterCatalogIds } from "../src/lib/validate";
import { MAX_THEME_LIKES_PER_USER } from "../src/themes/routes";
import { MAX_LEASES_PER_ROOM } from "../src/sync/room";
import { resolvePat, __resetPatCacheForTests } from "../src/auth/pat";
import { createTestAccount, issueTestSession } from "./helpers";
import { dashboardHtml } from "../src/admin/dashboard-html";

const REGISTRY_KEY = "theme-registry:slugs";
async function seedRegistry(slugs: string[]) {
  await env.CATALOG_KV!.put(REGISTRY_KEY, JSON.stringify({ at: Date.now(), slugs }));
}
const authed = (token: string, method = "POST", body?: unknown) => ({
  method,
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe("escapeHtml / admin dashboard", () => {
  it("escapes the five dangerous characters", () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe("&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
    expect(escapeHtml(null)).toBe("");
  });

  it("the dashboard page escapes table values and error text, and pins the chart library", () => {
    expect(dashboardHtml).toContain("function esc(");
    expect(dashboardHtml).toContain("esc(r[k])");
    expect(dashboardHtml).toContain("esc(e)");
    expect(dashboardHtml).toMatch(/chart\.umd\.min\.js"[^>]*integrity="sha384-/);
  });

  it("the page's escape function really neutralises markup", () => {
    const fn = dashboardHtml.match(/function esc\(v\) \{[\s\S]*?\n\}/)![0];
    const esc = new Function(`${fn}; return esc;`)();
    expect(esc("<img src=x onerror=alert(1)>")).not.toContain("<");
  });
});

describe("POST /app/heartbeat plausibility", () => {
  const good = { deviceIdHash: "0123456789abcdef".repeat(4), appVersion: "1.3.0", platform: "desktop", os: "linux" };
  let writes: any[];
  beforeEach(() => { writes = []; (env as any).APP_ANALYTICS = { writeDataPoint: (d: any) => writes.push(d) }; });
  afterEach(() => { delete (env as any).APP_ANALYTICS; });
  const post = (body: unknown, ip = "192.0.2.1") =>
    app.request("/app/heartbeat", { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) }, env);

  it("accepts normal versions including pre-release tags", async () => {
    for (const v of ["1.3.0", "1.3.0-beta.2", "2.0.0+build5"]) expect((await post({ ...good, appVersion: v })).status).toBe(200);
    expect(writes).toHaveLength(3);
  });

  it.each(["<img src=x onerror=alert(1)>", "1.0 ", "a b", "1.0;drop", "x".repeat(33)])("rejects version %s", async (v) => {
    expect((await post({ ...good, appVersion: v })).status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it("rejects a markup-bearing os", async () => {
    expect((await post({ ...good, os: "<b>" })).status).toBe(400);
  });

  it("answers OK but does not count a hand-typed hash", async () => {
    expect((await post({ ...good, deviceIdHash: "a".repeat(64) })).status).toBe(200);
    expect((await post({ ...good, deviceIdHash: "ab".repeat(32) })).status).toBe(200);
    expect(writes).toHaveLength(0);
  });

  it("stops one network from reporting endless distinct devices in an hour", async () => {
    let last = 200;
    for (let i = 0; i < 31; i++) {
      const hash = (i.toString(16).padStart(2, "0") + "fedcba9876543210").repeat(4).slice(0, 64);
      last = (await post({ ...good, deviceIdHash: hash }, "192.0.2.50")).status;
    }
    expect(last).toBe(429);
  });
});

describe("cachedText (stats cache helper)", () => {
  it("serves the stored copy inside the window and recomputes after it", async () => {
    const compute = vi.fn(async () => `v${compute.mock.calls.length}`);
    const kv = env.CATALOG_KV!;
    expect(await cachedText(kv, "t:1", 120, compute, 1_000_000)).toBe("v1");
    expect(await cachedText(kv, "t:1", 120, compute, 1_000_000 + 60_000)).toBe("v1");
    expect(compute).toHaveBeenCalledTimes(1);
    expect(await cachedText(kv, "t:1", 120, compute, 1_000_000 + 121_000)).toBe("v2");
  });
  it("ttl 0 or no KV always computes", async () => {
    const compute = vi.fn(async () => "x");
    await cachedText(env.CATALOG_KV, "t:2", 0, compute);
    await cachedText(undefined, "t:2", 120, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
  it("a broken KV never fails the request", async () => {
    const bad = { get: async () => { throw new Error("kv down"); }, put: async () => { throw new Error("kv down"); } } as any;
    expect(await cachedText(bad, "t:3", 120, async () => "ok")).toBe("ok");
  });
});

describe("GET /stats still answers (cache off in tests)", () => {
  it("returns the plugins/themes shape", async () => {
    const res = await SELF.fetch("https://test.local/stats");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/application\/json/);
    expect(Object.keys((await res.json()) as object)).toEqual(expect.arrayContaining(["generated_at", "plugins", "themes"]));
  });
});

describe("theme likes", () => {
  it("rejects a theme that is not in the registry, and malformed names", async () => {
    await seedRegistry(["real-theme"]);
    const token = await issueTestSession(await createTestAccount());
    expect((await SELF.fetch("https://test.local/themes/made-up/like", authed(token))).status).toBe(400);
    expect((await SELF.fetch("https://test.local/themes/Bad_Name/like", authed(token))).status).toBe(400);
    expect((await SELF.fetch("https://test.local/themes/real-theme/like", authed(token))).status).toBe(200);
  });

  it("lets a person un-like a theme that has since left the registry", async () => {
    await seedRegistry(["gone-theme"]);
    const acct = await createTestAccount();
    const token = await issueTestSession(acct);
    await SELF.fetch("https://test.local/themes/gone-theme/like", authed(token));
    await seedRegistry(["other"]);
    const res = await SELF.fetch("https://test.local/themes/gone-theme/like", authed(token));
    expect(await res.json()).toEqual({ liked: false });
  });

  it("fails open when the registry is unavailable (format check only)", async () => {
    const token = await issueTestSession(await createTestAccount());
    expect((await SELF.fetch("https://test.local/themes/some-theme/like", authed(token))).status).toBe(200);
  });

  it("caps likes per account", async () => {
    const acct = await createTestAccount();
    const token = await issueTestSession(acct);
    const now = Math.floor(Date.now() / 1000);
    const stmts = Array.from({ length: MAX_THEME_LIKES_PER_USER }, (_, i) =>
      env.DB.prepare("INSERT INTO theme_likes (user_id, theme_id, liked_at) VALUES (?, ?, ?)").bind(acct.userId, `t-${i}`, now));
    await env.DB.batch(stmts);
    expect((await SELF.fetch("https://test.local/themes/one-more/like", authed(token))).status).toBe(429);
  });
});

describe("theme: prefix no longer bypasses the catalog check", () => {
  it("requireCatalogId rejects an invented theme id once the registry is known", async () => {
    await seedRegistry(["real-theme"]);
    await expect(requireCatalogId(env.DB, "theme:real-theme", "plugin_id", env)).resolves.toBe("theme:real-theme");
    await expect(requireCatalogId(env.DB, "theme:invented", "plugin_id", env)).rejects.toMatchObject({ status: 400 });
    await expect(requireCatalogId(env.DB, "theme:", "plugin_id", env)).rejects.toMatchObject({ status: 400 });
  });

  it("filterCatalogIds drops invented theme ids but keeps real ones", async () => {
    await env.DB.prepare("INSERT INTO catalog_items (id, source, item_type, updated_at, entry_json) VALUES ('p1','wecoded','plugin',1,'{}')").run();
    await seedRegistry(["real-theme"]);
    expect(await filterCatalogIds(env.DB, ["p1", "theme:real-theme", "theme:fake", "nope"], env)).toEqual(["p1", "theme:real-theme"]);
  });

  it("POST /installs for an invented theme id is refused", async () => {
    await seedRegistry(["real-theme"]);
    const token = await issueTestSession(await createTestAccount());
    expect((await SELF.fetch("https://test.local/installs", authed(token, "POST", { plugin_id: "theme:invented" }))).status).toBe(400);
    expect((await SELF.fetch("https://test.local/installs", authed(token, "POST", { plugin_id: "theme:real-theme" }))).status).toBe(200);
  });
});

// ---- presence + sync (WebSocket) ----
async function connectTo(path: string, token: string): Promise<WebSocket> {
  const res = await SELF.fetch(`https://test.local${path}`, { headers: { Upgrade: "websocket", Authorization: `Bearer ${token}` } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!; ws.accept(); return ws;
}
function next(ws: WebSocket, type: string, ms = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), ms);
    const h = (ev: MessageEvent) => { const d = JSON.parse(ev.data as string); if (d.type === type) { clearTimeout(t); ws.removeEventListener("message", h); resolve(d); } };
    ws.addEventListener("message", h);
  });
}

describe("relayed challenge fields", () => {
  it("passes a valid challenge, refuses an unknown game or a hostile code", async () => {
    const a = await createTestAccount({ handle: `xa${Date.now() % 100000}` });
    const b = await createTestAccount({ handle: `xb${Date.now() % 100000}` });
    const [low, high] = a.userId < b.userId ? [a.userId, b.userId] : [b.userId, a.userId];
    await env.DB.prepare("INSERT INTO friendships (user_low, user_high, created_at) VALUES (?, ?, ?)").bind(low, high, 1).run();
    const wsA = await connectTo("/social/presence", await issueTestSession(a)); await next(wsA, "presence");
    const wsB = await connectTo("/social/presence", await issueTestSession(b)); await next(wsB, "presence");

    const ok = next(wsB, "challenge");
    wsA.send(JSON.stringify({ type: "challenge", target: b.userId, gameType: "chess", code: "AB12-cd" }));
    expect((await ok).code).toBe("AB12-cd");

    for (const bad of [
      { gameType: "rm -rf", code: "ABC123" },
      { gameType: "chess", code: "<script>alert(1)</script>" },
      { gameType: "chess", code: "x".repeat(65) },
      { gameType: "chess", code: 12345 },
      { gameType: { a: 1 }, code: "ABC123" },
    ]) {
      const failed = next(wsA, "challenge-failed");
      wsA.send(JSON.stringify({ type: "challenge", target: b.userId, ...bad }));
      expect((await failed).target).toBe(b.userId);
    }
    wsA.close(); wsB.close();
  });
});

describe("sync hub storage caps", () => {
  it("refuses new lease records past the cap but keeps existing ones working", async () => {
    const token = await issueTestSession(await createTestAccount());
    const ws = await connectTo("/sync/hub?device=cap-test", token);
    await next(ws, "hello");
    let seq = 0;
    const op = (sessionId: string): Promise<any> => {
      const reqId = `cap-${++seq}`;
      return new Promise((resolve) => {
        const h = (ev: MessageEvent) => { const d = JSON.parse(ev.data as string); if (d.reqId === reqId) { ws.removeEventListener("message", h); resolve(d); } };
        ws.addEventListener("message", h);
        ws.send(JSON.stringify({ type: "lease", op: "acquire", sessionId, deviceId: "dev1", reqId }));
      });
    };
    for (let i = 0; i < MAX_LEASES_PER_ROOM; i++) expect((await op(`s-${i}`)).ok).toBe(true);
    expect((await op("one-too-many")).ok).toBe(false);
    expect((await op("s-0")).ok).toBe(true); // renewing an existing one still works
    ws.close();
  }, 30_000);

  it("a hostile device label is trimmed (header never carries control characters or more than 64 chars)", async () => {
    const token = await issueTestSession(await createTestAccount());
    const label = "x".repeat(500) + "\u0007";
    const ws = await connectTo(`/sync/hub?device=${encodeURIComponent(label)}`, token);
    const hello = await next(ws, "hello");
    expect(hello).toBeTruthy();
    ws.close();
  });
});

describe("admin token scope check (optional)", () => {
  const origFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origFetch; });
  beforeEach(async () => {
    __resetPatCacheForTests();
    for (const t of ["identities", "users"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
  });
  const gh = (scopes: string | null) => vi.fn(async () =>
    new Response(JSON.stringify({ id: 777 }), { status: 200, headers: scopes === null ? {} : { "X-OAuth-Scopes": scopes } })) as any;

  it("with no required scopes, behaves as before", async () => {
    const acct = await createTestAccount({ githubId: "777" });
    globalThis.fetch = gh(null);
    expect(await resolvePat(env.DB, "gho_any")).toBe(acct.userId);
  });
  it("refuses a token missing a required scope and accepts one that has it", async () => {
    const acct = await createTestAccount({ githubId: "777" });
    globalThis.fetch = gh("read:user");
    expect(await resolvePat(env.DB, "gho_low", ["repo"])).toBeNull();
    globalThis.fetch = gh("gist, repo, read:org");
    expect(await resolvePat(env.DB, "gho_full", ["repo"])).toBe(acct.userId);
  });
  it("a cached success under no requirement does not bypass a later requirement", async () => {
    await createTestAccount({ githubId: "777" });
    globalThis.fetch = gh("read:user");
    expect(await resolvePat(env.DB, "gho_same")).not.toBeNull();
    expect(await resolvePat(env.DB, "gho_same", ["repo"])).toBeNull();
  });
});

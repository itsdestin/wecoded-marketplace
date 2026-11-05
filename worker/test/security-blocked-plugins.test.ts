import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import { BLOCKED_PLUGINS } from "../src/security/blocked-plugins";

// WHY: the app turns off every plugin this answer names, on every computer. A malformed entry
// (blank id, stray spaces, a duplicate) would either miss the plugin it meant or, worse, match
// nothing while everyone believes the bad plugin is off.
describe("plugin off-switch list", () => {
  it("is served without sign-in, as JSON the app can read", async () => {
    const res = await SELF.fetch("https://test.local/security/blocked-plugins");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    const body = await res.json() as { blocked: unknown };
    expect(body.blocked).toEqual(BLOCKED_PLUGINS);
  });

  it("holds only well-formed, distinct catalog ids", () => {
    const ids = BLOCKED_PLUGINS.map((b) => b.id);
    for (const id of ids) {
      expect(id).toBe(id.trim());
      expect(id.length).toBeGreaterThan(0);
      expect(id.length).toBeLessThanOrEqual(128);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});

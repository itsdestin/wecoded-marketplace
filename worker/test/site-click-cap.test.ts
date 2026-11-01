import { describe, it, expect } from "vitest";
import { capClicks, MAX_CLICKS_PER_VISIT } from "../src/site-analytics/routes";

const none = { Windows: 0, macOS: 0, Linux: 0, Android: 0 };

describe("capClicks", () => {
  it("lets a visit's clicks grow until the per-visit cap, then stops", () => {
    expect(capClicks(none, { ...none, Windows: 3 })).toEqual({ ...none, Windows: 3 });
    expect(capClicks({ ...none, Windows: 3 }, { ...none, Windows: 3, macOS: 9 })).toEqual({ ...none, Windows: 3, macOS: 2 });
    expect(capClicks(none, { Windows: 100, macOS: 0, Linux: 0, Android: 0 }).Windows).toBe(MAX_CLICKS_PER_VISIT);
  });

  it("never lowers what a visit already holds", () => {
    expect(capClicks({ ...none, Linux: 2 }, none)).toEqual({ ...none, Linux: 2 });
  });
});

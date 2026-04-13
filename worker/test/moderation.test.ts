import { describe, it, expect } from "vitest";
import { validateReviewText, MAX_REVIEW_LEN } from "../src/ratings/moderation";

describe("validateReviewText", () => {
  it("returns null for null/empty/whitespace", () => {
    expect(validateReviewText(null)).toBeNull();
    expect(validateReviewText("")).toBeNull();
    expect(validateReviewText("   ")).toBeNull();
  });
  it("trims valid text", () => {
    expect(validateReviewText("  great plugin  ")).toBe("great plugin");
  });
  it("throws on over-length text", () => {
    expect(() => validateReviewText("a".repeat(MAX_REVIEW_LEN + 1))).toThrow(/too long/);
  });
  it("rejects URLs", () => {
    expect(() => validateReviewText("check http://spam.example")).toThrow(/URLs/);
  });
  it("rejects repeated-char spam", () => {
    expect(() => validateReviewText("aaaaaaaaaaa")).toThrow(/spam/);
  });
});

import type { Env } from "../types";

export const MAX_REVIEW_LEN = 500;

// Validate review text before persisting: trims, rejects overlong strings,
// URL spam, and obvious repeated-character spam. Returns null when the input
// is effectively empty so callers can store NULL.
export function validateReviewText(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_REVIEW_LEN) {
    throw new Error(`review too long (${trimmed.length} > ${MAX_REVIEW_LEN})`);
  }
  // Reject obvious URL spam.
  if (/https?:\/\//i.test(trimmed)) {
    throw new Error("URLs are not allowed in reviews");
  }
  // Reject repeated-char spam like "aaaaaaa..."
  if (/(.)\1{9,}/.test(trimmed)) {
    throw new Error("review appears to be spam");
  }
  return trimmed;
}

// Runs review text through Workers AI llama-guard-3-8b. Returns `safe: false`
// when the guard model flags the content; callers then persist with hidden=1.
// Fail-open when the AI binding is unavailable (e.g. test environment where
// `[env.test]` wrangler section intentionally omits the wrapped AI worker)
// so ratings can still be submitted — production always has the binding.
export async function classifyReview(ai: Ai | undefined, text: string): Promise<{ safe: boolean; reason?: string }> {
  if (!ai || typeof (ai as any).run !== "function") return { safe: true };
  const res = (await ai.run("@cf/meta/llama-guard-3-8b" as any, {
    messages: [{ role: "user", content: text }],
  })) as { response?: string };
  const verdict = (res.response ?? "").toLowerCase();
  if (verdict.includes("unsafe")) return { safe: false, reason: verdict.split("\n")[1] ?? "unsafe" };
  return { safe: true };
}

// Minimal HTML escaping for every place the worker builds a page from a value it did
// not write itself (GitHub logins, user codes, anything echoed back).
// WHY: one shared helper so no page has to remember to hand-roll it.
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;"
  );
}

// Thin wrapper around fetch. Accepts an optional injected fetch for tests.
// WHY: every fetcher takes `{ fetch }` so tests pass a mock without network.

// WHY (code scanning, 2026-11): some URLs carry the user's api.data.gov key as ?api_key=…, and
// error messages are printed to the chat (and can land in bug reports). Never echo the key.
export function redactUrl(url) {
  return String(url).replace(/([?&](?:api_key|apikey|key|token)=)[^&#]*/gi, "$1[hidden]");
}

export async function getJson(url, { fetch: f = fetch, headers = {} } = {}) {
  const res = await f(url, { headers: { "User-Agent": "civic-report/0.1", ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${redactUrl(url)}`);
  return res.json();
}

export async function getText(url, { fetch: f = fetch, headers = {} } = {}) {
  const res = await f(url, { headers: { "User-Agent": "civic-report/0.1", ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${redactUrl(url)}`);
  return res.text();
}

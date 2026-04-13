// Thin wrapper around fetch. Accepts an optional injected fetch for tests.
// WHY: every fetcher takes `{ fetch }` so tests pass a mock without network.

export async function getJson(url, { fetch: f = fetch, headers = {} } = {}) {
  const res = await f(url, { headers: { "User-Agent": "civic-report/0.1", ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export async function getText(url, { fetch: f = fetch, headers = {} } = {}) {
  const res = await f(url, { headers: { "User-Agent": "civic-report/0.1", ...headers } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

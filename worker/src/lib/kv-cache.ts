// A tiny time-limited cache on top of Workers KV.
//
// WHY KV and not the Cache API: the Cache API does nothing on the *.workers.dev
// address that shipped apps still call (see wrangler.toml), while KV works on every
// hostname. Used for answers that are expensive to compute and fine to serve a few
// minutes old (GET /stats scans four whole tables).

export async function cachedText(
  kv: KVNamespace | undefined,
  key: string,
  ttlSec: number,
  compute: () => Promise<string>,
  nowMs: number = Date.now()
): Promise<string> {
  if (!kv || ttlSec <= 0) return compute();
  try {
    const hit = await kv.get<{ at: number; body: string }>(key, "json");
    if (hit && typeof hit.body === "string" && nowMs - hit.at < ttlSec * 1000) return hit.body;
  } catch { /* a cache read failure must never fail the request */ }
  const body = await compute();
  try {
    // KV's minimum expiry is 60 s; the stored timestamp, not KV's expiry, decides freshness.
    await kv.put(key, JSON.stringify({ at: nowMs, body }), { expirationTtl: Math.max(60, ttlSec * 2) });
  } catch { /* best effort */ }
  return body;
}

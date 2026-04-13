// Simple fixed-window rate limit using the Cloudflare Cache API.
// Not perfectly fair under load but good enough to stop casual abuse.
export async function checkRateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  const cache = await caches.open("rl");
  const cacheKey = new Request(`https://rl.internal/${encodeURIComponent(key)}`);
  const hit = await cache.match(cacheKey);
  const count = hit ? Number(await hit.text()) : 0;
  if (count >= limit) return false;
  const next = count + 1;
  await cache.put(
    cacheKey,
    new Response(String(next), {
      headers: { "Cache-Control": `max-age=${windowSec}` },
    })
  );
  return true;
}

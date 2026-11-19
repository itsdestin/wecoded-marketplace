const MARKETPLACE_URL = 'https://raw.githubusercontent.com/itsdestin/wecoded-marketplace/master/marketplace.json';
const SCHEMA_URL = 'https://raw.githubusercontent.com/itsdestin/wecoded-marketplace/master/scripts/schema.js';

export async function fetchMarketplace(fetchImpl = fetch) {
  const res = await fetchImpl(MARKETPLACE_URL);
  if (!res.ok) throw new Error(`marketplace.json fetch failed: ${res.status}`);
  return JSON.parse(await res.text());
}

export async function fetchSchemaEnums(fetchImpl = fetch) {
  const res = await fetchImpl(SCHEMA_URL);
  if (!res.ok) throw new Error(`schema.js fetch failed: ${res.status}`);
  const src = await res.text();
  return parseSchemaModule(src);
}

// WHY rewritten: this used to look for CATEGORIES / LIFE_AREAS / AUDIENCES, but the real
// scripts/schema.js defines ALLOWED_TAGS / ALLOWED_LIFE_AREAS / ALLOWED_AUDIENCE (and has no
// category list at all), so every check read an empty list and silently passed.
// The name is anchored on `const <NAME> =` so one name can never match inside another.
function extractArray(src, name) {
  const re = new RegExp(`const\\s+${name}\\s*=\\s*\\[([^\\]]*)\\]`);
  const m = src.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
}

export function parseSchemaModule(src) {
  return {
    tags: extractArray(src, 'ALLOWED_TAGS'),
    lifeAreas: extractArray(src, 'ALLOWED_LIFE_AREAS'),
    audiences: extractArray(src, 'ALLOWED_AUDIENCE'),
  };
}

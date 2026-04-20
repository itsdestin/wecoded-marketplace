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

function extractArray(src, name) {
  const re = new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`);
  const m = src.match(re);
  if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
}

export function parseSchemaModule(src) {
  return {
    categories: extractArray(src, 'CATEGORIES'),
    lifeAreas: extractArray(src, 'LIFE_AREAS'),
    audiences: extractArray(src, 'AUDIENCES'),
  };
}

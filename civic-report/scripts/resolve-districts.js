import { getJson } from "./lib/http.js";
import { pathToFileURL } from "node:url";

// Census Geocoder is keyless and returns both federal and state districts in
// one call. WHY this benchmark/vintage: "Current" always points at the most
// recent decennial cycle, so we don't have to update this code after each census.
const BASE = "https://geocoding.geo.census.gov/geocoder/geographies/address";

export async function resolveDistricts(addr, opts = {}) {
  const qs = new URLSearchParams({
    street: addr.street,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
    benchmark: "Public_AR_Current",
    vintage: "Current_Current",
    layers: "all",
    format: "json",
  });
  const data = await getJson(`${BASE}?${qs}`, opts);
  const match = data?.result?.addressMatches?.[0];
  if (!match) {
    throw new Error("No match — this skill currently only supports US addresses.");
  }
  const geo = match.geographies || {};
  // Census keys the layer by congress number (e.g. "119th Congressional Districts"),
  // so pick the first key that matches the pattern rather than hardcoding.
  const cdKey = Object.keys(geo).find((k) => /Congressional Districts/.test(k));
  const upperKey = Object.keys(geo).find((k) => /State Legislative Districts - Upper/.test(k));
  const lowerKey = Object.keys(geo).find((k) => /State Legislative Districts - Lower/.test(k));
  // WHY STUSAB: the STATE field in most layers is a FIPS code (e.g. "11" for DC).
  // The States layer's STUSAB field is the standard two-letter abbreviation.
  const statesKey = Object.keys(geo).find((k) => /^States$/.test(k));
  const stateAbbr = geo[statesKey]?.[0]?.STUSAB ?? addr.state;
  return {
    matchedAddress: match.matchedAddress,
    state: stateAbbr,
    congressionalDistrict: geo[cdKey]?.[0]?.BASENAME ?? null,
    stateUpperDistrict: geo[upperKey]?.[0]?.BASENAME ?? null,
    stateLowerDistrict: geo[lowerKey]?.[0]?.BASENAME ?? null,
    coordinates: match.coordinates ?? null,
  };
}

// Allow direct CLI invocation from SKILL.md: node scripts/resolve-districts.js '{...}'
// Works on Windows and Unix — process.argv[1] is a plain path that we have
// to convert to a file:// URL before comparing against import.meta.url.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(process.argv[2]);
  resolveDistricts(input)
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}

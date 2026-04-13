import { getJson } from "./lib/http.js";
import { pathToFileURL } from "node:url";

const URL = "https://unitedstates.github.io/congress-legislators/legislators-current.json";

// WHY congress-legislators: keyless, maintained, canonical. bioguide id links
// downstream to GovTrack and FEC for this member.
export async function fetchMembers({ state, congressionalDistrict }, opts = {}) {
  const all = await getJson(URL, opts);
  const currentTerm = (m) => m.terms?.[m.terms.length - 1];
  const inState = all.filter((m) => currentTerm(m)?.state === state);
  const senators = inState.filter((m) => currentTerm(m)?.type === "sen");
  const repMatch = inState.find((m) => {
    const t = currentTerm(m);
    if (t?.type !== "rep") return false;
    // At-large states: district is 0 or "At Large" — normalize both sides
    const d = String(t.district ?? "").toLowerCase();
    const target = String(congressionalDistrict ?? "").toLowerCase();
    return d === target || (d === "0" && /at[- ]?large/.test(target));
  });
  const shape = (m) => {
    const t = currentTerm(m);
    return {
      bioguide: m.id?.bioguide,
      // Full id bundle — congress-legislators already has govtrack, fec[],
      // opensecrets, wikipedia, ballotpedia ids for every sitting member.
      // Downstream fetchers (voting, finance, narrative research) key off this
      // rather than making extra lookup round-trips to individual APIs.
      ids: m.id ?? {},
      name: m.name?.official_full ?? `${m.name?.first} ${m.name?.last}`,
      state: t?.state,
      district: t?.district ?? null,
      party: t?.party,
      type: t?.type,
      termEnd: t?.end,
      senateClass: t?.class ?? null,
    };
  };
  return {
    senators: senators.map(shape),
    houseRep: repMatch ? shape(repMatch) : null,
  };
}

// Works on Windows and Unix — process.argv[1] is a plain path that we have
// to convert to a file:// URL before comparing against import.meta.url.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(process.argv[2]);
  fetchMembers(input)
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}

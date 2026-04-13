import { getJson } from "./lib/http.js";
import { pathToFileURL } from "node:url";

const FEC = "https://api.open.fec.gov/v1";

// WHY: FEC is the only clean keyless-ish path for donor/finance data. A free
// api.data.gov key is user-provided (see setup-key.js). If skipped, the caller
// can choose to try an OpenSecrets scrape fallback, but we keep this module
// tight — it only returns structured data or a clear "skipped" marker.
export async function fetchFinance({ name, state }, opts = {}) {
  const { apiKey = null, fetch } = opts;
  if (!apiKey) {
    return {
      source: "skipped",
      reason: "No api.data.gov key configured — add one with `setup-key.js` to enable FEC finance data.",
    };
  }

  const cand = await getJson(
    `${FEC}/candidates/search/?q=${encodeURIComponent(name)}&state=${state}&api_key=${apiKey}`,
    { fetch },
  );
  const candidateId = cand?.results?.[0]?.candidate_id ?? null;
  if (!candidateId) return { source: "fec", candidateId: null, reason: "No FEC candidate match." };

  const [totals, employers] = await Promise.all([
    getJson(`${FEC}/candidate/${candidateId}/totals/?api_key=${apiKey}`, { fetch }),
    getJson(`${FEC}/schedules/schedule_a/by_employer/?candidate_id=${candidateId}&api_key=${apiKey}`, { fetch }),
  ]);
  return {
    source: "fec",
    candidateId,
    totals: totals?.results?.[0] ?? null,
    topEmployers: employers?.results ?? [],
  };
}

// Works on Windows and Unix — process.argv[1] is a plain path that we have
// to convert to a file:// URL before comparing against import.meta.url.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(process.argv[2]);
  fetchFinance(input, { apiKey: process.env.API_DATA_GOV_KEY ?? null })
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}

import { getJson } from "./lib/http.js";
import { pathToFileURL } from "node:url";

const VOTES = "https://www.govtrack.us/api/v2/vote_voter/?person=";

// WHY GovTrack: keyless, returns recent votes for any congressperson. We skip
// GovTrack's bioguide→id lookup endpoint because it was disabled (400 "Cannot
// filter on field: bioguideid" as of 2026). The `@unitedstates/congress-legislators`
// dataset already bundles the govtrack numeric id for every sitting member, so
// fetch-members.js exposes it via `rep.ids.govtrack` and we use it directly.
export async function fetchVoting({ govtrackId }, opts = {}) {
  if (!govtrackId) return { govtrackId: null, recentVotes: [], partyUnitySample: 0, partyUnityPct: null };

  const v = await getJson(`${VOTES}${govtrackId}&order_by=-created&limit=25`, opts);
  const recentVotes = (v?.objects ?? []).map((row) => ({
    voteId: row.vote?.id,
    date: row.vote?.created,
    question: row.vote?.question,
    category: row.vote?.category_label,
    result: row.vote?.result,
    memberVote: row.option?.value,
  }));

  return {
    govtrackId,
    recentVotes,
    partyUnitySample: recentVotes.length,
    // Full party-unity calculation requires roll-call breakdowns; deferred to v2.
    partyUnityPct: null,
  };
}

// Works on Windows and Unix — process.argv[1] is a plain path that we have
// to convert to a file:// URL before comparing against import.meta.url.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(process.argv[2]);
  fetchVoting(input)
    .then((r) => console.log(JSON.stringify(r)))
    .catch((e) => { console.error(e.message); process.exit(1); });
}

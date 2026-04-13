import { pathToFileURL } from "node:url";
// Pure function: takes already-resolved member list and classifies by term-end.
// WHY pure: no network — termEnd is already on each member from fetch-members.
// Keeping it pure makes the conditional opponent-research prompt trivially testable.

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

export function classifyElections(members, { now = new Date(), windowMonths = 12 } = {}) {
  const upcoming = [];
  for (const m of members) {
    if (!m.termEnd) continue;
    const end = new Date(m.termEnd);
    const diffMonths = (end - now) / MS_PER_MONTH;
    if (diffMonths > 0 && diffMonths <= windowMonths) {
      upcoming.push({ ...m, monthsToElection: Math.round(diffMonths), electionDate: m.termEnd });
    }
  }
  return { upcoming };
}

// Works on Windows and Unix — process.argv[1] is a plain path that we have
// to convert to a file:// URL before comparing against import.meta.url.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = JSON.parse(process.argv[2]);
  console.log(JSON.stringify(classifyElections(input)));
}

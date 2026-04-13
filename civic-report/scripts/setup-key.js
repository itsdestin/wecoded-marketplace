import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";
import { writeConfig, defaultConfigDir } from "./lib/config.js";

const BANNER = `
Civic Report — optional first-run setup
---------------------------------------
This skill works without any keys, but adding a free api.data.gov key unlocks
clean FEC campaign-finance data (top donors, industry breakdown).

1. Visit https://api.data.gov/signup/ (takes ~30 seconds, no billing)
2. Paste the key below, or press Enter to skip.
`;

// WHY injection: tests pass a deterministic readInput; prod uses readline.
async function defaultReadInput(promptText) {
  const rl = createInterface({ input: stdin, output: stdout });
  try { return await rl.question(promptText); } finally { rl.close(); }
}

export async function runSetup({ dir = defaultConfigDir(), readInput = defaultReadInput } = {}) {
  process.stdout.write(BANNER);
  const raw = (await readInput("api.data.gov key (or Enter to skip): ")).trim();
  if (!raw) {
    writeConfig({ skipped: true }, dir);
    process.stdout.write("Skipped. Finance section will be omitted from reports.\n");
    return { skipped: true };
  }
  writeConfig({ apiDataGovKey: raw }, dir);
  process.stdout.write("Saved. Finance section will use FEC data.\n");
  return { saved: true };
}

// Works on Windows and Unix — process.argv[1] is a plain path that we have
// to convert to a file:// URL before comparing against import.meta.url.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSetup().catch((e) => { console.error(e.message); process.exit(1); });
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchFinance } from "../scripts/fetch-finance.js";

const candidate = JSON.parse(readFileSync("tests/fixtures/fec-candidate.json", "utf8"));
const totals = { results: [{ receipts: 1000000, disbursements: 800000 }] };
const employers = { results: [{ employer: "Acme Corp", total: 50000 }] };

function seqFetch(responses) {
  let i = 0;
  return async () => {
    const r = responses[i++];
    return { ok: true, status: 200, json: async () => r };
  };
}

test("returns structured finance when key provided", async () => {
  const r = await fetchFinance(
    { name: "Jane Smith", state: "CA" },
    { apiKey: "test-key", fetch: seqFetch([candidate, totals, employers]) },
  );
  assert.equal(r.source, "fec");
  assert.equal(r.candidateId, "H0XX00000");
  assert.equal(r.totals.receipts, 1000000);
  assert.equal(r.topEmployers[0].employer, "Acme Corp");
});

test("returns skipped result with reason when no key", async () => {
  const r = await fetchFinance({ name: "Jane Smith", state: "CA" }, { apiKey: null });
  assert.equal(r.source, "skipped");
  assert.match(r.reason, /api\.data\.gov/i);
});

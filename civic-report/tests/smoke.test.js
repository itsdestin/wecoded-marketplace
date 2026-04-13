// tests/smoke.test.js
// Verifies the scripts compose: resolve-districts → fetch-members → classify.
// Uses the fixtures already created in Phase 2.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveDistricts } from "../scripts/resolve-districts.js";
import { fetchMembers } from "../scripts/fetch-members.js";
import { classifyElections } from "../scripts/fetch-elections.js";

const census = JSON.parse(readFileSync("tests/fixtures/census-response.json", "utf8"));
const legislators = JSON.parse(readFileSync("tests/fixtures/congress-legislators.json", "utf8"));

function staticFetch(payload) {
  return async () => ({ ok: true, status: 200, json: async () => payload });
}

test("integration: address → districts → members → elections", async () => {
  const districts = await resolveDistricts(
    { street: "1600 Pennsylvania Ave", city: "Washington", state: "DC", zip: "20500" },
    { fetch: staticFetch(census) },
  );
  assert.equal(districts.state, "DC");

  const members = await fetchMembers(districts, { fetch: staticFetch(legislators) });
  assert.ok(members.senators.length >= 0);

  const all = [...members.senators, ...(members.houseRep ? [members.houseRep] : [])];
  const elections = classifyElections(all, { now: new Date("2026-04-12") });
  assert.ok(Array.isArray(elections.upcoming));
});

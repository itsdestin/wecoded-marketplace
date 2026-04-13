import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveDistricts } from "../scripts/resolve-districts.js";

const fixture = JSON.parse(readFileSync("tests/fixtures/census-response.json", "utf8"));

function mockFetch(payload, { ok = true, status = 200 } = {}) {
  return async () => ({ ok, status, json: async () => payload, text: async () => JSON.stringify(payload) });
}

test("resolves federal + state districts from Census response", async () => {
  const r = await resolveDistricts(
    { street: "1600 Pennsylvania Ave", city: "Washington", state: "DC", zip: "20500" },
    { fetch: mockFetch(fixture) },
  );
  assert.equal(r.state, "DC");
  assert.ok(typeof r.congressionalDistrict === "string");
  assert.ok(typeof r.stateUpperDistrict === "string" || r.stateUpperDistrict === null);
  assert.ok(typeof r.stateLowerDistrict === "string" || r.stateLowerDistrict === null);
});

test("throws friendly error on no match", async () => {
  const empty = { result: { addressMatches: [] } };
  await assert.rejects(
    () => resolveDistricts(
      { street: "x", city: "y", state: "ZZ", zip: "00000" },
      { fetch: mockFetch(empty) },
    ),
    /US address/i,
  );
});

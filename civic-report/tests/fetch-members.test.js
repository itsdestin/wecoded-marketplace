import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchMembers } from "../scripts/fetch-members.js";

const fixture = JSON.parse(readFileSync("tests/fixtures/congress-legislators.json", "utf8"));
const mockFetch = (p) => async () => ({ ok: true, status: 200, json: async () => p });

test("returns 2 senators + 1 house rep for a state+district", async () => {
  const r = await fetchMembers({ state: "DC", congressionalDistrict: "At Large" }, { fetch: mockFetch(fixture) });
  assert.equal(r.senators.length, 2);
  assert.equal(r.houseRep !== null, true);
  assert.equal(r.houseRep.state, "DC");
});

test("houseRep is null when no matching district", async () => {
  const r = await fetchMembers({ state: "ZZ", congressionalDistrict: "99" }, { fetch: mockFetch(fixture) });
  assert.equal(r.houseRep, null);
});

test("exposes full id bundle on each member", async () => {
  const r = await fetchMembers({ state: "DC", congressionalDistrict: "At Large" }, { fetch: mockFetch(fixture) });
  assert.ok(r.senators[0].ids);
  assert.equal(r.senators[0].ids.bioguide, "S000001");
});

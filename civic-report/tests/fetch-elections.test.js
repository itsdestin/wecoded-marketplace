import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyElections } from "../scripts/fetch-elections.js";

const now = new Date("2026-04-12T00:00:00Z");

test("flags members whose term ends within 12 months", () => {
  const members = [
    { bioguide: "A", name: "Soon", termEnd: "2027-01-03" },
    { bioguide: "B", name: "Far",  termEnd: "2031-01-03" },
    { bioguide: "C", name: "Past", termEnd: "2025-01-03" },
  ];
  const r = classifyElections(members, { now });
  assert.deepEqual(r.upcoming.map((m) => m.bioguide), ["A"]);
  assert.equal(r.upcoming[0].monthsToElection >= 8, true);
});

test("returns empty upcoming when nobody is within window", () => {
  const r = classifyElections([{ bioguide: "X", name: "X", termEnd: "2035-01-03" }], { now });
  assert.equal(r.upcoming.length, 0);
});

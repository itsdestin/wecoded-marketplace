import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fetchVoting } from "../scripts/fetch-voting.js";

const votes = JSON.parse(readFileSync("tests/fixtures/govtrack-votes.json", "utf8"));
const mockFetch = (p) => async () => ({ ok: true, status: 200, json: async () => p });

test("returns recent votes for a govtrack id", async () => {
  const r = await fetchVoting({ govtrackId: 412612 }, { fetch: mockFetch(votes) });
  assert.equal(r.govtrackId, 412612);
  assert.equal(r.recentVotes.length, 1);
  assert.equal(r.recentVotes[0].memberVote, "Yea");
});

test("returns empty votes when govtrackId is null", async () => {
  const r = await fetchVoting({ govtrackId: null });
  assert.equal(r.govtrackId, null);
  assert.deepEqual(r.recentVotes, []);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { hashAddress } from "../scripts/lib/hash-address.js";

test("normalizes whitespace and case before hashing", () => {
  const a = hashAddress("123 Main St, Springfield, IL 62704");
  const b = hashAddress("  123 main st,  springfield,  il  62704  ");
  assert.equal(a, b);
});

test("returns 6 lowercase hex chars", () => {
  const h = hashAddress("123 Main St, Springfield, IL 62704");
  assert.match(h, /^[0-9a-f]{6}$/);
});

test("different addresses produce different hashes", () => {
  assert.notEqual(
    hashAddress("1 A St, X, CA 90001"),
    hashAddress("2 B St, Y, CA 90002"),
  );
});

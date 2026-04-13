import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig, writeConfig } from "../scripts/lib/config.js";

function tmp() { return mkdtempSync(join(tmpdir(), "civic-")); }

test("writeConfig then readConfig round-trips", () => {
  const dir = tmp();
  try {
    writeConfig({ apiDataGovKey: "abc" }, dir);
    assert.deepEqual(readConfig(dir), { apiDataGovKey: "abc" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("readConfig returns null when file absent", () => {
  const dir = tmp();
  try {
    assert.equal(readConfig(dir), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

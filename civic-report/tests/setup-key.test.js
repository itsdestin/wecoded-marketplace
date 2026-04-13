import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSetup } from "../scripts/setup-key.js";
import { readConfig } from "../scripts/lib/config.js";

const tmp = () => mkdtempSync(join(tmpdir(), "civic-setup-"));

test("stores provided key", async () => {
  const dir = tmp();
  try {
    await runSetup({ dir, readInput: async () => "MY_KEY_123" });
    assert.deepEqual(readConfig(dir), { apiDataGovKey: "MY_KEY_123" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("stores skipped when input is empty", async () => {
  const dir = tmp();
  try {
    await runSetup({ dir, readInput: async () => "" });
    assert.deepEqual(readConfig(dir), { skipped: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("trims whitespace around the key", async () => {
  const dir = tmp();
  try {
    await runSetup({ dir, readInput: async () => "  KEY  \n" });
    assert.deepEqual(readConfig(dir), { apiDataGovKey: "KEY" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

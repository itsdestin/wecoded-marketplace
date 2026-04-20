import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readLedger, writeLedgerEntry } from '../scripts/lib/ledger.js';
import { verifyGhAvailable } from '../scripts/publish.js';

let tmpConfigDir;
beforeEach(async () => {
  tmpConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wmp-ledger-'));
});

test('readLedger returns empty when file is missing', async () => {
  const l = await readLedger({ configDir: tmpConfigDir });
  assert.deepEqual(l, { version: 1, entries: [] });
});

test('writeLedgerEntry appends then updates in place', async () => {
  await writeLedgerEntry({ configDir: tmpConfigDir, entry: {
    pluginId: 'a', repoUrl: 'https://github.com/x/a', version: '0.1.0',
    publishedAt: '2026-04-20T00:00:00Z', state: 'repo-created',
  }});
  await writeLedgerEntry({ configDir: tmpConfigDir, entry: {
    pluginId: 'a', state: 'complete', communityPR: 'https://.../pull/1',
  }});
  const l = await readLedger({ configDir: tmpConfigDir });
  assert.equal(l.entries.length, 1);
  assert.equal(l.entries[0].state, 'complete');
  assert.equal(l.entries[0].communityPR, 'https://.../pull/1');
  assert.equal(l.entries[0].repoUrl, 'https://github.com/x/a');
});

test('verifyGhAvailable with fake spawn returns ok when gh exits 0', async () => {
  const fakeSpawn = async (cmd, args) => ({
    exitCode: 0,
    stdout: args.includes('--version') ? 'gh version 2.40.0' : 'Logged in to github.com',
    stderr: '',
  });
  const result = await verifyGhAvailable({ spawn: fakeSpawn });
  assert.equal(result.ok, true);
});

test('verifyGhAvailable reports unauthed when gh auth status fails', async () => {
  const fakeSpawn = async (cmd, args) => args.includes('status')
    ? { exitCode: 1, stdout: '', stderr: 'not logged in' }
    : { exitCode: 0, stdout: 'gh version 2.40.0', stderr: '' };
  const result = await verifyGhAvailable({ spawn: fakeSpawn });
  assert.equal(result.ok, false);
  assert.match(result.reason, /auth/i);
});

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

import { publishCommunity } from '../scripts/publish.js';

function recordingSpawn(responses) {
  const calls = [];
  const impl = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    const key = Object.keys(responses).find(k => calls[calls.length - 1].includes(k));
    return responses[key] || { exitCode: 0, stdout: '', stderr: '' };
  };
  impl.calls = calls;
  return impl;
}

test('publishCommunity runs gh repo create, push, and opens PR', async () => {
  const spawn = recordingSpawn({
    'repo create': { exitCode: 0, stdout: 'https://github.com/alice/demo', stderr: '' },
    'pr create': { exitCode: 0, stdout: 'https://github.com/itsdestin/wecoded-marketplace/pull/100', stderr: '' },
  });
  const result = await publishCommunity({
    workingDir: '/tmp/does-not-matter',
    pluginId: 'demo',
    ghUser: 'alice',
    metadata: { displayName: 'Demo', description: 'd', author: { name: 'alice' }, category: 'personal' },
    spawn,
  });
  assert.ok(spawn.calls.some(c => c.startsWith('gh repo create')));
  assert.ok(spawn.calls.some(c => c.startsWith('git push')) || spawn.calls.some(c => c.includes('--push')));
  assert.ok(spawn.calls.some(c => c.startsWith('gh pr create')));
  assert.equal(result.repoUrl, 'https://github.com/alice/demo');
  assert.equal(result.communityPR, 'https://github.com/itsdestin/wecoded-marketplace/pull/100');
});

test('publishCommunity fails gracefully when repo create fails', async () => {
  const spawn = async (cmd, args) => args.includes('repo') && args.includes('create')
    ? { exitCode: 1, stdout: '', stderr: 'name already taken' }
    : { exitCode: 0, stdout: '', stderr: '' };
  await assert.rejects(async () => {
    await publishCommunity({
      workingDir: '/tmp/does-not-matter',
      pluginId: 'demo',
      ghUser: 'alice',
      metadata: { displayName: 'Demo', description: 'd', author: { name: 'alice' }, category: 'personal' },
      spawn,
    });
  }, /already taken/);
});

import { publishAdoptionRequest, publish } from '../scripts/publish.js';

test('publishAdoptionRequest opens a PR with request file contents', async () => {
  const spawn = recordingSpawn({
    'pr create': { exitCode: 0, stdout: 'https://github.com/itsdestin/wecoded-marketplace/pull/101', stderr: '' },
  });
  const result = await publishAdoptionRequest({
    pluginId: 'demo',
    ghUser: 'alice',
    metadata: { displayName: 'Demo', description: 'd', author: { name: 'alice' }, category: 'personal' },
    communityPR: 'https://github.com/itsdestin/wecoded-marketplace/pull/100',
    reason: 'I do not have time to maintain this long-term.',
    repoUrl: 'https://github.com/alice/demo',
    spawn,
  });
  assert.equal(result.adoptionPR, 'https://github.com/itsdestin/wecoded-marketplace/pull/101');
  const prCreateCall = spawn.calls.find(c => c.startsWith('gh pr create'));
  assert.match(prCreateCall, /adoption-request/);
});

test('publish resumes from "repo-created" state in ledger', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wmp-resume-'));
  await writeLedgerEntry({ configDir, entry: {
    pluginId: 'resumer',
    repoUrl: 'https://github.com/alice/resumer',
    version: '0.1.0',
    publishedAt: new Date().toISOString(),
    state: 'repo-created',
  }});

  const spawn = recordingSpawn({
    'pr create': { exitCode: 0, stdout: 'https://.../pull/5', stderr: '' },
  });

  const result = await publish({
    workingDir: '/tmp/xx',
    pluginId: 'resumer',
    ghUser: 'alice',
    metadata: { displayName: 'R', description: 'd', author: { name: 'alice' }, category: 'personal' },
    pathChoice: 'community',
    configDir,
    spawn,
  });
  assert.ok(!spawn.calls.some(c => c.startsWith('gh repo create')));
  assert.ok(spawn.calls.some(c => c.startsWith('gh pr create')));
  assert.equal(result.communityPR, 'https://.../pull/5');
});

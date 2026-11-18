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

// Stub that behaves like gh/git enough for openCommunityPr: `gh repo clone` creates the
// target dir with a marketplace.json in it, so the real file read/write path is exercised.
function marketplaceSpawn({ failPushTimes = 0 } = {}) {
  const calls = [];
  let pushes = 0;
  const impl = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'gh' && args[0] === 'repo' && args[1] === 'clone') {
      const dir = args[3];
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'marketplace.json'), JSON.stringify({ plugins: [{ name: 'existing' }] }, null, 2) + '\n');
      impl.cloneDir = dir;
    }
    if (cmd === 'git' && args.includes('commit')) {
      impl.committed = await fs.readFile(path.join(impl.cloneDir, 'marketplace.json'), 'utf8');
    }
    if (cmd === 'git' && args.includes('push') && pushes++ < failPushTimes) {
      return { exitCode: 1, stdout: '', stderr: 'fork not ready' };
    }
    if (cmd === 'git' && args[0] === 'config') return { exitCode: 0, stdout: 'x', stderr: '' };
    if (cmd === 'gh' && args[0] === 'repo' && args[1] === 'create') return { exitCode: 0, stdout: 'https://github.com/alice/demo', stderr: '' };
    if (cmd === 'gh' && args[0] === 'pr') return { exitCode: 0, stdout: 'https://github.com/itsdestin/wecoded-marketplace/pull/100', stderr: '' };
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  impl.calls = calls;
  return impl;
}

test('publishCommunity forks, pushes the branch to the fork, THEN opens a PR with a user:branch head', async () => {
  const spawn = marketplaceSpawn();
  const result = await publishCommunity({
    workingDir: '/tmp/does-not-matter',
    pluginId: 'demo',
    ghUser: 'alice',
    metadata: { displayName: 'Demo', description: 'd', author: { name: 'alice' }, category: 'personal', tags: ['journal'], audience: 'general' },
    spawn,
  });
  const idx = (re) => spawn.calls.findIndex(c => re.test(c));
  const fork = idx(/^gh repo fork itsdestin\/wecoded-marketplace/);
  const commit = idx(/commit -s/);
  const push = idx(/ push .*fork add-plugin\/demo:add-plugin\/demo/);
  const pr = idx(/^gh pr create/);
  assert.ok(fork >= 0 && commit > fork && push > commit && pr > push, spawn.calls.join('\n'));
  assert.match(spawn.calls[pr], /--head alice:add-plugin\/demo/);
  // The branch is created before the commit.
  assert.ok(idx(/checkout -b add-plugin\/demo/) < commit);
  // The commit contains the new listing (URL source, community) alongside the existing entry.
  const committed = JSON.parse(spawn.committed);
  assert.deepEqual(committed.plugins.map(p => p.name), ['existing', 'demo']);
  const e = committed.plugins[1];
  assert.equal(e.source.url, 'https://github.com/alice/demo.git');
  assert.equal(e.sourceMarketplace, 'community');
  assert.deepEqual(e.tags, ['journal']);
  assert.equal(e.audience, 'general');
  assert.equal(result.repoUrl, 'https://github.com/alice/demo');
  assert.equal(result.communityPR, 'https://github.com/itsdestin/wecoded-marketplace/pull/100');
  // Temp clone is cleaned up.
  await assert.rejects(fs.access(spawn.cloneDir));
});

test('openCommunityPr retries a push while a new fork is still being set up', async () => {
  const spawn = marketplaceSpawn({ failPushTimes: 2 });
  const { openCommunityPr } = await import('../scripts/publish.js');
  const r = await openCommunityPr({
    pluginId: 'demo', ghUser: 'alice', repoUrl: 'https://github.com/alice/demo',
    metadata: { displayName: 'Demo', description: 'd', author: { name: 'alice' }, category: 'personal' },
    spawn, sleep: async () => {},
  });
  assert.equal(spawn.calls.filter(c => / push /.test(c)).length, 3);
  assert.match(r.communityPR, /pull\/100/);
});

test('openCommunityPr does not open a PR if the push never succeeds', async () => {
  const spawn = marketplaceSpawn({ failPushTimes: 99 });
  const { openCommunityPr } = await import('../scripts/publish.js');
  await assert.rejects(openCommunityPr({
    pluginId: 'demo', ghUser: 'alice', repoUrl: 'https://github.com/alice/demo',
    metadata: { displayName: 'Demo', description: 'd', author: { name: 'alice' }, category: 'personal' },
    spawn, sleep: async () => {},
  }), /fork not ready/);
  assert.ok(!spawn.calls.some(c => c.startsWith('gh pr create')));
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

  const spawn = marketplaceSpawn();

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
  assert.equal(result.communityPR, 'https://github.com/itsdestin/wecoded-marketplace/pull/100');
});

test('publish with dryRun does not call gh repo create', async () => {
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wmp-dry-'));
  const spawn = recordingSpawn({});
  const result = await publish({
    workingDir: '/tmp/xx',
    pluginId: 'dryplugin',
    ghUser: 'alice',
    metadata: { displayName: 'D', description: 'd', author: { name: 'alice' }, category: 'personal' },
    pathChoice: 'community',
    configDir,
    spawn,
    dryRun: true,
  });
  assert.equal(spawn.calls.length, 0);
  assert.equal(result.dryRun, true);
  assert.ok(result.plan);
  assert.match(result.plan, /would create/i);
});

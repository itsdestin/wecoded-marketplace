import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readLedger, writeLedgerEntry } from './lib/ledger.js';

function defaultSpawn(cmd, args) {
  return new Promise((resolve) => {
    const child = nodeSpawn(cmd, args);
    let out = '', err = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('close', code => resolve({ exitCode: code ?? 0, stdout: out, stderr: err }));
    child.on('error', e => resolve({ exitCode: -1, stdout: '', stderr: e.message }));
  });
}

export async function verifyGhAvailable({ spawn = defaultSpawn } = {}) {
  const version = await spawn('gh', ['--version']);
  if (version.exitCode !== 0) {
    return { ok: false, reason: 'gh CLI is not installed or not on PATH' };
  }
  const status = await spawn('gh', ['auth', 'status']);
  if (status.exitCode !== 0) {
    return { ok: false, reason: 'gh is installed but not authenticated. Run: gh auth login' };
  }
  return { ok: true, version: (version.stdout || '').trim() };
}

// Helper: run a command and throw on non-zero exit.
async function run(spawn, cmd, args) {
  const r = await spawn(cmd, args);
  if (r.exitCode !== 0) {
    const msg = r.stderr || r.stdout || `${cmd} exited ${r.exitCode}`;
    throw new Error(msg);
  }
  return r;
}

// Build the marketplace.json entry shape for a community plugin.
export function marketplaceEntryFor(pluginId, metadata, repoUrl) {
  const entry = {
    name: pluginId,
    displayName: metadata.displayName,
    description: metadata.description,
    author: metadata.author,
    category: metadata.category,
    source: { source: 'url', url: `${repoUrl}.git` },
    homepage: repoUrl,
    sourceMarketplace: 'community',
  };
  // WHY: CI (validateEnums) checks tags/lifeArea/audience on marketplace.json entries, and
  // the listing's filters use them. They were collected and checked in preflight but never
  // written to the entry. Only include what the contributor actually set.
  if (metadata.tags?.length) entry.tags = metadata.tags;
  if (metadata.lifeArea?.length) entry.lifeArea = metadata.lifeArea;
  if (metadata.audience) entry.audience = metadata.audience;
  return entry;
}

// Phase 1: create the user's public repo and push the local working dir to it.
// Returns { repoUrl }.
export async function createUserRepo({ workingDir, pluginId, ghUser, spawn = defaultSpawn }) {
  const r = await run(spawn, 'gh', [
    'repo', 'create', `${ghUser}/${pluginId}`,
    '--public',
    '--source', workingDir,
    '--push',
  ]);
  // gh repo create --push prints the new repo URL to stdout on success.
  const repoUrl = (r.stdout || '').trim() || `https://github.com/${ghUser}/${pluginId}`;
  return { repoUrl };
}

// The registry we list in. Outside contributors have no write access to it, so every
// submission goes fork -> branch -> push to the fork -> cross-repo PR.
const MARKETPLACE_REPO = 'itsdestin/wecoded-marketplace';

// Add (or refresh) the plugin's entry in marketplace.json text. Returns the new file text.
// WHY marketplace.json only: CONTRIBUTING.md says "add your entry to marketplace.json and
// ONLY that file" — index.json / skills/index.json are generated and hand edits are
// overwritten. Output format (2-space JSON + trailing newline) matches what CI writes.
export function addEntryToMarketplaceJson(text, entry) {
  const data = JSON.parse(text);
  const plugins = Array.isArray(data.plugins) ? data.plugins : [];
  const i = plugins.findIndex(p => p.name === entry.name);
  if (i >= 0) {
    // WHY refuse: a name clash must never silently replace someone else's listing (e.g. a
    // first-party entry). Only the same community submission (same source URL) may be refreshed.
    const old = plugins[i];
    if (old.sourceMarketplace !== 'community' || old.source?.url !== entry.source?.url) {
      throw new Error(`marketplace.json already has a different plugin named "${entry.name}"; pick another id`);
    }
    plugins[i] = entry;
  } else plugins.push(entry);
  data.plugins = plugins;
  return JSON.stringify(data, null, 2) + '\n';
}

// Phase 2: fork the marketplace, put the listing on a branch in the fork, and open a PR
// from that branch. Returns { communityPR }.
// WHY this exists: the old version ran `gh pr create --head add-plugin/<id>` against a
// branch nothing ever created, so it failed for everyone (and a contributor without write
// access cannot push to the real repo anyway).
export async function openCommunityPr({
  pluginId, metadata, repoUrl, ghUser, spawn = defaultSpawn,
  sleep = (ms) => new Promise(r => setTimeout(r, ms)),
}) {
  const branch = `add-plugin/${pluginId}`;
  const body = [
    `Adds \`${pluginId}\` as a community plugin.`,
    '',
    `- **Author:** ${metadata.author?.name || 'unknown'}`,
    `- **Source:** ${repoUrl}`,
    `- **Description:** ${metadata.description}`,
    '',
    'Published via `wecoded-marketplace-publisher`.',
  ].join('\n');

  // Who is the contributor? (the PR head must be "<login>:<branch>")
  let login = ghUser;
  if (!login) {
    login = (await run(spawn, 'gh', ['api', 'user', '--jq', '.login'])).stdout.trim();
  }

  // Idempotent: if the fork already exists gh just reports it and exits 0.
  await run(spawn, 'gh', ['repo', 'fork', MARKETPLACE_REPO, '--clone=false']);

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wmp-marketplace-'));
  try {
    const dir = path.join(tmp, 'marketplace');
    // Full (not --depth 1) clone: a shallow clone can be refused when pushed to a fork.
    // Clone the REAL registry (fresh master), not the fork: a stale fork would put the
    // listing on top of an old marketplace.json and conflict with the real one.
    await run(spawn, 'gh', ['repo', 'clone', MARKETPLACE_REPO, dir]);
    const git = (...a) => run(spawn, 'git', ['-C', dir, ...a]);

    const mpPath = path.join(dir, 'marketplace.json');
    const entry = marketplaceEntryFor(pluginId, metadata, repoUrl);
    await fs.writeFile(mpPath, addEntryToMarketplaceJson(await fs.readFile(mpPath, 'utf8'), entry));

    await git('checkout', '-b', branch);
    await git('add', 'marketplace.json');
    // WHY -s: CONTRIBUTING.md requires a DCO sign-off on every commit. Use the contributor's
    // own git identity; only if none is configured fall back to their GitHub no-reply address.
    const haveName = (await spawn('git', ['config', 'user.name'])).stdout.trim();
    const haveEmail = (await spawn('git', ['config', 'user.email'])).stdout.trim();
    const identity = haveName && haveEmail ? [] : [
      '-c', `user.name=${login}`, '-c', `user.email=${login}@users.noreply.github.com`,
    ];
    await git(...identity, 'commit', '-s', '-m', `Add ${metadata.displayName} (community)`);

    await git('remote', 'add', 'fork', `https://github.com/${login}/wecoded-marketplace.git`);
    // WHY the inline credential helper: plain git does not know gh's login, and
    // `gh auth setup-git` would change the contributor's global git config. This applies to
    // this one push only. --force because add-plugin/<id> is the contributor's own branch on
    // their own fork (a retry after a half-finished run must be able to overwrite it).
    // Retry: a just-created fork can take a few seconds before it accepts pushes.
    let pushErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await git('-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential',
          'push', '--force', 'fork', `${branch}:${branch}`);
        pushErr = null;
        break;
      } catch (e) {
        pushErr = e;
        if (attempt < 3) await sleep(3000); // no pointless wait after the final attempt
      }
    }
    if (pushErr) throw pushErr;

    const r = await run(spawn, 'gh', [
      'pr', 'create',
      '--repo', MARKETPLACE_REPO,
      '--head', `${login}:${branch}`,
      '--base', 'master',
      '--title', `Add ${metadata.displayName} (community)`,
      '--body', body,
    ]);
    return { communityPR: (r.stdout || '').trim() };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

// Convenience wrapper: runs both phases in sequence.
// Task 13 (orchestrator with ledger resume) calls the two phase functions
// individually so it can resume from a checkpoint; this wrapper is for
// the simple end-to-end path.
export async function publishCommunity({ workingDir, pluginId, ghUser, metadata, spawn = defaultSpawn }) {
  const { repoUrl } = await createUserRepo({ workingDir, pluginId, ghUser, spawn });
  const { communityPR } = await openCommunityPr({ pluginId, metadata, repoUrl, ghUser, spawn });
  return {
    repoUrl,
    communityPR,
    marketplaceEntry: marketplaceEntryFor(pluginId, metadata, repoUrl),
  };
}

// Build the body for an adoption request PR.
function adoptionRequestBody({ pluginId, metadata, communityPR, reason, repoUrl, ghUser }) {
  return [
    `# Adoption Request: ${metadata.displayName}`,
    '',
    `**Plugin ID:** \`${pluginId}\``,
    `**Submitter:** @${ghUser}`,
    `**Source repo:** ${repoUrl}`,
    `**Community listing PR:** ${communityPR}`,
    `**Category:** ${metadata.category}`,
    '',
    '## Description',
    '',
    metadata.description || '',
    '',
    '## Why adoption?',
    '',
    reason,
    '',
    '## Acknowledgments',
    '',
    'I understand that if YouCoded accepts this adoption request:',
    '- YouCoded will host and maintain the adopted version of this plugin.',
    '- The community listing from my repo will be delisted in favor of the adopted copy.',
    '- I will no longer control updates, bug fixes, or the plugin itself.',
    '- I keep ownership of my source repo, but it will no longer be what the marketplace lists.',
    '',
    'If YouCoded declines this request, nothing changes — my community listing remains.',
  ].join('\n');
}

// Phase 3 (optional): open an adoption-request PR on itsdestin/wecoded-marketplace.
// Returns { adoptionPR }.
export async function publishAdoptionRequest({ pluginId, ghUser, metadata, communityPR, reason, repoUrl, spawn = defaultSpawn }) {
  const body = adoptionRequestBody({ pluginId, metadata, communityPR, reason, repoUrl, ghUser });
  const branch = `adoption-request/${pluginId}`;
  const r = await run(spawn, 'gh', [
    'pr', 'create',
    '--repo', 'itsdestin/wecoded-marketplace',
    '--head', branch,
    '--title', `[Adoption Request] ${metadata.displayName}`,
    '--body', body,
    '--label', 'adoption-request',
  ]);
  return { adoptionPR: (r.stdout || '').trim() };
}

// Top-level orchestrator: reads the ledger to resume interrupted runs,
// calls createUserRepo + openCommunityPr (skipping phases already done),
// and optionally adds the adoption PR. Writes ledger state after each phase.
export async function publish({ workingDir, pluginId, ghUser, metadata, pathChoice, reason, configDir, spawn = defaultSpawn, dryRun = false }) {
  // Dry-run: return a human-readable plan without calling any gh operations.
  if (dryRun) {
    const planLines = [
      `Would create GitHub repo: ${ghUser}/${pluginId}`,
      `Would push working dir: ${workingDir}`,
      `Would fork itsdestin/wecoded-marketplace into your GitHub account, push branch add-plugin/${pluginId} to the fork, and open a PR from it`,
    ];
    if (pathChoice === 'adoption') {
      planLines.push(`Would open adoption-request PR at: itsdestin/wecoded-marketplace (branch: adoption-request/${pluginId})`);
    }
    return { dryRun: true, plan: planLines.join('\n') };
  }

  const ledger = await readLedger({ configDir });
  const prior = ledger.entries.find(e => e.pluginId === pluginId);

  let repoUrl = prior?.repoUrl;
  let communityPR = prior?.communityPR;
  let adoptionPR = prior?.adoptionPR;

  // Phase 1: create user repo (skip if ledger already records repoUrl from a prior run).
  if (!repoUrl) {
    const created = await createUserRepo({ workingDir, pluginId, ghUser, spawn });
    repoUrl = created.repoUrl;
    await writeLedgerEntry({ configDir, entry: {
      pluginId, repoUrl, version: '0.1.0', publishedAt: new Date().toISOString(), state: 'repo-created',
    }});
  }

  // Phase 2: open community PR (skip if ledger already has a communityPR).
  if (!communityPR) {
    const pr = await openCommunityPr({ pluginId, metadata, repoUrl, ghUser, spawn });
    communityPR = pr.communityPR;
    await writeLedgerEntry({ configDir, entry: { pluginId, communityPR, state: 'community-pr-open' } });
  }

  // Phase 3 (optional): adoption PR (skip if already done or not requested).
  if (pathChoice === 'adoption' && !adoptionPR) {
    const adoption = await publishAdoptionRequest({
      pluginId, ghUser, metadata, communityPR, reason, repoUrl, spawn,
    });
    adoptionPR = adoption.adoptionPR;
    await writeLedgerEntry({ configDir, entry: { pluginId, adoptionPR, state: 'complete-with-adoption' } });
  } else if (pathChoice !== 'adoption') {
    await writeLedgerEntry({ configDir, entry: { pluginId, state: 'complete' } });
  }

  return { repoUrl, communityPR, adoptionPR };
}

async function runCli() {
  const [, scriptPath, subcommand, ...rest] = process.argv;
  try {
    if (subcommand === 'preflight-gh') {
      const result = await verifyGhAvailable();
      process.stdout.write(JSON.stringify(result));
      return;
    }

    if (subcommand === 'publish') {
      const input = JSON.parse(rest[0] || '{}');
      const result = await publish(input);
      process.stdout.write(JSON.stringify(result));
      return;
    }

    process.stderr.write(JSON.stringify({
      error: `Unknown subcommand: ${subcommand || '(none)'}`,
      usage: 'node publish.js preflight-gh | publish \'{...}\'',
    }));
    process.exit(2);
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runCli();
}

import { spawn as nodeSpawn } from 'node:child_process';
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
  return {
    name: pluginId,
    displayName: metadata.displayName,
    description: metadata.description,
    author: metadata.author,
    category: metadata.category,
    source: { source: 'url', url: `${repoUrl}.git` },
    homepage: repoUrl,
    sourceMarketplace: 'community',
  };
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

// Phase 2: open a PR against itsdestin/wecoded-marketplace to list the plugin.
// Returns { communityPR }.
export async function openCommunityPr({ pluginId, metadata, repoUrl, spawn = defaultSpawn }) {
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

  const r = await run(spawn, 'gh', [
    'pr', 'create',
    '--repo', 'itsdestin/wecoded-marketplace',
    '--head', branch,
    '--title', `Add ${metadata.displayName} (community)`,
    '--body', body,
  ]);
  return { communityPR: (r.stdout || '').trim() };
}

// Convenience wrapper: runs both phases in sequence.
// Task 13 (orchestrator with ledger resume) calls the two phase functions
// individually so it can resume from a checkpoint; this wrapper is for
// the simple end-to-end path.
export async function publishCommunity({ workingDir, pluginId, ghUser, metadata, spawn = defaultSpawn }) {
  const { repoUrl } = await createUserRepo({ workingDir, pluginId, ghUser, spawn });
  const { communityPR } = await openCommunityPr({ pluginId, metadata, repoUrl, spawn });
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
    'I understand that if WeCoded accepts this adoption request:',
    '- WeCoded will host and maintain the adopted version of this plugin.',
    '- The community listing from my repo will be delisted in favor of the adopted copy.',
    '- I will no longer control updates, bug fixes, or the plugin itself.',
    '- I keep ownership of my source repo, but it will no longer be what the marketplace lists.',
    '',
    'If WeCoded declines this request, nothing changes — my community listing remains.',
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
      `Would open community PR at: itsdestin/wecoded-marketplace (branch: add-plugin/${pluginId})`,
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
    const pr = await openCommunityPr({ pluginId, metadata, repoUrl, spawn });
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

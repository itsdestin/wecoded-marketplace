import { spawn as nodeSpawn } from 'node:child_process';

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

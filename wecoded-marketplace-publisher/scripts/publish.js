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

import fs from 'node:fs/promises';
import path from 'node:path';
import { SECRET_PATTERNS } from './lib/secret-patterns.js';

const MAX_BYTES = 50 * 1024 * 1024;
const FORBIDDEN = ['.env', 'node_modules', '.git'];

// Recursively sum the total byte size of all files under a directory.
async function dirSize(dir) {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) {
      const stat = await fs.stat(p);
      total += stat.size;
    }
  }
  return total;
}

// Recursively collect all file paths under a directory.
async function walkFiles(dir) {
  const out = [];
  async function walk(d) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) out.push(p);
    }
  }
  await walk(dir);
  return out;
}

// Scan text files for secret patterns (re-uses same patterns as build-plugin sanitizer).
async function secretScanFiles(dir) {
  const findings = [];
  const files = await walkFiles(dir);
  for (const f of files) {
    if (!/\.(js|ts|md|json|txt|sh|py)$/i.test(f)) continue;
    const text = await fs.readFile(f, 'utf8');
    for (const pat of SECRET_PATTERNS) {
      pat.regex.lastIndex = 0;
      if (pat.regex.test(text)) {
        findings.push({ file: path.relative(dir, f), pattern: pat.name });
      }
    }
  }
  return findings;
}

/**
 * Run local preflight checks against a built plugin directory and its metadata.
 * Returns { pass: boolean, checks: Array<{ name, status, detail }> }.
 */
export async function preflightLocal({ pluginDir, metadata }) {
  const checks = [];

  // Check 1: total plugin size must be under 50 MB.
  const size = await dirSize(pluginDir);
  checks.push({
    name: 'size',
    status: size < MAX_BYTES ? 'pass' : 'fail',
    detail: `Plugin size: ${(size / 1024 / 1024).toFixed(2)} MB (limit 50 MB)`,
  });

  // Check 2: all required marketplace metadata fields must be non-empty.
  const requiredPresent =
    !!metadata.displayName &&
    !!metadata.description &&
    !!metadata.author?.name &&
    !!metadata.category;
  checks.push({
    name: 'required-fields',
    status: requiredPresent ? 'pass' : 'fail',
    detail: requiredPresent
      ? 'All required fields present'
      : 'Missing one of: displayName, description, author.name, category',
  });

  // Check 3: no forbidden paths (node_modules, .git, .env) in the plugin tree.
  const files = await walkFiles(pluginDir);
  const bad = files.filter(f =>
    FORBIDDEN.some(
      x => f.includes(path.sep + x + path.sep) || f.endsWith(path.sep + x)
    )
  );
  checks.push({
    name: 'hygiene',
    status: bad.length === 0 ? 'pass' : 'fail',
    detail:
      bad.length === 0
        ? 'No forbidden files present'
        : `Forbidden files found: ${bad.map(b => path.relative(pluginDir, b)).join(', ')}`,
  });

  // Check 4: no secrets left in source files (re-scans after build sanitization as a safety net).
  const secretFindings = await secretScanFiles(pluginDir);
  checks.push({
    name: 'secret-scan',
    status: secretFindings.length === 0 ? 'pass' : 'fail',
    detail:
      secretFindings.length === 0
        ? 'No secrets detected'
        : `Detected: ${secretFindings.map(f => `${f.file} (${f.pattern})`).join('; ')}`,
  });

  const pass = checks.every(c => c.status !== 'fail');
  return { pass, checks };
}

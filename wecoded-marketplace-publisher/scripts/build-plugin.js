import fs from 'node:fs/promises';
import path from 'node:path';
import { SECRET_PATTERNS } from './lib/secret-patterns.js';

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function copyFile(src, dest) {
  await ensureDir(path.dirname(dest));
  await fs.copyFile(src, dest);
}

function generatePluginJson(pluginId, metadata) {
  return {
    name: pluginId,
    version: '0.1.0',
    description: metadata.description || '',
    author: metadata.author || { name: 'unknown' },
    homepage: metadata.homepage || null,
    keywords: metadata.tags || [],
  };
}

async function writeHooksManifest(outDir, hookPieces) {
  if (hookPieces.length === 0) return;
  const manifest = { hooks: {} };
  for (const h of hookPieces) {
    manifest.hooks[h.event] ||= [];
    manifest.hooks[h.event].push({
      matcher: h.matcher || undefined,
      hooks: [{ type: 'command', command: h.command }],
    });
  }
  const p = path.join(outDir, 'hooks', 'hooks-manifest.json');
  await ensureDir(path.dirname(p));
  await fs.writeFile(p, JSON.stringify(manifest, null, 2));
}

async function writeMcpStub(outDir, mcpPieces) {
  if (mcpPieces.length === 0) return;
  const stub = { mcpServers: {} };
  for (const m of mcpPieces) {
    stub.mcpServers[m.name] = m.config;
  }
  await fs.writeFile(path.join(outDir, '.mcp.json'), JSON.stringify(stub, null, 2));
}

async function writeReadmeIfMissing(outDir, metadata) {
  const p = path.join(outDir, 'README.md');
  try {
    await fs.access(p);
    return;
  } catch {}
  const body = `# ${metadata.displayName}\n\n${metadata.description}\n\n## Installation\n\nInstall via the WeCoded marketplace or directly from this repo.\n`;
  await fs.writeFile(p, body);
}

export function scanForSecrets(text, filePath) {
  const findings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const pat of SECRET_PATTERNS) {
      pat.regex.lastIndex = 0;
      let m;
      while ((m = pat.regex.exec(lines[i])) !== null) {
        findings.push({
          file: filePath,
          line: i + 1,
          patternName: pat.name,
          envHint: pat.envHint,
          excerpt: m[0].slice(0, 6) + '...',
          matched: m[0],
        });
      }
    }
  }
  return findings;
}

export async function buildPlugin({ manifest, workingRoot }) {
  const { pluginId, metadata, pieces } = manifest;
  const outDir = path.join(workingRoot, pluginId);
  await ensureDir(outDir);

  const hookPieces = [];
  const mcpPieces = [];
  for (const piece of pieces) {
    if (piece.type === 'hook') {
      hookPieces.push(piece);
      continue;
    }
    if (piece.type === 'mcp') {
      mcpPieces.push(piece);
      continue;
    }
    if (piece.sourcePath && piece.targetPath) {
      await copyFile(piece.sourcePath, path.join(outDir, piece.targetPath));
    }
  }

  const pluginJson = generatePluginJson(pluginId, metadata);
  await fs.writeFile(path.join(outDir, 'plugin.json'), JSON.stringify(pluginJson, null, 2));
  await writeHooksManifest(outDir, hookPieces);
  await writeMcpStub(outDir, mcpPieces);
  await writeReadmeIfMissing(outDir, metadata);

  return { status: 'ok', outDir };
}

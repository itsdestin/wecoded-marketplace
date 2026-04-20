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

function isMarkdownLike(filePath) {
  return /\.(md|markdown|txt)$/i.test(filePath);
}

function sanitizeText(text, filePath) {
  const findings = [];
  let out = text;
  for (const pat of SECRET_PATTERNS) {
    pat.regex.lastIndex = 0;
    out = out.replace(pat.regex, (match) => {
      findings.push({ patternName: pat.name, envHint: pat.envHint, excerpt: match.slice(0, 6) + '...' });
      return isMarkdownLike(filePath) ? `<YOUR_${pat.envHint}_HERE>` : `process.env.${pat.envHint}`;
    });
  }
  return { text: out, findings };
}

function descriptionForEnv(name) {
  const table = {
    GITHUB_TOKEN: 'A GitHub personal access token. Create one at https://github.com/settings/tokens with the scopes this plugin needs.',
    AWS_ACCESS_KEY_ID: 'An AWS access key ID for the account this plugin operates on.',
    OPENAI_API_KEY: 'An OpenAI API key from https://platform.openai.com/api-keys.',
    ANTHROPIC_API_KEY: 'An Anthropic API key from https://console.anthropic.com/settings/keys.',
  };
  return table[name] || `A value for ${name}. See the plugin author's documentation for details.`;
}

async function generateSetupMd(outDir, envVars) {
  if (envVars.length === 0) return;
  const lines = ['# Setup', '', 'This plugin needs the following environment variables to work:', ''];
  for (const v of envVars) {
    lines.push(`## \`${v}\``);
    lines.push('');
    lines.push(descriptionForEnv(v));
    lines.push('');
    lines.push(`Set it by running: \`export ${v}=your-value-here\` (on macOS/Linux) or \`setx ${v} your-value-here\` (on Windows).`);
    lines.push('');
  }
  lines.push('If a required value is not set, the plugin will exit with an error telling you which variable is missing.');
  await fs.writeFile(path.join(outDir, 'SETUP.md'), lines.join('\n'));
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

export async function buildPlugin({ manifest, workingRoot, sanitize = false }) {
  const { pluginId, metadata, pieces } = manifest;
  const outDir = path.join(workingRoot, pluginId);
  await ensureDir(outDir);

  const hookPieces = [];
  const mcpPieces = [];
  const allFindings = [];
  const unsanitizedFindings = [];

  for (const piece of pieces) {
    if (piece.type === 'hook') { hookPieces.push(piece); continue; }
    if (piece.type === 'mcp') { mcpPieces.push(piece); continue; }
    if (!piece.sourcePath || !piece.targetPath) continue;

    const destPath = path.join(outDir, piece.targetPath);
    await ensureDir(path.dirname(destPath));
    const text = await fs.readFile(piece.sourcePath, 'utf8');

    if (sanitize) {
      // Rewrite secrets to env-var reads (JS) or placeholders (markdown) before writing
      const { text: cleaned, findings } = sanitizeText(text, piece.sourcePath);
      for (const f of findings) allFindings.push({ ...f, file: piece.targetPath });
      await fs.writeFile(destPath, cleaned);
    } else {
      // Scan only — report findings without modifying content
      const scan = scanForSecrets(text, piece.sourcePath);
      for (const f of scan) unsanitizedFindings.push({ ...f, file: piece.targetPath });
      await fs.writeFile(destPath, text);
    }
  }

  const pluginJson = generatePluginJson(pluginId, metadata);
  await fs.writeFile(path.join(outDir, 'plugin.json'), JSON.stringify(pluginJson, null, 2));
  await writeHooksManifest(outDir, hookPieces);
  await writeMcpStub(outDir, mcpPieces);
  await writeReadmeIfMissing(outDir, metadata);

  // Generate SETUP.md only when sanitizing and secrets were found
  const envVars = [...new Set(allFindings.map(f => f.envHint))];
  await generateSetupMd(outDir, envVars);

  return { status: 'ok', outDir, sanitizedFindings: allFindings, unsanitizedFindings };
}

async function runCli() {
  try {
    const input = JSON.parse(process.argv[2] || '{}');
    const result = await buildPlugin(input);
    process.stdout.write(JSON.stringify(result));
  } catch (err) {
    process.stderr.write(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runCli();
}

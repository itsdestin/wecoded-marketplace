import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildPlugin } from '../scripts/build-plugin.js';
import { scanForSecrets } from '../scripts/build-plugin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, 'fixtures/source-skill/SKILL.md');

let tmp;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'wmp-build-'));
});

test('buildPlugin creates working dir and copies skill piece', async () => {
  const manifest = {
    pluginId: 'my-plugin',
    metadata: {
      displayName: 'My Plugin',
      description: 'Test',
      author: { name: 'tester' },
      category: 'personal',
      tags: ['test'],
    },
    pieces: [
      { type: 'skill', sourcePath: SRC, targetPath: 'skills/demo-skill/SKILL.md', meta: { name: 'demo-skill' } },
    ],
  };
  const result = await buildPlugin({ manifest, workingRoot: tmp });
  assert.equal(result.status, 'ok');

  const copied = await fs.readFile(path.join(tmp, 'my-plugin', 'skills/demo-skill/SKILL.md'), 'utf8');
  assert.match(copied, /demo-skill/);
});

test('buildPlugin generates plugin.json from metadata', async () => {
  const manifest = {
    pluginId: 'my-plugin',
    metadata: {
      displayName: 'My Plugin',
      description: 'Test description',
      author: { name: 'tester' },
      category: 'personal',
      tags: ['one', 'two'],
    },
    pieces: [],
  };
  await buildPlugin({ manifest, workingRoot: tmp });
  const pkg = JSON.parse(await fs.readFile(path.join(tmp, 'my-plugin', 'plugin.json'), 'utf8'));
  assert.equal(pkg.name, 'my-plugin');
  assert.equal(pkg.version, '0.1.0');
  assert.equal(pkg.description, 'Test description');
  assert.deepEqual(pkg.keywords, ['one', 'two']);
});

test('buildPlugin generates hooks-manifest.json from hook pieces', async () => {
  const manifest = {
    pluginId: 'hooky',
    metadata: { displayName: 'Hooky', description: 'd', author: { name: 'x' }, category: 'personal' },
    pieces: [
      { type: 'hook', event: 'SessionStart', matcher: null, command: '~/scripts/on-start.sh', sourcePath: null },
    ],
  };
  await buildPlugin({ manifest, workingRoot: tmp });
  const hm = JSON.parse(await fs.readFile(path.join(tmp, 'hooky/hooks/hooks-manifest.json'), 'utf8'));
  assert.ok(hm.hooks.SessionStart);
  assert.equal(hm.hooks.SessionStart[0].hooks[0].command, '~/scripts/on-start.sh');
});

test('buildPlugin generates .mcp.json stub for declared MCP deps', async () => {
  const manifest = {
    pluginId: 'mcpy',
    metadata: { displayName: 'Mcpy', description: 'd', author: { name: 'x' }, category: 'personal' },
    pieces: [
      { type: 'mcp', name: 'gmail', config: { command: 'npx', args: ['-y', '@mcp/gmail'] } },
    ],
  };
  await buildPlugin({ manifest, workingRoot: tmp });
  const mcp = JSON.parse(await fs.readFile(path.join(tmp, 'mcpy/.mcp.json'), 'utf8'));
  assert.ok(mcp.mcpServers.gmail);
  assert.equal(mcp.mcpServers.gmail.command, 'npx');
});

test('buildPlugin templates a README when none is provided', async () => {
  const manifest = {
    pluginId: 'readmeless',
    metadata: { displayName: 'Readme-less', description: 'A test plugin.', author: { name: 'x' }, category: 'personal' },
    pieces: [],
  };
  await buildPlugin({ manifest, workingRoot: tmp });
  const readme = await fs.readFile(path.join(tmp, 'readmeless/README.md'), 'utf8');
  assert.match(readme, /Readme-less/);
  assert.match(readme, /A test plugin/);
});

test('scanForSecrets finds Anthropic keys', async () => {
  const p = path.join(__dirname, 'fixtures/plugin-with-secrets/scripts/fetch.js');
  const text = await fs.readFile(p, 'utf8');
  const findings = scanForSecrets(text, p);
  const patterns = findings.map(f => f.patternName).sort();
  assert.ok(patterns.includes('anthropic-api-key'));
  assert.ok(patterns.includes('github-token'));
});

test('scanForSecrets returns file + line for each finding', async () => {
  const p = path.join(__dirname, 'fixtures/plugin-with-secrets/scripts/fetch.js');
  const text = await fs.readFile(p, 'utf8');
  const findings = scanForSecrets(text, p);
  for (const f of findings) {
    assert.equal(f.file, p);
    assert.ok(f.line > 0);
    assert.ok(f.excerpt.length > 0);
  }
});

test('buildPlugin with sanitize replaces JS secrets with env reads', async () => {
  const srcDir = path.join(__dirname, 'fixtures/plugin-with-secrets');
  const manifest = {
    pluginId: 'sanity',
    metadata: { displayName: 'Sanity', description: 'd', author: { name: 'x' }, category: 'personal' },
    pieces: [
      { type: 'skill', sourcePath: path.join(srcDir, 'scripts/fetch.js'), targetPath: 'scripts/fetch.js' },
    ],
  };
  const result = await buildPlugin({ manifest, workingRoot: tmp, sanitize: true });
  assert.equal(result.status, 'ok');
  assert.ok(result.sanitizedFindings.length >= 2);

  const copied = await fs.readFile(path.join(tmp, 'sanity/scripts/fetch.js'), 'utf8');
  assert.doesNotMatch(copied, /sk-ant-api03/);
  assert.doesNotMatch(copied, /ghp_Example/);
  assert.match(copied, /process\.env\.ANTHROPIC_API_KEY/);
  assert.match(copied, /process\.env\.GITHUB_TOKEN/);
});

test('buildPlugin with sanitize generates SETUP.md listing env vars', async () => {
  const srcDir = path.join(__dirname, 'fixtures/plugin-with-secrets');
  const manifest = {
    pluginId: 'setup-md',
    metadata: { displayName: 'Setup MD', description: 'd', author: { name: 'x' }, category: 'personal' },
    pieces: [
      { type: 'skill', sourcePath: path.join(srcDir, 'scripts/fetch.js'), targetPath: 'scripts/fetch.js' },
    ],
  };
  await buildPlugin({ manifest, workingRoot: tmp, sanitize: true });
  const setup = await fs.readFile(path.join(tmp, 'setup-md/SETUP.md'), 'utf8');
  assert.match(setup, /ANTHROPIC_API_KEY/);
  assert.match(setup, /GITHUB_TOKEN/);
});

test('buildPlugin without sanitize returns findings but leaves content intact', async () => {
  const srcDir = path.join(__dirname, 'fixtures/plugin-with-secrets');
  const manifest = {
    pluginId: 'raw',
    metadata: { displayName: 'Raw', description: 'd', author: { name: 'x' }, category: 'personal' },
    pieces: [
      { type: 'skill', sourcePath: path.join(srcDir, 'scripts/fetch.js'), targetPath: 'scripts/fetch.js' },
    ],
  };
  const result = await buildPlugin({ manifest, workingRoot: tmp, sanitize: false });
  assert.ok(result.unsanitizedFindings.length >= 2);
  const copied = await fs.readFile(path.join(tmp, 'raw/scripts/fetch.js'), 'utf8');
  assert.match(copied, /sk-ant-api03/);
});

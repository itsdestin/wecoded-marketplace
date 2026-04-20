import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildPlugin } from '../scripts/build-plugin.js';

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

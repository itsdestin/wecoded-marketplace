import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preflightLocal } from '../scripts/preflight.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VALID = path.join(__dirname, 'fixtures/valid-plugin-tree');
const SECRETS = path.join(__dirname, 'fixtures/plugin-with-secrets');

test('preflightLocal passes on a valid plugin tree', async () => {
  const result = await preflightLocal({ pluginDir: VALID, metadata: {
    displayName: 'Valid', description: 'd', author: { name: 't' }, category: 'personal', tags: ['x'],
  }});
  const fails = result.checks.filter(c => c.status === 'fail');
  assert.equal(fails.length, 0);
  assert.equal(result.pass, true);
});

test('preflightLocal fails when required metadata is missing', async () => {
  const result = await preflightLocal({ pluginDir: VALID, metadata: {
    displayName: '', description: '', author: {}, category: '', tags: [],
  }});
  assert.equal(result.pass, false);
  const names = result.checks.filter(c => c.status === 'fail').map(c => c.name);
  assert.ok(names.includes('required-fields'));
});

test('preflightLocal fails when secrets remain in source', async () => {
  const result = await preflightLocal({ pluginDir: SECRETS, metadata: {
    displayName: 'X', description: 'd', author: { name: 't' }, category: 'personal', tags: ['x'],
  }});
  assert.equal(result.pass, false);
  assert.ok(result.checks.find(c => c.name === 'secret-scan' && c.status === 'fail'));
});

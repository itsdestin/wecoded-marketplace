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

import { preflightNetwork } from '../scripts/preflight.js';

function fakeFetch(responses) {
  return async (url) => {
    const key = Object.keys(responses).find(k => url.includes(k));
    if (!key) throw new Error(`Unexpected fetch: ${url}`);
    return { ok: true, text: async () => responses[key] };
  };
}

test('preflightNetwork passes with unique plugin ID and valid enums', async () => {
  const fetchImpl = fakeFetch({
    'marketplace.json': JSON.stringify({ plugins: [{ name: 'other-plugin' }] }),
    'schema.js': 'export const CATEGORIES = ["personal","productivity","development"]; export const LIFE_AREAS = ["personal","work"]; export const AUDIENCES = ["general","developer"];',
  });
  const result = await preflightNetwork({
    pluginId: 'new-plugin',
    metadata: { category: 'personal', lifeArea: ['personal'], audience: 'general', tags: [] },
    fetchImpl,
  });
  assert.equal(result.pass, true);
});

test('preflightNetwork fails on duplicate plugin ID', async () => {
  const fetchImpl = fakeFetch({
    'marketplace.json': JSON.stringify({ plugins: [{ name: 'existing' }] }),
    'schema.js': 'export const CATEGORIES = ["personal"]; export const LIFE_AREAS = []; export const AUDIENCES = [];',
  });
  const result = await preflightNetwork({
    pluginId: 'existing',
    metadata: { category: 'personal', lifeArea: [], audience: '', tags: [] },
    fetchImpl,
  });
  assert.equal(result.pass, false);
  assert.ok(result.checks.find(c => c.name === 'id-uniqueness' && c.status === 'fail'));
});

test('preflightNetwork fails on invalid category enum', async () => {
  const fetchImpl = fakeFetch({
    'marketplace.json': JSON.stringify({ plugins: [] }),
    'schema.js': 'export const CATEGORIES = ["personal"]; export const LIFE_AREAS = []; export const AUDIENCES = [];',
  });
  const result = await preflightNetwork({
    pluginId: 'x',
    metadata: { category: 'madeup', lifeArea: [], audience: '', tags: [] },
    fetchImpl,
  });
  assert.equal(result.pass, false);
  assert.ok(result.checks.find(c => c.name === 'category-enum' && c.status === 'fail'));
});

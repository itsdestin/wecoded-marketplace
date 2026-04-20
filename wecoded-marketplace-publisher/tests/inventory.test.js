import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventorySkills } from '../scripts/inventory.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_HOME = path.join(__dirname, 'fixtures/home-with-skills');

test('inventorySkills finds user-level skills', async () => {
  const results = await inventorySkills({ home: FIXTURE_HOME });
  const names = results.map(r => r.name).sort();
  assert.deepEqual(names, ['cool-subskill', 'summarize-emails']);
});

test('inventorySkills captures frontmatter description', async () => {
  const results = await inventorySkills({ home: FIXTURE_HOME });
  const emailSkill = results.find(r => r.name === 'summarize-emails');
  assert.ok(emailSkill);
  assert.match(emailSkill.description, /Gmail MCP/);
});

test('inventorySkills captures path and type', async () => {
  const results = await inventorySkills({ home: FIXTURE_HOME });
  const emailSkill = results.find(r => r.name === 'summarize-emails');
  assert.equal(emailSkill.type, 'skill');
  assert.ok(emailSkill.path.endsWith('SKILL.md'));
});

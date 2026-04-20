import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inventorySkills, inventoryHooks, inventoryMcpServers, inventoryCommands, inventoryAgents } from '../scripts/inventory.js';
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

const ALL_TYPES_HOME = path.join(__dirname, 'fixtures/home-with-all-types');

test('inventoryHooks parses settings.json hooks block', async () => {
  const hooks = await inventoryHooks({ home: ALL_TYPES_HOME });
  assert.equal(hooks.length, 2);
  const events = hooks.map(h => h.event).sort();
  assert.deepEqual(events, ['PreToolUse', 'SessionStart']);
  const start = hooks.find(h => h.event === 'SessionStart');
  assert.equal(start.command, '~/scripts/on-start.sh');
});

test('inventoryMcpServers reads ~/.claude.json', async () => {
  const mcps = await inventoryMcpServers({ home: ALL_TYPES_HOME, cwd: ALL_TYPES_HOME });
  assert.equal(mcps.length, 1);
  assert.equal(mcps[0].name, 'gmail');
  assert.equal(mcps[0].type, 'mcp');
  assert.equal(mcps[0].config.command, 'npx');
});

test('inventoryCommands finds user-level slash commands', async () => {
  const cmds = await inventoryCommands({ home: ALL_TYPES_HOME, cwd: ALL_TYPES_HOME });
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].name, 'my-report');
  assert.equal(cmds[0].type, 'command');
});

test('inventoryAgents finds user-level agent files', async () => {
  const agents = await inventoryAgents({ home: ALL_TYPES_HOME, cwd: ALL_TYPES_HOME });
  assert.equal(agents.length, 1);
  assert.equal(agents[0].name, 'weekly-reviewer');
  assert.equal(agents[0].type, 'agent');
});

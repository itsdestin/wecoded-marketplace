import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const skillUrl = new URL('../skills/page-builder/SKILL.md', import.meta.url);
const iconsUrl = new URL('../skills/page-builder/reference/icons.md', import.meta.url);

test('page creation requires purpose-designed custom artwork rather than only a named stock icon', () => {
  const skill = readFileSync(skillUrl, 'utf8');
  assert.match(skill, /\*\*Design the Page.s icon\*\*/);
  assert.match(skill, /customIcon/);
  assert.match(skill, /reference\/icons\.md/);
});

test('the icon reference provides one backward-compatible manifest example with path-only artwork', () => {
  assert.ok(existsSync(iconsUrl), 'the custom-icon format has a reference beside the skill');
  const reference = readFileSync(iconsUrl, 'utf8');
  const examples = [...reference.matchAll(/```json\s*([\s\S]*?)```/g)];
  assert.equal(examples.length, 1, 'one complete manifest example is the authoring reference');
  const manifest = JSON.parse(examples[0][1]);
  assert.equal(typeof manifest.icon, 'string', 'older apps retain a named fallback');
  assert.equal(manifest.customIcon.version, 1);
  assert.ok(manifest.customIcon.paths.length > 0 && manifest.customIcon.paths.length <= 12);
  let total = 0;
  for (const path of manifest.customIcon.paths) {
    assert.equal(typeof path, 'string');
    assert.match(path, /^[Mm]/);
    assert.ok(path.length <= 2048);
    assert.doesNotMatch(path, /[<>]|https?:|javascript:|style=|onload=/i);
    total += path.length;
  }
  assert.ok(total <= 8192);
});

import fs from 'node:fs/promises';
import path from 'node:path';

function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const body = match[1];
  const out = {};
  for (const line of body.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

async function readSkillMd(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const fm = parseFrontmatter(text);
  return {
    path: filePath,
    type: 'skill',
    name: fm.name || path.basename(path.dirname(filePath)),
    description: fm.description || '',
    content: text,
  };
}

async function walkForSkillMd(root, maxDepth = 6) {
  const out = [];
  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && entry.name === 'SKILL.md') {
        out.push(full);
      }
    }
  }
  await walk(root, 0);
  return out;
}

export async function inventorySkills({ home }) {
  const roots = [
    path.join(home, '.claude', 'skills'),
    path.join(home, '.claude', 'plugins'),
  ];
  const found = [];
  for (const root of roots) {
    const skillFiles = await walkForSkillMd(root);
    for (const file of skillFiles) {
      found.push(await readSkillMd(file));
    }
  }
  return found;
}

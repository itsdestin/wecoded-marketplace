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

export async function inventoryHooks({ home }) {
  const settingsPath = path.join(home, '.claude', 'settings.json');
  let settings;
  try {
    settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
  } catch {
    return [];
  }
  const hooks = settings.hooks || {};
  const out = [];
  for (const [event, matchers] of Object.entries(hooks)) {
    for (const matcher of matchers) {
      for (const h of matcher.hooks || []) {
        if (h.type === 'command' && h.command) {
          out.push({
            type: 'hook',
            event,
            matcher: matcher.matcher || null,
            command: h.command,
            path: h.command,
          });
        }
      }
    }
  }
  return out;
}

async function readJsonOrNull(p) {
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

export async function inventoryMcpServers({ home, cwd }) {
  const sources = [
    path.join(home, '.claude.json'),
    path.join(cwd, '.mcp.json'),
  ];
  const seen = new Map();
  for (const src of sources) {
    const data = await readJsonOrNull(src);
    if (!data) continue;
    const servers = data.mcpServers || {};
    for (const [name, config] of Object.entries(servers)) {
      if (!seen.has(name)) {
        seen.set(name, { type: 'mcp', name, config, path: src });
      }
    }
  }
  return [...seen.values()];
}

async function readMarkdownWithFrontmatter(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  const fm = parseFrontmatter(text);
  return { path: filePath, name: fm.name || path.basename(filePath, '.md'), description: fm.description || '', content: text };
}

async function listMarkdownFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isFile() && e.name.endsWith('.md')).map(e => path.join(dir, e.name));
  } catch {
    return [];
  }
}

export async function inventoryCommands({ home, cwd }) {
  // Deduplicate dirs by resolved path so home===cwd doesn't double-count
  const rawDirs = [
    path.join(home, '.claude', 'commands'),
    path.join(cwd, '.claude', 'commands'),
  ];
  const dirs = [...new Set(rawDirs.map(d => path.resolve(d)))];
  const out = [];
  for (const dir of dirs) {
    for (const file of await listMarkdownFiles(dir)) {
      const base = await readMarkdownWithFrontmatter(file);
      out.push({ ...base, type: 'command' });
    }
  }
  return out;
}

export async function inventoryAgents({ home, cwd }) {
  // Deduplicate dirs by resolved path so home===cwd doesn't double-count
  const rawDirs = [
    path.join(home, '.claude', 'agents'),
    path.join(cwd, '.claude', 'agents'),
  ];
  const dirs = [...new Set(rawDirs.map(d => path.resolve(d)))];
  const out = [];
  for (const dir of dirs) {
    for (const file of await listMarkdownFiles(dir)) {
      const base = await readMarkdownWithFrontmatter(file);
      out.push({ ...base, type: 'agent' });
    }
  }
  return out;
}

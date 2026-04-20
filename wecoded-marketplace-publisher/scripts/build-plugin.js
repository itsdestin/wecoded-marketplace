import fs from 'node:fs/promises';
import path from 'node:path';

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

export async function buildPlugin({ manifest, workingRoot }) {
  const { pluginId, metadata, pieces } = manifest;
  const outDir = path.join(workingRoot, pluginId);
  await ensureDir(outDir);

  for (const piece of pieces) {
    if (piece.sourcePath && piece.targetPath && piece.type !== 'mcp' && piece.type !== 'hook') {
      await copyFile(piece.sourcePath, path.join(outDir, piece.targetPath));
    }
  }

  const pluginJson = generatePluginJson(pluginId, metadata);
  await fs.writeFile(path.join(outDir, 'plugin.json'), JSON.stringify(pluginJson, null, 2));

  return { status: 'ok', outDir };
}

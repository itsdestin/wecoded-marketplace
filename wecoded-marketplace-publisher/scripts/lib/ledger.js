import fs from 'node:fs/promises';
import path from 'node:path';

function ledgerPath(configDir) {
  return path.join(configDir, 'published.json');
}

export async function readLedger({ configDir }) {
  const p = ledgerPath(configDir);
  try {
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return { version: 1, entries: [] };
  }
}

export async function writeLedgerEntry({ configDir, entry }) {
  const ledger = await readLedger({ configDir });
  const existing = ledger.entries.find(e => e.pluginId === entry.pluginId);
  if (existing) {
    Object.assign(existing, entry);
  } else {
    ledger.entries.push(entry);
  }
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(ledgerPath(configDir), JSON.stringify(ledger, null, 2));
  return ledger;
}

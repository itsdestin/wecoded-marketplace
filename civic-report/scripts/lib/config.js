import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Config lives under ~/.claude/plugins/civic-report/config.local.json so it
// stays machine-local (matches the destinclaude toolkit's config.local.json
// convention — not synced).
export function defaultConfigDir() {
  return join(homedir(), ".claude", "plugins", "civic-report");
}

export function configPath(dir = defaultConfigDir()) {
  return join(dir, "config.local.json");
}

export function readConfig(dir = defaultConfigDir()) {
  const p = configPath(dir);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

export function writeConfig(obj, dir = defaultConfigDir()) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(dir), JSON.stringify(obj, null, 2) + "\n");
}

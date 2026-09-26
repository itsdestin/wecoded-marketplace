// Builds the "plugin with hardcoded secrets" fixture in a temp folder at test time.
// WHY not a committed file: the marketplace's PR check (validate-plugin-pr.yml) greps
// every changed plugin for key-shaped strings, and a committed fake key failed it on
// every edit to this plugin. Assembling the keys from pieces keeps the repo free of
// key-shaped text, so that check stays strict with no exemptions, while the file the
// scanner reads still holds the real-looking keys it must catch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FAKE_ANTHROPIC = 'sk-' + 'ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890ABCDEFGHIJKLMN';
const FAKE_GITHUB = 'ghp' + '_ExampleGitHubPersonalAccessToken123456789012345';

export const SECRETS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wmp-secrets-'));
export const SECRETS_FILE = path.join(SECRETS_DIR, 'scripts', 'fetch.js');

fs.mkdirSync(path.dirname(SECRETS_FILE), { recursive: true });
fs.writeFileSync(
  SECRETS_FILE,
  `const apiKey = '${FAKE_ANTHROPIC}';\n` +
  `const ghToken = '${FAKE_GITHUB}';\n` +
  `export { apiKey, ghToken };\n`,
);

# DestinCode Marketplace Registry

Central registry for the DestinCode skill marketplace. Contains 151 entries: 29 DestinClaude-specific skills and 122 auto-imported from Anthropic's official Claude Code plugin registry.

Design doc: `~/destincode/docs/plans/plugin-marketplace-design (04-06-2026).md`

## Structure

```
index.json                 # Flat array of all registry entries (151 entries)
curated-defaults.json      # IDs of skills shown by default in the marketplace
featured.json              # Featured skill highlights with taglines
stats.json                 # Usage stats (rebuilt daily by CI)
overrides/                 # Per-plugin custom metadata (merged on sync)
scripts/
  sync.js                  # Imports plugins from upstream Anthropic registries
registry/
  prompts/                 # Individual prompt shortcut entries (*.json)
  plugins/                 # Individual plugin entries (*.json)
```

## Upstream Sync

`scripts/sync.js` imports all plugins from Anthropic's official marketplace (`claude-plugins-official`, 123 plugins). Each entry gets a `sourceMarketplace` label and source type info for the installer.

```bash
# Sync from a local clone of the marketplace repo
node scripts/sync.js --local ~/.claude/plugins/marketplaces/claude-plugins-official

# Sync from GitHub (no local clone needed)
node scripts/sync.js
```

The sync preserves all DestinClaude entries (identified by `sourceMarketplace: "destinclaude"`) and appends upstream entries alphabetically. Duplicate IDs are skipped.

### Overrides

Drop a JSON file in `overrides/<plugin-id>.json` to customize any upstream entry:

```json
{
  "displayName": "Playwright Browser",
  "description": "Control a real browser from Claude",
  "category": "development",
  "tags": ["browser", "testing"]
}
```

Override fields merge on top of upstream data. The `id` and `sourceMarketplace` fields cannot be overridden.

## Registry Entry Format

Each entry in `index.json`:

```json
{
  "id": "skill-id",
  "type": "prompt | plugin",
  "displayName": "Human-Readable Name",
  "description": "One-line description",
  "category": "personal | work | development | security | testing | ...",
  "author": "@handle or Anthropic",
  "version": "1.0.0",
  "publishedAt": "2026-04-06T00:00:00Z",
  "sourceMarketplace": "destinclaude | claude-plugins-official",
  "sourceType": "prompt | local | url | git-subdir",
  "sourceRef": "./plugins/code-review | https://github.com/user/repo.git",
  "repoUrl": "https://github.com/owner/repo or null",
  "tags": []
}
```

## Adding a DestinClaude Entry

1. Create a JSON file in `registry/prompts/` or `registry/plugins/`.
2. Open a pull request. CI rebuilds `index.json`, or trigger manually.

## How It Works

- The marketplace UI fetches `index.json` to populate browse and search results.
- `curated-defaults.json` determines which skills appear pre-selected for new users.
- `featured.json` drives the featured section at the top of the marketplace.
- `stats.json` provides download/usage counts (populated by CI).
- Plugin install is handled by the app (PluginInstaller) -- not this repo.

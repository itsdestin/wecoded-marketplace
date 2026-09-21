# YouCoded Marketplace

The skill store for [YouCoded](https://github.com/itsdestin/youcoded). Browse and install skills from within the app.

Contains 339 entries, 302 of them live: 13 YouCoded plugins and 289 imported from Anthropic's official Claude Code plugin registry. (The rest are deprecated — kept as rows so an already-installed copy still resolves, but hidden from the store.)

## How It Works

- The YouCoded app fetches `index.json` to populate the skill marketplace
- `curated-defaults.json` determines which skills appear pre-selected for new users
- `featured.json` drives the featured section at the top of the marketplace
- `stats.json` provides usage counts (a committed snapshot — nothing rebuilds it automatically; live counts come from the Worker's `/stats`)
- Plugin installation is handled by the app — not this repo

## Structure

```
index.json                 # All registry entries (339 entries, 302 live)
marketplace.json           # YouCoded/community entries (source for the sync)
.claude-plugin/
  marketplace.json         # Generated mirror — the path Claude Code actually reads
curated-defaults.json      # Default skills for new users
featured.json              # Featured skill highlights
stats.json                 # Usage stats (committed snapshot, not auto-rebuilt)
overrides/                 # Per-plugin custom metadata
scripts/
  sync.js                  # Imports plugins from upstream Anthropic registries
  mirror-cc-manifest.js    # Regenerates .claude-plugin/marketplace.json
```

`.claude-plugin/marketplace.json` is generated — never hand-edit it. Edit
`marketplace.json` at the root; CI regenerates the mirror on merge. Claude Code
loads a marketplace exclusively from `<installLocation>/.claude-plugin/marketplace.json`
with no fallback to the root copy, so a clone missing that file is unloadable.

## Upstream Sync

```bash
node scripts/sync.js                                    # Sync from GitHub
node scripts/sync.js --local <path-to-marketplace-clone> # Sync from local clone
```

Preserves all YouCoded entries, imports upstream alphabetically, applies `overrides/<id>.json` patches.

## Adding a Skill

1. Add your plugin as a directory in this repo and register it in `marketplace.json`
2. Open a pull request — CI validates it and rebuilds `index.json`

Or create a skill inside YouCoded and share it via the app's share feature.

**Changing an existing plugin? Raise its `plugin.json` version in the same PR.** YouCoded
upgrades an installed plugin only when the version rises, so a content change at the same
version reaches nobody who already has it. CI enforces this; see CONTRIBUTING.md.

### Maintainer note: branch protection

`bundled-version-bump` is a **required status check that nothing requires**. `master` has no
branch protection (verified 2026-09-20), so a red check does not block a merge — it only
annotates one. This is not hypothetical: PR #87 (2026-09-09) changed theme-builder's
`reference/mascots.md` without a version bump, the check failed, and the PR merged. The
guidance reached no existing install and the failure was invisible after the fact.

Until branch protection requires it, treat a red `bundled-version-bump` as a merge blocker by
convention, and consider adding `master` protection with that job required.

## Registry Entry Format

```json
{
  "id": "skill-id",
  "type": "prompt | plugin",
  "displayName": "Human-Readable Name",
  "description": "One-line description",
  "category": "personal | work | development | ...",
  "author": "@handle",
  "sourceMarketplace": "youcoded | anthropic",
  "sourceType": "prompt | local | url | git-subdir",
  "tags": []
}
```

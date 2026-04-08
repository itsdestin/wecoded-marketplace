# Unified Marketplace Plan — Revised

**Date:** 2026-04-08
**Context:** Revised plan for unifying DestinCode's skill marketplace, theme marketplace, and DestinClaude toolkit layer system into a single marketplace. This supersedes the research report (`unified-marketplace-research-report.md`) with concrete architecture decisions and an ordered implementation plan.

---

## Current State (as of 2026-04-08)

### What exists today

**Three separate systems** handle installable content in the DestinCode ecosystem:

1. **Skill Marketplace** — `Marketplace.tsx`, 205 lines. Full-screen modal with search, type/category filter pills, sort, 2-column card grid. Data fetched from `itsdestin/destincode-marketplace/index.json` (151 entries: 29 DestinClaude + 122 Anthropic). Backed by `skill-provider.ts` (desktop) and `LocalSkillProvider.kt` (Android).

2. **Theme Marketplace** — `ThemeMarketplace.tsx`, 227 lines. Separate full-screen modal, nearly identical layout. Data fetched from `itsdestin/destinclaude-themes/registry/theme-registry.json` (3 themes). Has live preview, full publish flow (fork → PR → CI). Desktop only — no Android bridge messages.

3. **DestinClaude Toolkit** — Three layers (Core/Life/Productivity) installed via conversational setup wizard. Git-based updates via `/update`. Not integrated with either marketplace.

### Content breakdown

| Source | Prompts | Plugins | Themes | Total |
|--------|---------|---------|--------|-------|
| DestinClaude | 16 | 13 | — | 29 |
| Anthropic | 0 | 122 | — | 122 |
| Community themes | — | — | 3 | 3 |
| **Total** | **16** | **135** | **3** | **154** |

Of the 122 Anthropic plugins: 47 are `local` (code bundled in Anthropic's repo), 61 are `url` (external GitHub repos), 14 are `git-subdir` (subdirectory of an external repo). For `url` and `git-subdir`, the actual code download goes directly from the author's repo to the user's machine — Anthropic's repo is just the catalog.

### What's broken or missing

- **No update detection.** `sync.js` stamps every Anthropic entry with `"1.0.0"` and re-stamps `publishedAt` on every run. No SHA pinning, no version comparison. Anthropic's `marketplace.json` includes SHAs for external plugins — `sync.js` throws them away.
- **Plugin install doesn't work on Android.** `LocalSkillProvider.install()` throws `"Plugin installation from marketplace not yet implemented"` for non-prompt entries. The `PluginInstaller.kt` class exists and handles all source types — it's just never called.
- **Desktop doesn't reload after install.** Android sends `/reload-plugins\r` to the PTY after install. Desktop doesn't — the plugin appears as "installed" in UI but Claude Code doesn't discover it until the next session.
- **No skill publish flow.** `skill-provider.ts` has `publish()` that throws "not yet implemented." Theme publishing is fully implemented.
- **Theme marketplace inaccessible on Android.** No `theme:marketplace:*` bridge messages in `SessionService.kt`. The React UI exists (shared) but has no backend on Android.
- **Custom theme assets don't work on Android.** `theme-asset://` is an Electron custom protocol with no WebView equivalent.
- **Zero marketplace installs in the wild.** `destincode-skills.json` has no `installed_plugins` section on Destin's machine. The marketplace cache directory is empty. The dual-registry problem (DestinCode's tracking vs Claude Code's `installed_plugins.json`) is theoretical.
- **`sync.js` doesn't detect upstream removals.** If Anthropic delists a plugin, the entry stays in `index.json` as an orphan.
- **No community skill contributions.** The marketplace repo has no structure for hosting plugin source code or accepting PRs with new plugins.

---

## Architecture Decisions

### 1. No intermediate package directory

**Decision:** Install artifacts where the runtime expects them. Track everything in a manifest.

- Plugins install to `~/.claude/plugins/<id>/` (where Claude Code discovers them)
- Themes install to `~/.claude/destinclaude-themes/<slug>/` (where the theme system expects them)
- A single `~/.claude/destincode-installed.json` manifest tracks what the marketplace installed, with version, source, and component paths

**Multi-type bundles** (e.g., a plugin + matching theme, or a statusbar widget + hook) install each component to its native location and group them under one package ID in the manifest:

```jsonc
// ~/.claude/destincode-installed.json
{
  "version": 2,
  "packages": {
    "study-timer": {
      "version": "1.2.0",
      "installedAt": "2026-04-08T...",
      "source": "marketplace",
      "components": [
        { "type": "plugin", "path": "~/.claude/plugins/study-timer/" },
        { "type": "theme",  "path": "~/.claude/destinclaude-themes/study-timer/" }
      ]
    }
  }
}
```

**Rationale:** Avoids two-directory sync problem, avoids Windows symlink fragility (Developer Mode requirement, MSYS configuration, junction vs symlink ambiguity). The best package managers install artifacts where the runtime expects them and track metadata separately.

### 2. The marketplace repo becomes a plugin host

**Decision:** `itsdestin/destincode-marketplace` gains a `marketplace.json` and `plugins/` directory, mirroring Anthropic's repo structure.

Two sources populate the published index:
- **Your `marketplace.json`** — DestinCode plugins (bundled locally in `plugins/`), community plugins (bundled locally or `url` pointing to external repos)
- **Anthropic's `marketplace.json`** — imported via `sync.js`

Three badges, explicitly set per entry:
- **DestinCode** — `sourceMarketplace: "destincode"` — the toolkit and things Destin builds
- **Anthropic Marketplace** — `sourceMarketplace: "anthropic"` — auto-stamped by `sync.js` on import
- **Community** — `sourceMarketplace: "community"` or omitted — everything else

The badge reflects who made/curated it, not where the files live. A community plugin can be hosted locally in the repo's `plugins/` directory.

**New repo structure:**

```
destincode-marketplace/
├── marketplace.json              ← DestinCode/community catalog (Anthropic format)
├── plugins/                      ← Bundled local plugins (any badge)
│   ├── destinclaude-core/
│   ├── some-community-plugin/
│   └── ...
├── skills/
│   └── index.json                ← Generated: all skills + plugins from both sources
├── themes/
│   └── index.json                ← Generated: all themes
├── curated-defaults.json
├── featured.json
├── stats.json
├── overrides/                    ← Per-entry metadata patches
└── scripts/
    └── sync.js                   ← Reads BOTH catalogs, writes indexes
```

### 3. Config lives outside plugin directories

**Decision:** User configuration stored at `~/.claude/destincode-config/<id>.json`, separate from plugin files.

- Plugins discover config via convention: `~/.claude/destincode-config/<their-own-id>.json`
- Config schema declared in the marketplace entry's `configSchema` field — the app renders a settings form from it
- Updates can safely overwrite plugin directories without touching config
- Uninstall can optionally preserve config for reinstallation
- Backup/sync covers one directory for all package configs

**Exception:** Plugins imported from Anthropic that use Claude Code's native `${CLAUDE_PLUGIN_ROOT}/config.json` pattern keep their config where Claude Code puts it. The two config systems coexist, each handling its own entries.

### 4. Core stays as a plugin

**Decision:** DestinClaude Core remains a Claude Code plugin at `~/.claude/plugins/destinclaude/`. It is not merged into the app.

- Core is tracked in `destincode-installed.json` with `"removable": false`
- Core updates via its existing git-based `/update` command, not through the marketplace
- The marketplace shows Core as "Installed" with a "System" badge, no uninstall button
- User-facing Core skills (theme-builder, remote-setup) can optionally get marketplace listings marked "Included with DestinClaude Core" for discoverability

**Rationale:** Core's infrastructure (sync hooks, file guards, write protection) works when Claude Code runs from the terminal without the app open. Merging into the app would break that and require rewriting working shell scripts as TypeScript + Kotlin for zero user-visible benefit.

**Life and Productivity become real marketplace packages.** Optional, have external dependencies, install/remove independently. The setup wizard remains as a guided first-run experience, but the marketplace becomes the primary discovery/install path.

---

## Implementation Plan (ordered by dependency and risk)

### Phase 1: Fix the foundations (no UI changes)

#### 1a. Improve `sync.js`

The sync script needs to detect changes between runs instead of treating every run as a fresh import.

- Read both `marketplace.json` (local, DestinCode/community entries) and Anthropic's `marketplace.json` (fetched from GitHub)
- For existing entries: compare metadata/SHA against previous import. If changed, bump patch version (`1.0.0` → `1.0.1`), update `publishedAt`
- For new entries: add at `1.0.0`
- For removed upstream entries: flag with `"deprecated": true`, don't delete (users may have them installed)
- Preserve Anthropic's SHA for `url`/`git-subdir` entries (currently discarded)
- For `local` entries (with `--local` flag): compute content hash of plugin directory
- Auto-stamp `sourceMarketplace: "anthropic"` on all upstream imports
- Output to `skills/index.json` instead of `index.json`
- Don't re-stamp `publishedAt` when nothing changed — a sync run with no upstream changes should produce identical output

#### 1b. Create `marketplace.json` for DestinCode entries

Move the 29 existing DestinClaude entries from hand-edited `index.json` into a proper `marketplace.json` using Anthropic's catalog format. The 13 DestinClaude plugins that are actual plugins (not prompts) get `source` fields pointing to their install locations. The 16 prompts stay as prompt-type entries.

#### 1c. Restructure the registry repo

- `index.json` → `skills/index.json` (generated by `sync.js`)
- Create `themes/index.json` (imported from `destinclaude-themes` registry)
- Keep old `index.json` serving data during transition (old app versions)
- Update `curated-defaults.json` and `featured.json` to reference both sections

#### 1d. Define `destincode-installed.json` schema

Define the manifest format. Version 2 from the start.

### Phase 2: Unify the UI

#### 2a. Merge marketplace components

Replace `Marketplace.tsx` + `ThemeMarketplace.tsx` with a single `Marketplace.tsx` with a tab bar: "Skills" and "Themes." Each tab keeps its own filters and data source but shares the modal shell, search bar, grid layout, and loading/empty/error states.

- Skills tab: Type pills (All / Prompts / Plugins) + Category pills + Source pills (DestinCode / Anthropic / Community)
- Themes tab: Source pills (Official / Community) + Mode pills (Dark / Light) + Feature pills

Keep `SkillCard` and `ThemeCard` as separate components — they render fundamentally different content.

#### 2b. Add source filter to Skills tab

Requires `sourceMarketplace` badge from Phase 1 to be useful. Three pills: DestinCode, Anthropic, Community.

#### 2c. Add "update available" indicators

Compare `skills/index.json` version against installed version in `destincode-installed.json`. Show badge on cards where index version > installed version.

### Phase 3: Complete the install/update/uninstall lifecycle

#### 3a. Update the install flow

- Install to native locations (not an intermediate directory)
- Record in `destincode-installed.json` with version, source, component paths
- For multi-type bundles: install each component to its native location, track all under one package ID
- Desktop: send `/reload-plugins` after plugin install (fix the missing reload)
- Android: fix `LocalSkillProvider.install()` to delegate to `PluginInstaller` for plugin-type entries instead of throwing

#### 3b. Build update flow

- On marketplace open, compare installed versions against index
- "Update" button re-downloads from source, overwrites plugin/theme files
- Config is preserved (lives in `~/.claude/destincode-config/`, outside the blast radius)
- Update the version in `destincode-installed.json`

#### 3c. Build config form

- Read `configSchema` from marketplace entry
- Render a form in the detail view after install
- Write values to `~/.claude/destincode-config/<id>.json`
- Add IPC handler for both desktop and Android

### Phase 4: Publish and community

#### 4a. Build skill publish flow

Mirror the theme publish pattern:
- Fork `itsdestin/destincode-marketplace` via `gh` CLI
- Create branch `plugin/<id>`
- Upload plugin directory to `plugins/<id>/`
- Open PR
- Works on both desktop and Android (both have `gh`)

#### 4b. Add CI validation for skill PRs

- `plugins/<id>/.claude-plugin/plugin.json` must exist with required fields
- No `.env` files, no hardcoded secret patterns
- Size limit
- ID uniqueness
- On merge: auto-add entry to `marketplace.json`, rebuild `skills/index.json`

#### 4c. Wire up theme marketplace on Android

- Add `theme:marketplace:*` bridge messages to `SessionService.kt`
- For custom theme assets: serve via `LocalBridgeServer` HTTP on `:9901` instead of `theme-asset://` protocol. React shim rewrites asset URLs based on platform detection.

### Phase 5: Migration

#### 5a. Migrate existing installs

- Detect existing layer installs (symlinks in `~/.claude/plugins/` pointing into `destinclaude/`) and create entries in `destincode-installed.json`
- Convert `destincode-skills.json` `installed_plugins` (if it exists) to manifest entries
- One-time migration on first launch after update

#### 5b. Registry URL transition

- Keep old `index.json` at the root serving data for 6+ months
- New app reads from `skills/index.json`; falls back to `index.json` if missing
- Theme registry: old URL (`destinclaude-themes`) keeps serving; new URL (`destincode-marketplace/themes/index.json`) becomes primary

---

## Known Pitfalls

### Windows symlinks (avoided)

The original plan depended on symlinks from `destincode-packages/` to `~/.claude/plugins/`. This plan avoids that entirely by installing directly to native locations. However, the existing DestinClaude Core install uses symlinks from `~/.claude/plugins/destinclaude/` into the git repo. This works today because the setup wizard handles it, but it's a fragility point for Core.

### Claude Code native marketplace coexistence

Users can install plugins via Claude Code's `/plugin install` (writes to `installed_plugins.json`) or via DestinCode's marketplace (writes to `destincode-installed.json`). These can diverge.

**Approach:** On marketplace load, scan `~/.claude/plugins/` (filesystem truth). Show all installed plugins. Mark DestinCode-managed ones as "Managed" (can update/uninstall via marketplace). Mark others as "External" (visible, not manageable). This is how VS Code handles extensions installed via CLI vs GUI.

### The 47 `local` Anthropic plugins

These are the only plugins where Anthropic's repo is in the file transfer path. Installing one requires cloning `anthropics/claude-plugins-official` to the cache directory (`~/.claude/destincode-marketplace-cache/`). With the new repo structure, DestinCode `local` plugins also need a cache clone of `itsdestin/destincode-marketplace`. The installer needs to know which repo to clone based on `sourceMarketplace` (or a `sourceRepo` field in the index entry).

### `sync.js` entry removal

When Anthropic delists a plugin, `sync.js` currently leaves it as an orphan. The improved sync should detect removals and flag them with `"deprecated": true` rather than deleting, since users may have them installed.

### Android git dependency

Plugin installation on Android requires git (Termux package). Not all bootstrap tiers may include it. The marketplace should check for git availability before showing install buttons for plugin-type entries on Android. Prompt-type entries don't need git (stored as JSON).

### Hook relay overlap

The DestinCode app's `install-hooks.js` registers relay hooks for 11 event types. If a marketplace plugin also declares hooks for the same events, both fire (additive, not conflicting). The relay system's hardcoded event type list means new Claude Code hook types won't be relayed until `install-hooks.js` is updated.

### No pagination

The marketplace fetches all 151+ entries at once. Not blocking for launch, but the unified marketplace should be designed with lazy loading in mind for future growth.

### `overrides/` system

The directory exists, `sync.js` reads override files, but none currently exist. The intent is per-entry metadata patches (change descriptions, add tags, recategorize). Works as designed — just unused. Available for curating imported entries.

---

## What This Plan Does NOT Cover

- **Monetization / paid plugins.** Everything is free. No payment flow, no licensing.
- **Ratings / reviews.** `stats.json` exists but is empty. The sort-by-popular option has no backing data. Left for future work.
- **Plugin sandboxing / security.** Plugins run with full Claude Code permissions. CI validation catches obvious issues (secrets, size) but doesn't sandbox execution. Same as Anthropic's model.
- **Auto-updates.** Users see "update available" and click a button. No background auto-update. Intentional — users should know when their plugins change.
- **Dependency resolution.** The manifest schema supports `dependencies` (external tools like rclone) and `requires` (other packages), but there's no resolver. Install-time checks only.

---

## Implementation Priority

Ordered by user impact and minimum risk:

1. **Fix `sync.js`** — prerequisite for everything, zero risk (admin tooling only)
2. **Merge the marketplace UIs** — pure React, immediate UX win, works on both platforms
3. **Fix Android plugin install** — ~10 lines in `LocalSkillProvider.kt`, unblocks Android marketplace
4. **Add `destincode-installed.json`** — the tracking manifest, needed for updates
5. **Build the skill publish flow** — unlocks the Social AI pillar
6. **Wire up theme marketplace on Android** — completes cross-platform parity
7. **Config form and update flow** — polish

Each phase is independently shippable. You don't need to build the whole thing to get value from the first few steps.

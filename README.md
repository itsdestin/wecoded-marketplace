# DestinCode Marketplace Registry

Central registry for the DestinCode skill marketplace. The marketplace UI fetches skill metadata, curated defaults, and featured listings from this repo.

## Structure

```
index.json                 # Flat array of all registry entries (auto-rebuilt)
curated-defaults.json      # IDs of skills shown by default in the marketplace
featured.json              # Featured skill highlights with taglines
stats.json                 # Usage stats (rebuilt daily by CI)
registry/
  prompts/                 # Individual prompt shortcut entries (*.json)
  plugins/                 # Individual plugin entries (*.json)
.github/workflows/
  rebuild-stats.yml        # Daily CI job to rebuild index.json and stats.json
```

## Registry Entry Format

Each entry in `index.json` has the following shape:

```json
{
  "id": "skill-id",
  "type": "prompt | plugin",
  "displayName": "Human-Readable Name",
  "description": "One-line description",
  "prompt": "The slash command or natural language trigger",
  "category": "personal | work | development | admin",
  "author": "@handle",
  "authorGithub": "github-username",
  "version": "1.0.0",
  "publishedAt": "2026-04-05T00:00:00Z",
  "repoUrl": "https://github.com/owner/repo or null",
  "tags": []
}
```

## Adding a New Entry

1. Create a JSON file in `registry/prompts/` or `registry/plugins/` following the format above.
2. Open a pull request. The daily CI workflow will rebuild `index.json` automatically, or you can trigger the workflow manually.

## How It Works

- The marketplace UI fetches `index.json` to populate browse and search results.
- `curated-defaults.json` determines which skills appear pre-selected for new users.
- `featured.json` drives the featured section at the top of the marketplace.
- `stats.json` provides download/usage counts (populated by CI).

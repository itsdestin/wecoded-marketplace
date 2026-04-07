# Contributing Themes

## Submitting a Theme

1. Fork this repo
2. Create a new folder under `themes/` with your theme's slug (kebab-case, e.g. `my-cool-theme`)
3. Add a `manifest.json` and an `assets/` folder with any images/SVGs
4. Open a PR to this repo

### Theme Structure

```
themes/your-theme-slug/
├── manifest.json     # Required — theme definition
└── assets/           # Optional — wallpapers, patterns, icons, mascots
    ├── wallpaper.jpg
    ├── pattern.svg
    └── ...
```

### Manifest Requirements

Your `manifest.json` must include:
- `name` — display name
- `slug` — kebab-case identifier (must match folder name)
- `dark` — boolean (true for dark themes, false for light)
- `tokens` — all 15 color tokens (canvas, panel, inset, well, accent, on-accent, fg, fg-2, fg-dim, fg-muted, fg-faint, edge, edge-dim, scrollbar-thumb, scrollbar-hover)

Optional but recommended:
- `author` — your name or GitHub username
- `description` — a short description of the theme's vibe
- `created` — date string (YYYY-MM-DD)

### Rules

- **No external URLs** in `custom_css` — all assets must be bundled locally
- **No `@import`** rules in CSS
- **Total theme size** must be under 10MB
- **Slug must be unique** — check existing themes before submitting
- Theme must pass the CI validation checks automatically

### Publishing from DestinCode

You can also publish directly from the app:
1. Create a theme using the theme builder or customizer
2. Go to Settings → Themes → select your theme
3. Click "Publish to Marketplace"
4. The app will create the PR for you (requires `gh` CLI)

# DestinCode Themes

Community theme registry for [DestinCode](https://github.com/itsdestin/destincode).

Create custom themes with colors, wallpapers, particle effects, and mascot characters — then share them with the community. Browse and install themes from within the app via **Settings > Themes > Browse Theme Marketplace**.

## Available Themes

| Theme | Author | Mode | Features |
|-------|--------|------|----------|
| Golden Sunbreak | itsdestin | Dark | wallpaper, particles, glassmorphism, custom-icons, mascot |
| Kitty Pink Classic | claude | Light | pattern |
| Halftone Dimension | claude | Dark | gradient-bg, glassmorphism, particles, scanlines, custom-icons, mascot, custom-scrollbar |

## Creating a Theme

Use `/theme-builder` inside DestinCode to generate a theme pack from a description, or create one manually:

1. Create a folder at `themes/<your-slug>/`
2. Add a `manifest.json` with your colors and metadata
3. Optionally add assets (wallpapers, patterns, mascots, icons)
4. Submit a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full spec and validation requirements.

## Publishing from the App

In DestinCode: **Settings > Themes > Publish to Marketplace** — creates the PR automatically.

#!/usr/bin/env python3
"""
Rebuilds registry/theme-registry.json from all themes/*/manifest.json files.
Auto-detects features from manifest fields.
"""

import json
import os
from datetime import datetime, timezone

THEMES_DIR = "themes"
REGISTRY_PATH = "registry/theme-registry.json"
REPO_BASE = "https://raw.githubusercontent.com/itsdestin/destinclaude-themes/main"

# Official themes (source: destinclaude) — maintained by itsdestin
OFFICIAL_AUTHORS = {"itsdestin"}


def detect_features(manifest: dict) -> list[str]:
    """Auto-detect features from manifest fields."""
    features = []

    bg = manifest.get("background", {})
    if bg.get("type") == "image":
        features.append("wallpaper")
    if bg.get("panels-blur", 0) > 0:
        features.append("glassmorphism")

    effects = manifest.get("effects", {})
    if effects.get("particles") and effects["particles"] != "none":
        features.append("particles")

    if manifest.get("font"):
        features.append("custom-font")
    if manifest.get("icons"):
        features.append("custom-icons")
    if manifest.get("mascot"):
        features.append("mascot")
    if manifest.get("custom_css"):
        features.append("custom-css")

    return features


def collect_asset_urls(slug: str, theme_dir: str) -> dict[str, str]:
    """Walk the assets/ directory and build URL map."""
    asset_urls = {}
    assets_dir = os.path.join(theme_dir, "assets")
    if not os.path.isdir(assets_dir):
        return asset_urls

    for root, _, files in os.walk(assets_dir):
        for fname in files:
            abs_path = os.path.join(root, fname)
            rel_path = os.path.relpath(abs_path, theme_dir).replace("\\", "/")
            asset_urls[rel_path] = f"{REPO_BASE}/themes/{slug}/{rel_path}"

    return asset_urls


def build_registry():
    themes = []

    for slug in sorted(os.listdir(THEMES_DIR)):
        theme_dir = os.path.join(THEMES_DIR, slug)
        manifest_path = os.path.join(theme_dir, "manifest.json")

        if not os.path.isfile(manifest_path):
            continue

        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest = json.load(f)

        author = manifest.get("author", "unknown")
        source = "destinclaude" if author in OFFICIAL_AUTHORS else "community"

        entry = {
            "slug": slug,
            "name": manifest.get("name", slug),
            "author": author,
            "dark": manifest.get("dark", False),
            "description": manifest.get("description"),
            "version": manifest.get("version", "1.0.0"),
            "created": manifest.get("created"),
            "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "source": source,
            "features": detect_features(manifest),
            "manifestUrl": f"{REPO_BASE}/themes/{slug}/manifest.json",
            "assetUrls": collect_asset_urls(slug, theme_dir),
        }

        themes.append(entry)

    registry = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "themes": themes,
    }

    os.makedirs(os.path.dirname(REGISTRY_PATH), exist_ok=True)
    with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Registry rebuilt with {len(themes)} theme(s)")
    for t in themes:
        print(f"  - {t['name']} ({t['slug']}) [{t['source']}] features: {t['features']}")


if __name__ == "__main__":
    build_registry()

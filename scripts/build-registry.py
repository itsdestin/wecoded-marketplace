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


def extract_manifest_assets(manifest: dict) -> set[str]:
    """Extract all asset paths referenced in the manifest."""
    # Collect every value that looks like a relative asset path (assets/...)
    refs = set()

    def walk(obj):
        if isinstance(obj, str) and obj.startswith("assets/"):
            refs.add(obj)
        elif isinstance(obj, dict):
            for v in obj.values():
                walk(v)
        elif isinstance(obj, list):
            for v in obj:
                walk(v)

    walk(manifest)
    return refs


def collect_asset_urls(slug: str, theme_dir: str, manifest: dict) -> dict[str, str]:
    """Build URL map for assets that the manifest actually references.

    Only includes files that (a) are referenced in the manifest and
    (b) exist on disk. Warns on mismatches so broken themes are caught
    during registry builds rather than at download time.
    """
    referenced = extract_manifest_assets(manifest)
    asset_urls = {}

    for rel_path in sorted(referenced):
        abs_path = os.path.join(theme_dir, rel_path)
        if os.path.isfile(abs_path):
            asset_urls[rel_path] = f"{REPO_BASE}/themes/{slug}/{rel_path}"
        else:
            # Manifest references a file that doesn't exist — flag it
            print(f"  ⚠ {slug}: manifest references '{rel_path}' but file is missing")

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

        # Extract preview tokens (subset of colors for CSS-based card previews)
        tokens = manifest.get("tokens", {})
        preview_tokens = {
            k: tokens[k]
            for k in ("canvas", "panel", "accent", "on-accent", "fg", "fg-muted", "edge")
            if k in tokens
        }

        # Check for preview.png
        preview_path = os.path.join(theme_dir, "preview.png")
        preview_url = (
            f"{REPO_BASE}/themes/{slug}/preview.png"
            if os.path.isfile(preview_path)
            else None
        )

        entry = {
            "slug": slug,
            "name": manifest.get("name", slug),
            "author": author,
            "dark": manifest.get("dark", False),
            "description": manifest.get("description"),
            "preview": preview_url,
            "previewTokens": preview_tokens if len(preview_tokens) >= 5 else None,
            "version": manifest.get("version", "1.0.0"),
            "created": manifest.get("created"),
            "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "source": source,
            "features": detect_features(manifest),
            "manifestUrl": f"{REPO_BASE}/themes/{slug}/manifest.json",
            "assetUrls": collect_asset_urls(slug, theme_dir, manifest),
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

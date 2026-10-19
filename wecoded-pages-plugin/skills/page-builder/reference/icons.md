# A purpose-designed icon for every Page

The Page’s identity icon appears beside other app controls at **16px**: in its pinned
button, the Pages list and its title. Design new artwork from what this Page does, rather
than picking one of a finite set of stock glyphs. The page can be anything; its icon should
make its particular purpose recognizable at a glance.

## Design recipe

1. Choose a concrete, simple motif: a house for a home controller, a plant and droplet for a
   watering log, or a plate and utensils for a meal planner. These are examples of reasoning,
   not a list of allowed icons. Inspect nearby Pages so unrelated ones do not look identical.
2. Draw the motif as vector paths on a **24×24 grid**, normally inside coordinates **2–22**.
   Use one clear silhouette and few details. Two related shapes may work better than a tiny
   scene. Do not replace the drawing with initials, emoji or a generic document.
3. Inspect it at **16px** and enlarged. It should still say what the Page is about when small,
   and its strokes should look consistent with the app’s Projects, Finance and other outline
   icons. For a preview, put the paths in a standalone SVG using the wrapper below; do not
   attach to or modify the running app to inspect it.
4. Save the drawing in `page.json` as `customIcon`, and keep a named `icon` fallback for older
   app versions. Author the paths for the current Page; do not reuse this Home example for
   unrelated pages.

The **app supplies the style**: `viewBox="0 0 24 24"`, `fill="none"`,
`stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"` and
`stroke-linejoin="round"`. The artwork follows the active theme’s colour automatically.
Store geometry only—not a whole SVG, a file path, a URL, an image, CSS or colour attributes.

## Manifest format

A complete Home example (the legacy fallback is deliberately still present):

```json
{
  "name": "Home",
  "description": "Lights, temperature and media, room by room.",
  "icon": "page",
  "customIcon": {
    "version": 1,
    "paths": [
      "M3 10 L12 3 L21 10",
      "M5 9 L5 21 L10 21 L10 15 L14 15 L14 21 L19 21 L19 9"
    ]
  }
}
```

- `version` is exactly **1**. `paths` contains **1–12** SVG path-data strings, each starting
  with `M` or `m`. Use complete command groups and finite numbers; commands
  `M L H V C S Q T A Z` and their lowercase forms are supported.
- Each path is at most **2,048 characters**, and all paths together at most **8,192**.
  Keep coordinates on the 24×24 drawing grid; numeric values outside **−1,024 to 1,024**
  are rejected. Arc radii must be nonnegative, and arc flags must be **0** or **1**.
- Only `version` and `paths` belong in `customIcon`. There are no authored tags, attributes,
  event handlers, scripts, styles, embedded resources or external requests.
- The named fallback is one of `page`, `timer`, `notes`, `paint`, `chart`, `calendar`,
  `list`, `game`, `money`. Choose the closest fallback, but still supply the new artwork.
- Older apps ignore `customIcon` and show the fallback until updated. A missing, invalid or
  unsupported custom drawing also uses the fallback rather than hiding the Page. Correct an
  invalid drawing instead of treating the generic fallback as a finished new icon.

Keep a Page’s existing icon during unrelated edits. When the person asks for an icon change,
replace its custom geometry and fallback without changing its connections or saved data.

---
name: google-slides
description: "Use when the user wants to read, create, edit, or export a Google Slides deck. Triggers on: what's in my presentation, create a deck, add a slide, replace text on slide 3, export deck as PDF. File-find operations belong to google-drive."
---

# Google Slides

Content-level operations on Google Slides decks. File-find belongs to google-drive; PDF export and listing decks hop to `gws drive` (per Google's own API design — Slides doesn't own those).

```bash
source "$CLAUDE_PLUGIN_ROOT/lib/gws-wrapper.sh"
```

## Core commands

| Task | Command |
|------|---------|
| Read deck | `gws_run slides presentations get <deck-id>` |
| Create deck | `gws_run slides presentations create --title "<t>"` |
| Mutate deck | `gws_run slides presentations batchUpdate <deck-id> --requests '<json>'` |
| Export PDF | `gws_run drive files export <deck-id> --mime-type application/pdf --out <path>` |
| List decks | `gws_run drive files list --q "mimeType='application/vnd.google-apps.presentation'" --max 20` |

## batchUpdate — the write path

All edits (add/remove slides, insert/replace text, change layouts, images, tables) go through `batchUpdate` as a JSON array of request objects. Prefer batching multiple edits in one call over chaining many single-edit calls. Three common recipes:

**Add a title slide:**
```json
[{"createSlide": {"insertionIndex": 0, "slideLayoutReference": {"predefinedLayout": "TITLE"}}}]
```

**Insert text into an existing text box:**
```json
[{"insertText": {"objectId": "<element-id>", "text": "Hello", "insertionIndex": 0}}]
```

**Replace all instances of a string across the deck:**
```json
[{"replaceAllText": {"containsText": {"text": "{{date}}"}, "replaceText": "2026-04-16"}}]
```

## Slide structure

`presentations get` returns JSON with `slides[]`, each containing `pageElements` (text boxes, images, shapes). When summarizing for the user, extract text content from each text box. When making edits, use the element's `objectId` from this response.

## Handling auth expiry

Every call uses `gws_run`, which exits **2** with stderr line `AUTH_EXPIRED:<service>` when the user's 7-day OAuth refresh has lapsed.

**When this skill sees exit 2:**
1. Stop the current operation immediately. Do NOT retry automatically.
2. Emit a single marker line Claude can read: `[reauth-required: <service>]`.

**What Claude does next (follow this verbatim):**
1. Tell the user briefly, in natural language: *"Your Google connection needs a quick refresh — I'll open a browser. Approve the permissions and I'll finish {what the user asked for}."*
2. Run `bash "$CLAUDE_PLUGIN_ROOT/setup/reauth.sh"`.
3. On reauth exit 0: retry the original `gws_run` call with the same arguments, then complete the user's request as if nothing happened.
4. On reauth exit 1: tell the user plainly, *"I couldn't refresh the Google connection. Want me to try again, or come back to this later?"*

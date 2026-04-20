---
name: apple-notes
description: "Apple Notes: search, read, create, and update notes in any folder. Use when the user asks about their notes, wants to save a note, or search across note content."
metadata:
  category: "productivity"
  requires:
    bins:
      - bash
---

# apple-notes

> **Prereq:** Run `/apple-services-setup` once to grant Automation access to Notes.

Skills call `apple-wrapper.sh notes <op> [args]`. Operations route to AppleScript (no EventKit equivalent exists).

## Operations

| Op | Args | Returns |
|---|---|---|
| `list_folders` | — | `[{name, note_count}]` |
| `list_notes` | `[--folder <name>]` | `[{id, name, modified}]` |
| `get_note` | `--id <id>` | `{id, name, body_markdown, modified}` |
| `search_notes` | `--query <q> [--folder <name>]` | `[{id, name, snippet}]` |
| `create_note` | `--name <n> --body <md> [--folder <name>]` | `note` |
| `update_note` | `--id <id> --body <md> [--mode replace\|append\|prepend]` | `note` |
| `delete_note` | `--id <id>` | `{ok: true}` |

## ⚠️ Rich content warning

Apple Notes stores rich HTML (images, drawings, tables, attachments). Markdown round-trips lose non-text content.

**`update_note` with `--mode replace` will destroy images, drawings, tables, and attachments in the target note.** Unless you're confident the note contains only text — or the user explicitly said to replace everything — use `--mode append` or `--mode prepend`. When in doubt, ask.

## Handling permission denial

`TCC_DENIED:notes` → Automation access was revoked. Tell the user: open System Settings → Privacy & Security → Automation, find the app that's hosting Claude, turn on **Notes** underneath it. Then re-run `/apple-services-setup`.

## Related: youcoded-inbox

> For inbox-style watched-folder reading with same-day re-presentation guards, see the `youcoded-inbox` bundle's `apple-notes` provider. This skill is general-purpose and does not track "already shown today" state.

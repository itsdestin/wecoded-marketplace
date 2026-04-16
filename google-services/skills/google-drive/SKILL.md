---
name: google-drive
description: "Use when the user wants to find, download, upload, move, rename, or trash files stored in Google Drive. Triggers on: find my file, upload this to Drive, download from Drive, move a file, where's my X file. Does NOT handle reading/editing document CONTENT — that's google-docs/sheets/slides."
---

# Google Drive

Handles files-as-objects in Drive. Document content belongs to the google-docs / google-sheets / google-slides skills.

```bash
source "$CLAUDE_PLUGIN_ROOT/lib/gws-wrapper.sh"
```

## Core commands

| Task | Command |
|------|---------|
| List | `gws_run drive list --max 20` |
| Search | `gws_run drive list --query "name contains 'budget'"` |
| Download | `gws_run drive download <file-id> --out <local-path>` |
| Upload | `gws_run drive upload <local-path> --folder <folder-id>` |
| Move | `gws_run drive move <file-id> --to-folder <folder-id>` |
| Rename | `gws_run drive rename <file-id> --to "<new-name>"` |
| Trash | `gws_run drive trash <file-id>` |

## Shared Drives vs My Drive

Default searches and operations target My Drive. If the user mentions a specific shared drive ("in the Finance shared drive"), pass `--drive <drive-id>`. List shared drives with `gws_run drive shared-drives list`.

## MIME conversions

Google-native formats (Docs, Sheets, Slides) download as their native Google format by default. To convert to Office formats, pass `--export-mime application/vnd.openxmlformats-officedocument.wordprocessingml.document` (or the Excel / PowerPoint equivalent).

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

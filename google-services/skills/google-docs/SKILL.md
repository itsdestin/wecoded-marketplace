---
name: google-docs
description: "Use when the user wants to read, edit, create, or export the CONTENT of a Google Doc. Triggers on: write a doc about, edit my doc, what does my X doc say, create a doc, export to PDF. Handles document content; does NOT handle finding-the-file operations — those belong to google-drive."
---

# Google Docs

Content-level operations on Google Docs. File-level operations (find, move, trash) belong to google-drive.

```bash
source "$CLAUDE_PLUGIN_ROOT/lib/gws-wrapper.sh"
```

## Core commands

| Task | Command |
|------|---------|
| Read | `gws_run docs get <doc-id>` |
| Create | `gws_run docs create --title "<t>" --body "<b>"` |
| Update | `gws_run docs update <doc-id> --body "<b>"` |
| Export to PDF | `gws_run docs export <doc-id> --format pdf --out <path>` |

## Structured content

`gws docs get` returns JSON with structured blocks (paragraphs, tables, lists, images). When summarizing for the user, flatten to plain text. When preserving structure matters (e.g., they ask "what's in the third table?"), keep the structure.

## Finding a doc

If the user names the doc ("read my budget doc"), call google-drive first to find the ID, then pass the ID here.

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

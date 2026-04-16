---
name: google-sheets
description: "Use when the user wants to read cell values, write values, append rows, or create a new spreadsheet. Triggers on: what's in my spreadsheet, update cell, add a row, create a sheet, read column X. File-find operations ('where is my X sheet') belong to google-drive."
---

# Google Sheets

Content-level operations on Google Sheets. Finding the file belongs to google-drive.

```bash
source "$CLAUDE_PLUGIN_ROOT/lib/gws-wrapper.sh"
```

## Core commands

| Task | Command |
|------|---------|
| Get sheet metadata | `gws_run sheets get <sheet-id>` |
| Create | `gws_run sheets create --title "<t>"` |
| Read values | `gws_run sheets values get <sheet-id> --range "A1:D10"` |
| Update values | `gws_run sheets values update <sheet-id> --range "A1" --values '[["hello"]]'` |
| Append row | `gws_run sheets values append <sheet-id> --range "Sheet1" --values '[["v1","v2"]]'` |

## Values vs formulas

`values get` returns calculated values by default. To get formula text, pass `--value-render-option FORMULA`. When the user asks "what's the formula in A1," use FORMULA mode; otherwise default to calculated.

## A1 vs R1C1

Default A1. Use R1C1 only if the user explicitly asks in that notation.

## Finding a sheet

Call google-drive first if the user names it rather than gives an ID.

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

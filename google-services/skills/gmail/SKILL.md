---
name: gmail
description: "Use when the user wants to send, read, search, label, or draft email in their Gmail inbox. Triggers on: send an email, check my inbox, find emails from, reply to, draft a message, add a label. Does NOT handle Google Chat or Google Messages (those are other bundles)."
---

# Gmail

Connects to the user's Gmail via `gws gmail`. Auth is managed by `/google-services-setup` — this skill assumes `gws auth status` is valid.

## Core commands

Source the shared wrapper before invoking:

```bash
source "$CLAUDE_PLUGIN_ROOT/lib/gws-wrapper.sh"
```

Then use `gws_run gmail <...>` (never call `gws` directly — the wrapper emits the shared reconnect message on auth errors):

| Task | Command |
|------|---------|
| List recent | `gws_run gmail list --max 10` |
| Read one | `gws_run gmail read <message-id>` |
| Send | `gws_run gmail send --to "<email>" --subject "<s>" --body "<b>"` |
| Draft | `gws_run gmail draft --to "<email>" --subject "<s>" --body "<b>"` |
| Add label | `gws_run gmail label add <message-id> <label-name>` |
| Search | `gws_run gmail list --query "from:alice@example.com"` |

## Format handling

`gws gmail read` returns both HTML and plaintext bodies. Prefer plaintext when summarizing for the user; use HTML when preserving formatting matters (forwarding, etc.).

## Localized labels

If the user's Gmail language is non-English, system labels (Inbox, Sent, Drafts) are returned in their localized names. When filtering by label, prefer the gmail system label ID (e.g., `INBOX`) over the visible name.

## Drafts vs sent

When the user asks to "send," use `gws_run gmail send`. When they ask to "draft" or "prepare," use `gws_run gmail draft`. Never leave both a draft AND a sent copy — pick one.

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

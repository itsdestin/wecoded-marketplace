---
name: apple-mail
description: "Apple Mail: search, read, send, draft, and manage mail. Use when the user asks to check mail, find a message, send or reply to an email, or triage their inbox."
metadata:
  category: "productivity"
  requires:
    bins:
      - bash
---

# apple-mail

> **Prereq:** Run `/apple-services-setup` once to grant Automation access to Mail.

Skills call `apple-wrapper.sh mail <op> [args]`. Routes via AppleScript.

## Operations

| Op | Args | Returns |
|---|---|---|
| `list_mailboxes` | `[--account <name>]` | `[{name, account, unread_count}]` |
| `search` | `--query <q> [--mailbox <name>] [--from <email>] [--to <email>] [--since <iso>] [--limit <n>]` | `[{id, from, subject, date, preview}]` |
| `read_message` | `--id <id>` | `{id, from, to[], cc[], subject, date, body_text, attachments[]}` |
| `send` | `--to <e1,e2,...> --subject <s> --body <b> [--cc <...>] [--bcc <...>] [--attachments <p1,p2,...>]` | `{ok: true}` |
| `create_draft` | same as `send` (minus attachments) | `{id}` |
| `mark_read` | `--id <id>` | `{ok: true}` |
| `mark_unread` | `--id <id>` | `{ok: true}` |

## Performance note

Mail searches against large mailboxes can take 30-60 seconds; the wrapper allows up to 60s for search ops. List/read ops cap at 15s.

## Handling permission denial

`TCC_DENIED:mail` → same pattern as Notes: re-grant via Automation settings + `/apple-services-setup`.

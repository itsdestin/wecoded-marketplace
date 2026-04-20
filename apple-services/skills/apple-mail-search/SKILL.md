---
name: apple-mail-search
description: "Search Apple Mail messages. Use when the user asks 'find the email from X', 'search my mail for Y', 'where's that message about Z'."
---

# apple-mail-search

Search the user's mail.

## Usage

```bash
# Keyword
apple-wrapper.sh mail search --query "lease renewal" --limit 10

# Narrow with filters
apple-wrapper.sh mail search --query "invoice" --from "billing@example.com" --since 2026-01-01
```

## Performance

Mail search can take 30-60 seconds on large mailboxes — the wrapper allows up to 60s. Tell the user "Searching your mail — this can take up to a minute" before calling.

Returns `[{id, from, subject, date, preview}]`. Use `read_message --id <id>` for full body + attachments of a specific hit.

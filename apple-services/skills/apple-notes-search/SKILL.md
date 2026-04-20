---
name: apple-notes-search
description: "Search across Apple Notes content. Use when the user asks 'find my note about X', 'search my notes for Y', or wants to locate a specific note."
---

# apple-notes-search

Search note bodies and titles.

## Usage

```bash
apple-wrapper.sh notes search_notes --query "tahoe cabin"
# Restrict to one folder:
apple-wrapper.sh notes search_notes --query "receipts" --folder "Work"
```

Returns `[{id, name, snippet}]`. For 0 results, say "No notes found matching that." For many, show the top 5 and offer to narrow.

Use `get_note --id <id>` to pull the full note body when the user picks one.

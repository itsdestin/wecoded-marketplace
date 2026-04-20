---
name: apple-reminders-list
description: "List or show the user's Apple Reminders. Use when they ask 'what's on my to-do', 'show my reminders', 'what do I have to do'."
---

# apple-reminders-list

Show reminders, defaulting to incomplete only.

## Usage

```bash
# All incomplete across all lists
apple-wrapper.sh reminders list_reminders --incomplete-only

# From one list only
apple-wrapper.sh reminders list_reminders --list-id "<id>" --incomplete-only
```

Group by list in the output. Show due date if present, otherwise just the title.

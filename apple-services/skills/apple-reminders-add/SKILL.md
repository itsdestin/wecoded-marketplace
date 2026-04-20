---
name: apple-reminders-add
description: "Add a new Apple Reminder. Use when the user says 'remind me to X', 'add a reminder', 'put X on my to-do list', or similar."
---

# apple-reminders-add

Add a reminder, optionally with a due time.

## Flow

1. Default to the user's primary reminders list unless they name a specific one.
2. Parse any time phrase ("at 5pm", "tomorrow morning", "next Monday") into ISO-8601 due.
3. Call `create_reminder`.
4. Confirm with the reminder title + due time in human format.

## Usage

```bash
apple-wrapper.sh reminders list_lists   # if the user named a list
apple-wrapper.sh reminders create_reminder \
  --title "Call mom" \
  --list-id "<primary-id>" \
  --due 2026-04-17T17:00
```

## Default list

If `list_lists` returns multiple and the user didn't name one, prefer a list called "Reminders" or the first list in the array. Don't ask — the cost of a wrong list is low (user can move it).

---
name: apple-notes-write
description: "Create a new Apple Note or add to an existing one. Use when the user says 'save this as a note', 'add this to my notes', 'write a note about X'."
---

# apple-notes-write

Create a note or append to an existing one.

## Default: create new

```bash
apple-wrapper.sh notes create_note \
  --name "Meeting notes 2026-04-17" \
  --body "## Attendees\n- Alex\n- Jamie\n\n## Notes\n..." \
  --folder "Work"
```

## Adding to an existing note

Ask the user whether to append or replace. **Default to append** — replace destroys rich content (images, tables, drawings) in notes Claude didn't create.

```bash
# Safe: append
apple-wrapper.sh notes update_note --id "<id>" --body "New content" --mode append

# Only if user explicitly confirms, and note is plain text:
apple-wrapper.sh notes update_note --id "<id>" --body "..." --mode replace
```

If unsure whether a note is plain text, read it first with `get_note --id <id>` and look for image/table markers in the body.

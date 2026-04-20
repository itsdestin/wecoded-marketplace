---
name: apple-calendar-create
description: "Create a new Apple Calendar event. Use when the user says 'add an event', 'put this on my calendar', 'schedule X', 'book a meeting', or similar."
---

# apple-calendar-create

Create a calendar event.

## Flow

1. If you don't know which calendar to add to, call `list_calendars` first and ask the user (unless only one is writable).
2. Parse the user's natural-language time into ISO-8601 start/end.
3. Call `create_event`.
4. Confirm by reading back the title, time, and calendar.

## Usage

```bash
apple-wrapper.sh calendar list_calendars   # if needed
apple-wrapper.sh calendar create_event \
  --title "Coffee with Alex" \
  --start 2026-04-18T15:00 \
  --end 2026-04-18T16:00 \
  --calendar-id "<id>"
```

## Duration defaults

If the user doesn't specify an end time:
- "Meeting" / "call" → default 30 minutes
- "Coffee" / "lunch" / "dinner" → default 60 minutes
- "Appointment" → default 60 minutes
- Anything else → ask.

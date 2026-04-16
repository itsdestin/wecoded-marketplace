---
name: google-calendar
description: "Use when the user wants to check, create, update, or delete events in their Google Calendar. Triggers on: what's on my calendar, schedule a meeting, cancel my 3pm, when am I free, add a reminder. Handles multiple calendars (personal, family, work) with primary as default."
---

# Google Calendar

```bash
source "$CLAUDE_PLUGIN_ROOT/lib/gws-wrapper.sh"
```

## Core commands

| Task | Command |
|------|---------|
| List calendars | `gws_run calendar list` |
| List events | `gws_run calendar events list --max 10` |
| Create event | `gws_run calendar events create --summary "<s>" --start "<iso>" --end "<iso>"` |
| Update event | `gws_run calendar events update <event-id> --summary "<new>"` |
| Delete event | `gws_run calendar events delete <event-id>` |

## Multiple calendars

Default is primary. If the user names a specific calendar ("on my Family calendar"), pass `--calendar <calendar-id>` — find the ID from `gws_run calendar list`.

## Recurring events

When the user asks to update or delete "just this one" of a recurring event, pass the instance's event ID (has a suffix like `_20261023T090000Z`). When they mean the whole series, use the base event ID. If ambiguous, ask.

## Time zones

Events return in each calendar's default TZ. When formatting for the user, convert to the user's primary calendar's TZ (fetch from `gws_run calendar list`). Always display TZ abbreviation when it differs from the user's.

## Availability

For "when am I free today" / "free/busy" questions, use `gws_run calendar freebusy --start <iso> --end <iso> --calendars primary`.

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

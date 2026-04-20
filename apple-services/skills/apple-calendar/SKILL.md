---
name: apple-calendar
description: "Apple Calendar: list, search, and manage events across all your calendars via EventKit. Use when the user asks about events, meetings, or wants to schedule something on their Mac's Calendar."
metadata:
  category: "productivity"
  requires:
    bins:
      - bash
---

# apple-calendar

> **Prereq:** Run `/apple-services-setup` once to grant Calendar access. All commands here will return `TCC_DENIED:calendar` if the grant hasn't been made yet.

Skills call `apple-wrapper.sh calendar <op> [args]`. The wrapper is at `$PLUGIN_DIR/lib/apple-wrapper.sh`; in a typical install, this resolves to `~/.claude/plugins/marketplaces/youcoded/plugins/apple-services/lib/apple-wrapper.sh`.

## Operations

| Op | Args | Returns |
|---|---|---|
| `list_calendars` | — | `[{id, title, color, writable}]` |
| `list_events` | `--from <iso> --to <iso> [--calendar-id <id>]` | `[event]` |
| `get_event` | `--id <id>` | `event` |
| `search_events` | `--query <q> --from <iso> --to <iso>` | `[event]` |
| `create_event` | `--title <t> --start <iso> --end <iso> --calendar-id <id> [--location <l>] [--notes <n>] [--all-day] [--recurrence <rule>]` | `event` |
| `update_event` | `--id <id>` + any field above | `event` |
| `delete_event` | `--id <id>` | `{ok: true}` |
| `free_busy` | `--from <iso> --to <iso> [--calendar-ids <id,id,...>]` | `[{start, end, busy}]` |

## Examples

```bash
# What's this week?
apple-wrapper.sh calendar list_events --from 2026-04-13 --to 2026-04-20

# Create a meeting
apple-wrapper.sh calendar create_event \
  --title "Team sync" \
  --start 2026-04-17T14:00 --end 2026-04-17T15:00 \
  --calendar-id "<id-from-list_calendars>"

# Busy windows across two calendars
apple-wrapper.sh calendar free_busy --from 2026-04-17 --to 2026-04-18 \
  --calendar-ids "<id1>,<id2>"
```

## Handling permission denial

If a call fails with `TCC_DENIED:calendar`, tell the user:

> macOS says I don't have access to your Calendar. Run `/apple-services-setup` and re-grant permission, or open System Settings → Privacy & Security → Calendars and turn on **apple-helper**. Let me know when that's done and I'll retry.

Do not retry automatically.

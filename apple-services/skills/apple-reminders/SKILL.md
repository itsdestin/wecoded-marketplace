---
name: apple-reminders
description: "Apple Reminders: create, list, complete, and delete reminders across your lists. Use when the user asks to be reminded of something, or wants to see their to-do list."
metadata:
  category: "productivity"
  requires:
    bins:
      - bash
---

# apple-reminders

> **Prereq:** Run `/apple-services-setup` once to grant Reminders access.

Skills call `apple-wrapper.sh reminders <op> [args]`.

## Operations

| Op | Args | Returns |
|---|---|---|
| `list_lists` | — | `[{id, title, color}]` |
| `list_reminders` | `[--list-id <id>] [--incomplete-only]` | `[reminder]` |
| `get_reminder` | `--id <id>` | `reminder` |
| `create_reminder` | `--title <t> --list-id <id> [--due <iso>] [--priority <0-9>] [--notes <n>]` | `reminder` |
| `update_reminder` | `--id <id>` + any field | `reminder` |
| `complete_reminder` | `--id <id>` | `{ok: true}` |
| `delete_reminder` | `--id <id>` | `{ok: true}` |

## Examples

```bash
apple-wrapper.sh reminders list_reminders --incomplete-only
apple-wrapper.sh reminders create_reminder --title "Call mom" --list-id "<id>" --due 2026-04-17T17:00
apple-wrapper.sh reminders complete_reminder --id "<reminder-id>"
```

## Handling permission denial

`TCC_DENIED:reminders` → tell the user to re-grant via `/apple-services-setup` or System Settings → Privacy & Security → Reminders → turn on **apple-helper**.

## Related: youcoded-inbox

> For inbox-style watched-list reading with same-day re-presentation guards, see the `youcoded-inbox` bundle's `apple-reminders` provider. This skill is general-purpose and does not track "already shown today" state.

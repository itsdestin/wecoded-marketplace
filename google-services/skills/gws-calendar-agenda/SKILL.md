---
name: gws-calendar-agenda
description: "Google Calendar: Show upcoming events across all calendars."
metadata:
  version: 0.22.5
  openclaw:
    category: "productivity"
    requires:
      bins:
        - gws
    cliHelp: "gws calendar +agenda --help"
---

# calendar +agenda

> **PREREQUISITE:** Read `../gws-shared/SKILL.md` for auth, global flags, security rules, and **account selection** — every gws invocation must follow the routing protocol there (first-action confirm; env-var-routed config dir). If missing, run `gws generate-skills` to create it.

> **MULTI-ACCOUNT:** All `gws ...` examples below show the bare command for readability. At invocation time, prepend the env-var routing from gws-shared's Account selection section: `GOOGLE_WORKSPACE_CLI_CONFIG_DIR=<active configDir> GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file gws ...`.

Show upcoming events across all calendars

## Usage

```bash
gws calendar +agenda
```

## Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--today` | — | — | Show today's events |
| `--tomorrow` | — | — | Show tomorrow's events |
| `--week` | — | — | Show this week's events |
| `--days` | — | — | Number of days ahead to show |
| `--calendar` | — | — | Filter to specific calendar name or ID |
| `--timezone` | — | — | IANA timezone override (e.g. America/Denver). Defaults to Google account timezone. |

## Examples

```bash
gws calendar +agenda
gws calendar +agenda --today
gws calendar +agenda --week --format table
gws calendar +agenda --days 3 --calendar 'Work'
gws calendar +agenda --today --timezone America/New_York
```

## Tips

- Read-only — never modifies events.
- Queries all calendars by default; use --calendar to filter.
- Uses your Google account timezone by default; override with --timezone.

## See Also

- [gws-shared](../gws-shared/SKILL.md) — Global flags and auth
- [gws-calendar](../gws-calendar/SKILL.md) — All manage calendars and events commands

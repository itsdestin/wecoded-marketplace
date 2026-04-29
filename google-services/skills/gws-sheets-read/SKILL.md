---
name: gws-sheets-read
description: "Google Sheets: Read values from a spreadsheet."
metadata:
  version: 0.22.5
  openclaw:
    category: "productivity"
    requires:
      bins:
        - gws
    cliHelp: "gws sheets +read --help"
---

# sheets +read

> **PREREQUISITE:** Read `../gws-shared/SKILL.md` for auth, global flags, security rules, and **account selection** — every gws invocation must follow the routing protocol there (first-action confirm; env-var-routed config dir). If missing, run `gws generate-skills` to create it.

> **MULTI-ACCOUNT:** All `gws ...` examples below show the bare command for readability. At invocation time, prepend the env-var routing from gws-shared's Account selection section: `GOOGLE_WORKSPACE_CLI_CONFIG_DIR=<active configDir> GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file gws ...`.

Read values from a spreadsheet

## Usage

```bash
gws sheets +read --spreadsheet <ID> --range <RANGE>
```

## Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `--spreadsheet` | ✓ | — | Spreadsheet ID |
| `--range` | ✓ | — | Range to read (e.g. 'Sheet1!A1:B2') |

## Examples

```bash
gws sheets +read --spreadsheet ID --range "Sheet1!A1:D10"
gws sheets +read --spreadsheet ID --range Sheet1
```

## Tips

- Read-only — never modifies the spreadsheet.
- For advanced options, use the raw values.get API.

## See Also

- [gws-shared](../gws-shared/SKILL.md) — Global flags and auth
- [gws-sheets](../gws-sheets/SKILL.md) — All read and write spreadsheets commands

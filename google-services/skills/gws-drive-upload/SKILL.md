---
name: gws-drive-upload
description: "Google Drive: Upload a file with automatic metadata."
metadata:
  version: 0.22.5
  openclaw:
    category: "productivity"
    requires:
      bins:
        - gws
    cliHelp: "gws drive +upload --help"
---

# drive +upload

> **PREREQUISITE:** Read `../gws-shared/SKILL.md` for auth, global flags, security rules, and **account selection** — every gws invocation must follow the routing protocol there (first-action confirm; env-var-routed config dir). If missing, run `gws generate-skills` to create it.

> **MULTI-ACCOUNT:** All `gws ...` examples below show the bare command for readability. At invocation time, prepend the env-var routing from gws-shared's Account selection section: `GOOGLE_WORKSPACE_CLI_CONFIG_DIR=<active configDir> GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file gws ...`.

> **DRIVE NOTE:** Per the account selection protocol in gws-shared, every direct user-initiated Drive operation **re-confirms** which account to use, even if the conversation has an established active account. Granularity is per user-initiated task — a "upload these 5 files" task = one confirm, not five.

Upload a file with automatic metadata

## Usage

```bash
gws drive +upload <file>
```

## Flags

| Flag | Required | Default | Description |
|------|----------|---------|-------------|
| `<file>` | ✓ | — | Path to file to upload |
| `--parent` | — | — | Parent folder ID |
| `--name` | — | — | Target filename (defaults to source filename) |

## Examples

```bash
gws drive +upload ./report.pdf
gws drive +upload ./report.pdf --parent FOLDER_ID
gws drive +upload ./data.csv --name 'Sales Data.csv'
```

## Tips

- MIME type is detected automatically.
- Filename is inferred from the local path unless --name is given.

> [!CAUTION]
> This is a **write** command — confirm with the user before executing.

## See Also

- [gws-shared](../gws-shared/SKILL.md) — Global flags and auth
- [gws-drive](../gws-drive/SKILL.md) — All manage files, folders, and shared drives commands

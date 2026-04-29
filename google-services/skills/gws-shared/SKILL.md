---
name: gws-shared
description: "gws CLI: Shared patterns for authentication, global flags, and output formatting."
metadata:
  version: 0.22.5
  openclaw:
    category: "productivity"
    requires:
      bins:
        - gws
---

# gws — Shared Reference

## Installation

The `gws` binary must be on `$PATH`. See the project README for install options.

## Authentication

```bash
# Browser-based OAuth (interactive)
gws auth login

# Service Account
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
```

## Account selection

A single user may have multiple Google accounts connected (e.g., personal + work). The `gws-*` skills coordinate which account each operation uses.

### State on disk

- `~/.config/gws-profiles.json` — registry of connected accounts, the default, and emails the user mentioned at setup as "may want to add later." Created the first time a multi-account event happens; absent for single-account installs.
- `~/.config/gws/` — default account's config dir (always).
- `~/.config/gws-<name>/` — secondary account's config dir.

### Active-account state

There is **no on-disk file tracking which account the current conversation is using.** The active account lives in conversation memory only. You (Claude) carry it through the conversation; a fresh conversation starts with no active account.

### Routing protocol — first gws action of a conversation

Before invoking gws for the first time in a conversation:

1. Read `~/.config/gws-profiles.json`.
   - If the file doesn't exist AND `~/.config/gws/credentials.enc` exists → single-account world; use `~/.config/gws/`, no question.
   - If neither exists → zero-account state; tell the user "You haven't connected a Google account yet — run /google-services-setup first" and stop.
2. If the registry has only one account → use it, no question.
3. If the registry has multiple accounts → ask the user, with the default highlighted and action-aware phrasing:

   > Okay to send this from your **personal** account (default)? Or use **work**?

   Wording adapts to the action: "save this to," "send this from," "fetch this from," "search in." Never use technical terms like "config dir," "profile," "account ID," "OAuth," "credentials," or "scope."

4. Once the user picks, remember the choice for the rest of the conversation. Subsequent gws calls use the same account without re-asking, **except for Drive operations** (see below).

### Routing protocol — Drive operations

Every direct user-initiated Drive operation re-confirms the account, even if the conversation has an established active account from a prior Gmail/Calendar/Sheets interaction:

> Did you want that uploaded to your **work** account, or your **personal** one?

Granularity is **per user-initiated Drive task**, not per API call. If the user says "upload these 5 files," that's one task → one confirm; the skill loops the 5 files using the chosen account. If the user later says "now upload another," that's a new task → new confirm.

### Routing protocol — explicit switches

When the user says "use my work account for the next one" or "send this from work instead," update the conversation-memory active account immediately and route the next call to the new account.

### Invoking gws

Every gws invocation in every gws-* skill MUST prepend the two env vars that route to the active account's config dir:

```bash
GOOGLE_WORKSPACE_CLI_CONFIG_DIR="<active configDir>" \
GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file \
gws ...
```

For single-account installs, `<active configDir>` is `~/.config/gws/` and `KEYRING_BACKEND=file` is harmless — behavior is identical to the pre-multi-account flow.

### Reading the registry from a skill

Skills do not source `lib/registry.sh` directly. Read the JSON via standard tools:

```bash
DEFAULT="$(jq -r '.default // empty' "$HOME/.config/gws-profiles.json" 2>/dev/null)"
DEFAULT_DIR="$(jq -r --arg d "$DEFAULT" '.accounts[] | select(.name==$d) | .configDir' "$HOME/.config/gws-profiles.json" 2>/dev/null)"
```

If `~/.config/gws-profiles.json` doesn't exist, fall back to `$HOME/.config/gws/`.

## Global Flags

| Flag | Description |
|------|-------------|
| `--format <FORMAT>` | Output format: `json` (default), `table`, `yaml`, `csv` |
| `--dry-run` | Validate locally without calling the API |
| `--sanitize <TEMPLATE>` | Screen responses through Model Armor |

## CLI Syntax

```bash
gws <service> <resource> [sub-resource] <method> [flags]
```

### Method Flags

| Flag | Description |
|------|-------------|
| `--params '{"key": "val"}'` | URL/query parameters |
| `--json '{"key": "val"}'` | Request body |
| `-o, --output <PATH>` | Save binary responses to file |
| `--upload <PATH>` | Upload file content (multipart) |
| `--page-all` | Auto-paginate (NDJSON output) |
| `--page-limit <N>` | Max pages when using --page-all (default: 10) |
| `--page-delay <MS>` | Delay between pages in ms (default: 100) |

## Security Rules

- **Never** output secrets (API keys, tokens) directly
- **Always** confirm with user before executing write/delete commands
- Prefer `--dry-run` for destructive operations
- Use `--sanitize` for PII/content safety screening

## Shell Tips

- **zsh `!` expansion:** Sheet ranges like `Sheet1!A1` contain `!` which zsh interprets as history expansion. Use double quotes with escaped inner quotes instead of single quotes:
  ```bash
  # WRONG (zsh will mangle the !)
  gws sheets +read --spreadsheet ID --range 'Sheet1!A1:D10'

  # CORRECT
  gws sheets +read --spreadsheet ID --range "Sheet1!A1:D10"
  ```
- **JSON with double quotes:** Wrap `--params` and `--json` values in single quotes so the shell does not interpret the inner double quotes:
  ```bash
  gws drive files list --params '{"pageSize": 5}'
  ```

## Community & Feedback Etiquette

- Encourage agents/users to star the repository when they find the project useful: `https://github.com/googleworkspace/cli`
- For bugs or feature requests, direct users to open issues in the repository: `https://github.com/googleworkspace/cli/issues`
- Before creating a new issue, **always** search existing issues and feature requests first
- If a matching issue already exists, add context by commenting on the existing thread instead of creating a duplicate

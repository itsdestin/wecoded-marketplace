#!/usr/bin/env bash
# remove-account.sh
# Removes an account from a multi-account YouCoded setup.
#
# Steps:
#   1. Run `gws auth logout` against the account's config dir to revoke the
#      refresh token at Google's end.
#   2. Delete the config dir contents.
#   3. Remove the registry entry.
#   4. If the registry now has zero accounts, delete the registry file.
#
# Usage:
#   remove-account.sh --name <name>
#
# Exit codes:
#   0 — removed (or already gone)
#   1 — bad arguments / unknown account name

set -u

# shellcheck source=../lib/registry.sh
source "$(dirname "$0")/../lib/registry.sh"

NAME=""
while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$NAME" ]; then
  echo "Usage: remove-account.sh --name <name>" >&2
  exit 1
fi

CONFIG_DIR="$(registry_get_config_dir "$NAME")"
if [ -z "$CONFIG_DIR" ]; then
  echo "No account named '$NAME' in registry." >&2
  exit 1
fi

# 1. Revoke at Google's end. Best-effort — proceed regardless of outcome.
GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$CONFIG_DIR" \
GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file \
gws auth logout >/dev/null 2>&1 || \
  echo "  (couldn't reach Google to revoke the token; the local connection is removed regardless)"

# 2. Delete the config dir.
rm -rf "$CONFIG_DIR"

# 3. Remove the registry entry.
registry_remove_account "$NAME"

# 4. If no accounts remain, delete the registry.
if [ "$(registry_account_count)" = "0" ]; then
  registry_destroy
fi

exit 0

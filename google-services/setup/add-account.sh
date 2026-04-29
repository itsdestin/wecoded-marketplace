#!/usr/bin/env bash
# add-account.sh
# Adds a secondary Google account to a multi-account YouCoded setup.
#
# Two modes:
#   --fast-path: assumes the user already added this email to the existing
#     OAuth client's Test Users list. Copies the existing client_secret.json
#     into the new config dir and runs `gws auth login` against it.
#   --slow-path: full bootstrap of a new GCP project + new OAuth client for
#     this account. Used when the workspace blocks the existing client.
#
# Usage:
#   add-account.sh --name <name> --email <email> --fast-path
#   add-account.sh --name <name> --email <email> --slow-path
#
# Exit codes:
#   0 — account added successfully
#   1 — generic failure
#   2 — fast-path consent rejected (signal to the caller to retry as slow-path)

set -u

# shellcheck source=../lib/registry.sh
source "$(dirname "$0")/../lib/registry.sh"

NAME=""
EMAIL=""
MODE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --name)        NAME="$2"; shift 2 ;;
    --email)       EMAIL="$2"; shift 2 ;;
    --fast-path)   MODE="fast"; shift ;;
    --slow-path)   MODE="slow"; shift ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$NAME" ] || [ -z "$EMAIL" ] || [ -z "$MODE" ]; then
  echo "Usage: add-account.sh --name <name> --email <email> --fast-path|--slow-path" >&2
  exit 1
fi

CONFIG_DIR="$HOME/.config/gws-$NAME"

case "$MODE" in
  fast)
    if [ ! -f "$HOME/.config/gws/client_secret.json" ]; then
      echo "No primary account found at ~/.config/gws/. Run /google-services-setup first." >&2
      exit 1
    fi
    mkdir -p "$CONFIG_DIR"
    cp "$HOME/.config/gws/client_secret.json" "$CONFIG_DIR/client_secret.json"

    # Run auth login. If the user's account is not on Test Users (or the
    # consent screen is rejected for any other reason), gws exits nonzero —
    # we surface as exit 2 so the caller can fall back to slow-path.
    if ! GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$CONFIG_DIR" \
         GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file \
         gws auth login; then
      # Cleanup the dir so a subsequent slow-path attempt starts fresh.
      rm -rf "$CONFIG_DIR"
      exit 2
    fi

    registry_init
    registry_add_account "$NAME" "$EMAIL" "$CONFIG_DIR" false ""
    # If this is the first secondary account, also record the primary in the
    # registry so it has a name and can be referenced.
    if [ "$(registry_account_count)" = "1" ]; then
      # Only the just-added secondary is listed; primary needs to be added too.
      # The slash command (Phase 4) is responsible for asking the user what
      # to call the primary account during the multi-account upgrade — fall
      # back to "personal" here as a safe default.
      registry_add_account "personal" "" "$HOME/.config/gws" true ""
      registry_set_default "personal"
    fi
    echo "  ✓ Connected $EMAIL as $NAME"
    ;;
  slow)
    # Slow path: full bootstrap of a per-account GCP project. Reuses the
    # existing helpers with --account-name + --config-dir to land everything
    # in the new account's config dir.
    : "${YOUCODED_OUTPUT_DIR:?must be set when invoking slow-path}"

    bash "$(dirname "$0")/bootstrap-gcp.sh" --account-name "$NAME" || exit 1
    # bootstrap-gcp.sh writes project.env to YOUCODED_OUTPUT_DIR; source it.
    # shellcheck source=/dev/null
    source "$YOUCODED_OUTPUT_DIR/project.env"

    # The slash command is responsible for the manual Cloud Console steps
    # (consent screen + OAuth client creation + JSON download) for the
    # slow-path. add-account.sh's job ends with bootstrap-gcp; ingest and
    # auth login happen back in the slash command after the user downloads
    # the JSON. So in slow-path mode this script only does the GCP project
    # creation, then exits 0 with the project_id printed for the slash
    # command to consume from the env file.
    echo "  ✓ Created GCP project $PROJECT_ID for $NAME"
    ;;
esac

exit 0

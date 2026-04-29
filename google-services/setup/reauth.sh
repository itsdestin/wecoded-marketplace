#!/usr/bin/env bash
# reauth.sh
# Invoked by Claude (not by the user) when a skill signals AUTH_EXPIRED.
# Re-runs the browser OAuth flow against a specified config dir, or against
# the default ~/.config/gws/ when --config-dir is omitted.
#
# Usage:
#   reauth.sh                              # default account at ~/.config/gws/
#   reauth.sh --config-dir <path>          # named account
#
# Exit 0 on success, 1 on failure (user closed browser, network error, no
# credentials saved).

set -u

CONFIG_DIR="$HOME/.config/gws"

while [ $# -gt 0 ]; do
  case "$1" in
    --config-dir) CONFIG_DIR="$2"; shift 2 ;;
    --) shift; break ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

CREDS="$CONFIG_DIR/client_secret.json"
if [ ! -f "$CREDS" ]; then
  echo "No saved Google setup found at $CONFIG_DIR. Run /google-services-setup first." >&2
  exit 1
fi

# Both env vars are required for safe per-account isolation. CONFIG_DIR alone
# leaves the AES key in the OS keyring under a fixed service name, where a
# second account's auth login would clobber the first. KEYRING_BACKEND=file
# moves the key into <CONFIG_DIR>/.encryption_key so each account's state is
# fully isolated. See spec section "Foundation" for full reasoning.
export GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$CONFIG_DIR"
export GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file

gws auth login || exit 1
exit 0

#!/usr/bin/env bash
# spotify-services launcher — sourced by Claude Code's MCP reconciler.
set -euo pipefail

VENV="$HOME/.spotify-services/server/.venv"
CLIENT_ENV="$HOME/.youcoded/spotify-services/client.env"

if [ ! -d "$VENV" ]; then
  echo '{"error":"server_not_installed","hint":"Run /spotify-services-setup."}' >&2
  exit 2
fi
if [ ! -f "$CLIENT_ENV" ]; then
  echo '{"error":"oauth_not_complete","hint":"Run /spotify-services-setup."}' >&2
  exit 2
fi

# shellcheck disable=SC1091
. "$CLIENT_ENV"
export SPOTIFY_CLIENT_ID

# shellcheck disable=SC1091
. "$VENV/bin/activate" 2>/dev/null || . "$VENV/Scripts/activate"
exec python -m spotify_mcp "$@"

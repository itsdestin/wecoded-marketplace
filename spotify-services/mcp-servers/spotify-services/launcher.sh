#!/usr/bin/env bash
# spotify-services launcher — invoked by Claude Code's MCP reconciler.
# Activates the user's installed venv at ~/.spotify-services/server/ and
# runs the MCP server in stdio mode. If the venv is missing, prints a
# structured error and exits 2 — Claude surfaces this to the user with a
# "run /spotify-services-setup" hint.
set -euo pipefail

VENV="$HOME/.spotify-services/server/.venv"
if [ ! -d "$VENV" ]; then
  echo '{"error": "server_not_installed", "hint": "Run /spotify-services-setup to install the Spotify MCP server."}' >&2
  exit 2
fi

# shellcheck disable=SC1091
. "$VENV/bin/activate"
exec python -m spotify_mcp "$@"

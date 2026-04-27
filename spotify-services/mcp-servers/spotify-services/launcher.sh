#!/usr/bin/env bash
# spotify-services launcher — invoked by Claude Code's MCP reconciler.
#
# Two design decisions worth knowing:
#
# 1. We do NOT source the venv's activate script. Activate calls coreutils
#    (basename, dirname) which are at /usr/bin/ on Git Bash; Claude Code's
#    spawn passes a stripped PATH that omits /usr/bin, so activate fails
#    with "basename: command not found". Calling the venv's python.exe by
#    absolute path achieves the same effect (right interpreter + right
#    site-packages) without the PATH dependency.
#
# 2. We still set VIRTUAL_ENV explicitly. Some libraries (e.g. spotipy's
#    internal uses) inspect this env var; setting it preserves the
#    behavior an `activate` would have given.
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

# Locate the venv's python interpreter. Unix venvs put it at bin/python;
# Windows venvs put it at Scripts/python.exe.
PYTHON="$VENV/bin/python"
[ -x "$PYTHON" ] || PYTHON="$VENV/Scripts/python.exe"
if [ ! -x "$PYTHON" ]; then
  echo '{"error":"venv_python_missing","hint":"Run /spotify-services-setup to reinstall the server."}' >&2
  exit 2
fi

export VIRTUAL_ENV="$VENV"
exec "$PYTHON" -m spotify_mcp "$@"

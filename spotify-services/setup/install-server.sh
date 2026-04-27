#!/usr/bin/env bash
# install-server.sh — install the spotify-services Python MCP server to
# ~/.spotify-services/server/. Idempotent: re-runs upgrade in place.
set -euo pipefail

PLUGIN_DIR="${PLUGIN_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
TARGET="$HOME/.spotify-services/server"

if ! command -v uv >/dev/null 2>&1; then
  echo "ERROR: uv not on PATH. Install with: pipx install uv" >&2
  exit 1
fi

# Python is provided via uv ('uv venv --python 3.12' fetches it if needed),
# so we do NOT require python3.12 / python3 / python on PATH. On Windows, the
# 'python3' command often resolves to a Microsoft Store stub that prints an
# install hint and exits non-zero — checking for it would falsely fail.

# Copy server source. Avoid rsync (not on PATH in Git-Bash by default).
# tar | tar gives us preserved perms across platforms without the dep.
mkdir -p "$TARGET"
( cd "$PLUGIN_DIR/server" && tar cf - --exclude='.venv' --exclude='__pycache__' --exclude='*.egg-info' --exclude='.pytest_cache' . ) | ( cd "$TARGET" && tar xf - )

cd "$TARGET"
uv venv .venv --python 3.12

# Activate platform-appropriate venv. shell type determines path.
if [ -f .venv/bin/activate ]; then
  # shellcheck disable=SC1091
  . .venv/bin/activate
else
  # shellcheck disable=SC1091
  . .venv/Scripts/activate
fi

# Install with platform-specific extras.
case "$(uname -s)" in
  CYGWIN*|MINGW*|MSYS*) uv pip install -e ".[windows]" ;;
  *) uv pip install -e "." ;;
esac

echo "  ✓ Spotify MCP server installed at $TARGET"

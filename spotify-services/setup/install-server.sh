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
if ! command -v python3.12 >/dev/null 2>&1 && ! python3 -c 'import sys; sys.exit(0 if sys.version_info>=(3,12) else 1)'; then
  echo "ERROR: Python 3.12+ required." >&2
  exit 1
fi

mkdir -p "$TARGET"
# Copy server source into the target.
rsync -a --delete "$PLUGIN_DIR/server/" "$TARGET/"

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

#!/usr/bin/env bash
# smoke-test.sh — verifies the server can authenticate, talk to Web API,
# and detect the local backend (when applicable).
set -euo pipefail

VENV="$HOME/.spotify-services/server/.venv"
CLIENT_ENV="$HOME/.youcoded/spotify-services/client.env"

# shellcheck disable=SC1091
. "$CLIENT_ENV"
export SPOTIFY_CLIENT_ID

# shellcheck disable=SC1091
. "$VENV/bin/activate" 2>/dev/null || . "$VENV/Scripts/activate"

python - << 'PY'
import asyncio, json, sys
from spotify_mcp.tools.webapi_tools import _client
from spotify_mcp.local import select_backend

async def main():
    failures = 0

    # 1. Web API user.profile
    try:
        sp = _client()
        u = sp.current_user()
        print(f"  ✓ Authenticated as {u.get('display_name') or u.get('id')}")
    except Exception as e:
        print(f"  ✗ Web API auth failed: {e}", file=sys.stderr)
        failures += 1

    # 2. Local backend (if available)
    b = select_backend()
    if b is None:
        print("  - No local backend on this OS (v1: macOS + Windows)")
    else:
        running = await b.is_running()
        print(f"  ✓ Local backend ({b.name}): "
              f"{'desktop app running' if running else 'desktop app not running'}")

    sys.exit(failures)

asyncio.run(main())
PY

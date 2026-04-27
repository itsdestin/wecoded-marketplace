#!/usr/bin/env bash
# ingest-oauth.sh — runs the PKCE OAuth flow.
#
# Usage: ingest-oauth.sh <CLIENT_ID>
#   - Generates PKCE pair
#   - Starts a local HTTP listener on 127.0.0.1:8080
#   - Opens the Spotify authorize URL in the user's browser
#   - Captures the code from the redirect
#   - Exchanges for tokens via the server's auth.py
#   - Writes ~/.youcoded/spotify-services/tokens.json (mode 600)
#   - Writes ~/.youcoded/spotify-services/client.env with SPOTIFY_CLIENT_ID
set -euo pipefail

CLIENT_ID="${1:-}"
if [ -z "$CLIENT_ID" ]; then
  echo "Usage: $0 <CLIENT_ID>" >&2
  exit 1
fi

VENV="$HOME/.spotify-services/server/.venv"
if [ ! -d "$VENV" ]; then
  echo "ERROR: Server not installed. Run install-server.sh first." >&2
  exit 1
fi

# shellcheck disable=SC1091
. "$VENV/bin/activate" 2>/dev/null || . "$VENV/Scripts/activate"

mkdir -p "$HOME/.youcoded/spotify-services"

# Drive the flow via a one-shot Python helper.
# PYTHONIOENCODING=utf-8 forces UTF-8 stdout/stderr — Git-Bash on Windows
# defaults Python's stdout to cp1252, which crashes on the ✓ glyph below.
PYTHONIOENCODING=utf-8 python - "$CLIENT_ID" << 'PY'
import sys, secrets, threading, webbrowser, http.server, urllib.parse
from spotify_mcp.auth import PkcePair, build_authorize_url, exchange_code_for_tokens, TokenStore
from spotify_mcp.config import REDIRECT_URI, SECRETS_DIR

CLIENT_ID = sys.argv[1]
SECRETS_DIR.mkdir(parents=True, exist_ok=True)

pair = PkcePair.generate()
state = secrets.token_urlsafe(16)

captured = {}

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a, **kw): pass
    def do_GET(self):
        q = urllib.parse.urlparse(self.path).query
        params = dict(urllib.parse.parse_qsl(q))
        captured.update(params)
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        self.wfile.write(b"<h1>You can close this tab.</h1>")
        threading.Thread(target=self.server.shutdown, daemon=True).start()

# REDIRECT_URI is http://127.0.0.1:8080/callback
host, port = "127.0.0.1", 8080
srv = http.server.HTTPServer((host, port), Handler)
url = build_authorize_url(client_id=CLIENT_ID, state=state, pkce=pair)

print(f"  ✓ Opening browser for Spotify authorization …")
webbrowser.open(url)
srv.serve_forever()

if captured.get("state") != state:
    print("ERROR: state mismatch — aborting.", file=sys.stderr); sys.exit(2)
if "code" not in captured:
    print(f"ERROR: no code in callback: {captured}", file=sys.stderr); sys.exit(2)

try:
    tokens = exchange_code_for_tokens(
        client_id=CLIENT_ID, code=captured["code"], verifier=pair.verifier,
    )
except Exception as e:
    # Code review note (Phase 3): exchange_code_for_tokens uses raise_for_status
    # rather than the AuthError pattern. Wrap in a friendly error here so the
    # script doesn't dump a Python traceback.
    print(f"ERROR: token exchange failed: {e}", file=sys.stderr)
    sys.exit(2)

TokenStore().save(tokens)

# Persist Client ID for the launcher.
client_env = SECRETS_DIR / "client.env"
client_env.write_text(f"SPOTIFY_CLIENT_ID={CLIENT_ID}\n")
import os; os.chmod(client_env, 0o600)
print(f"  ✓ Tokens saved to {SECRETS_DIR}/tokens.json")
PY

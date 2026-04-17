#!/usr/bin/env bash
# reauth.sh
# Invoked by Claude (not by the user) when a skill signals AUTH_EXPIRED.
# Reuses the OAuth client credentials written during initial setup.
# Exit 0 on success, 1 on failure (user closed browser, network error, etc).

set -u

CREDS_FILE="$HOME/.youcoded/google-services/oauth-credentials.json"
ENV_FILE="$HOME/.youcoded/google-services/client.env"

if [ ! -f "$CREDS_FILE" ]; then
  echo "No saved Google setup found. Run /google-services-setup first." >&2
  exit 1
fi

# Prefer the pre-parsed env file written by ingest-oauth-json.sh — it lets us
# skip the Python round-trip on reauth, which runs whenever a token expires.
# Fall back to parsing the JSON directly for installs that predate client.env.
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
else
  PYTHON=$(command -v python3 || command -v python || command -v py) || {
    echo "Python 3 is required but was not found." >&2
    exit 1
  }
  CLIENT_ID=$("$PYTHON" - <<PY "$CREDS_FILE"
import json, sys
print(json.load(open(sys.argv[1]))["installed"]["client_id"])
PY
)
  CLIENT_SECRET=$("$PYTHON" - <<PY "$CREDS_FILE"
import json, sys
print(json.load(open(sys.argv[1]))["installed"]["client_secret"])
PY
)
fi

# gws auth setup re-runs the browser OAuth flow using the provided credentials.
# The exact flag surface is version-sensitive; adjust if the pinned gws version
# uses a different entry point (see spec's "Implementer notes" under Auto-reauth).
gws auth setup \
  --client-id "$CLIENT_ID" \
  --client-secret "$CLIENT_SECRET" \
  --non-interactive-confirm \
  || exit 1

exit 0

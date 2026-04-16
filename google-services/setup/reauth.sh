#!/usr/bin/env bash
# reauth.sh
# Invoked by Claude (not by the user) when a skill signals AUTH_EXPIRED.
# Reuses the OAuth client credentials written during initial setup.
# Exit 0 on success, 1 on failure (user closed browser, network error, etc).

set -u

CREDS_FILE="$HOME/.youcoded/google-services/oauth-credentials.json"

if [ ! -f "$CREDS_FILE" ]; then
  echo "No saved Google setup found. Run /google-services-setup first." >&2
  exit 1
fi

CLIENT_ID=$(python - <<PY "$CREDS_FILE"
import json, sys
print(json.load(open(sys.argv[1]))["client_id"])
PY
)
CLIENT_SECRET=$(python - <<PY "$CREDS_FILE"
import json, sys
print(json.load(open(sys.argv[1]))["client_secret"])
PY
)

# gws auth setup re-runs the browser OAuth flow using the provided credentials.
# The exact flag surface is version-sensitive; adjust if the pinned gws version
# uses a different entry point (see spec's "Implementer notes" under Auto-reauth).
gws auth setup \
  --client-id "$CLIENT_ID" \
  --client-secret "$CLIENT_SECRET" \
  --non-interactive-confirm \
  || exit 1

exit 0

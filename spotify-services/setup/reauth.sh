#!/usr/bin/env bash
# reauth.sh — re-runs the OAuth flow when refresh fails.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CLIENT_ENV="$HOME/.youcoded/spotify-services/client.env"

if [ ! -f "$CLIENT_ENV" ]; then
  echo "ERROR: No prior setup. Run /spotify-services-setup." >&2
  exit 1
fi
# shellcheck disable=SC1091
. "$CLIENT_ENV"
exec "$HERE/ingest-oauth.sh" "$SPOTIFY_CLIENT_ID"

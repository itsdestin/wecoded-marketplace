#!/usr/bin/env bash
# reauth.sh
# Invoked by Claude (not by the user) when a skill signals AUTH_EXPIRED.
# Re-runs the browser OAuth flow using the credentials ingest-oauth-json.sh
# wrote to gws's expected path. Exit 0 on success, 1 on failure (user closed
# browser, network error, no credentials saved, etc).

set -u

GWS_CREDS="$HOME/.config/gws/client_secret.json"

if [ ! -f "$GWS_CREDS" ]; then
  echo "No saved Google setup found. Run /google-services-setup first." >&2
  exit 1
fi

# `gws auth login` reads the OAuth client from $HOME/.config/gws/client_secret.json
# by default (0.22.5). No --client-id/--client-secret flags exist on this
# subcommand — earlier drafts of reauth.sh used `gws auth setup --client-id`,
# which is wrong: `gws auth setup` is for creating the GCP project + OAuth
# client from scratch (requires gcloud) and doesn't take those flags.
gws auth login || exit 1

exit 0

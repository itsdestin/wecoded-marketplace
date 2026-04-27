---
name: spotify-services-reauth
description: "Re-run Spotify OAuth when refresh tokens have been revoked."
---

# /spotify-services-reauth

Runs `setup/reauth.sh`, which reads the persisted Client ID and re-runs the
OAuth flow. Use this when:

- A tool returns `{"error": "reauth_required"}`
- The user changed their Spotify password
- It's been > 1 year since last auth (long-tail token invalidation)

Steps:

1. Run `setup/reauth.sh`.
2. Wait for browser flow.
3. Run `setup/smoke-test.sh` to confirm.

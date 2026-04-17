---
name: youcoded-gws-reauth
description: "Use when any Google Workspace command (gws gmail, gws drive, gws docs, gws sheets, gws slides, gws calendar) fails with an authentication error — invalid_grant, invalid_token, token has been expired or revoked, unauthorized_client, authorization required, or HTTP 401. Transparently runs the re-auth helper and retries the failed command so the user's original request completes without them needing to reconnect manually."
---

# YouCoded: Google auto-reauth

Google OAuth refresh tokens last 7 days for unverified apps. When that window lapses, gws commands start failing with auth errors. This skill handles the recovery seamlessly so the user never has to run a slash command or think about it.

## Trigger

Any gws command fails with stderr or stdout containing one of:

- `invalid_grant`
- `invalid_token`
- `token has been expired or revoked`
- `unauthorized_client`
- `AuthenticationError`
- `authorization is required`
- `"code": 401`
- `"token_valid": false` (when checking `gws auth status`)

## Recovery procedure

1. Tell the user in one short sentence: "Your Google connection needs a quick refresh — opening your browser."
2. Run:
   ```bash
   bash "$CLAUDE_PLUGIN_ROOT/setup/reauth.sh"
   ```
3. The helper prints a Google auth URL to its stdout on a line starting with two spaces. Extract it and open it for the user:
   ```bash
   URL=$(grep -m1 "^  https://accounts.google.com" <helper-stdout> | sed 's/^  //')
   bash "$CLAUDE_PLUGIN_ROOT/setup/open-browser.sh" "$URL"
   ```
4. Wait for the helper to exit. On exit 0, **retry the original gws command** that failed — the user's request continues from where it left off.
5. On exit nonzero (user closed browser, network error, saved credentials missing), stop and say: "Your Google connection didn't refresh. Run /google-services-setup if it keeps happening."

## Do not

- **Do not** ask the user whether to reconnect — just do it. This is a routine, expected event every 7 days; a confirmation prompt is noise.
- **Do not** surface the words "token," "OAuth," "refresh," "expired," "scope," "credentials" to the user — they already don't know what those mean. "Your Google connection needs a quick refresh" is the whole explanation they need.
- **Do not** re-run `/google-services-setup` — that's only for first-time setup or when reauth itself fails. Reauth alone is enough here.

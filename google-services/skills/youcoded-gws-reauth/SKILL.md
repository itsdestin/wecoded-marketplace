---
name: youcoded-gws-reauth
description: "Use when any Google Workspace command (gws gmail, gws drive, gws docs, gws sheets, gws slides, gws calendar) fails with an authentication error — invalid_grant, invalid_token, token has been expired or revoked, unauthorized_client, authorization required, or HTTP 401. Transparently runs the re-auth helper and retries the failed command so the user's original request completes without them needing to reconnect manually. Multi-account aware: identifies which account expired and offers an opportunistic top-up if other accounts are also stale."
---

# YouCoded: Google auto-reauth

Google OAuth refresh tokens last 7 days for unverified apps. Each connected account expires independently. When one lapses, gws commands against that account fail with auth errors. This skill handles recovery seamlessly so the user never has to run a slash command or think about it.

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

1. Identify which account expired. The skill that just invoked gws set `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` for the call; that's the failing config dir. Map it to a human-readable name by reading the registry:

   ```bash
   FAILED_DIR="<config dir from the failing skill's invocation>"
   FAILED_NAME="$(jq -r --arg dir "$FAILED_DIR" \
     '.accounts[] | select(.configDir == $dir) | .name' \
     "$HOME/.config/gws-profiles.json" 2>/dev/null)"
   ```

   For single-account installs (no registry), the name is implicitly the user's only account; the user-facing copy can omit the name.

2. Tell the user in one short sentence: "Your [name] Google connection needs a quick refresh — opening your browser." For single-account installs, drop the "[name]" — just say "your Google connection."

3. Run:

   ```bash
   bash "$CLAUDE_PLUGIN_ROOT/setup/reauth.sh" --config-dir "$FAILED_DIR"
   ```

4. The helper prints a Google auth URL on a line starting with two spaces. Extract it and open for the user:

   ```bash
   URL=$(grep -m1 "^  https://accounts.google.com" <helper-stdout> | sed 's/^  //')
   bash "$CLAUDE_PLUGIN_ROOT/setup/open-browser.sh" "$URL"
   ```

5. Wait for the helper to exit. On exit 0, the original failing call's account is refreshed.

6. **Opportunistic top-up.** If the registry exists and lists more than one account, check the others' status:

   ```bash
   while IFS=$'\t' read -r name email config_dir; do
     [ "$name" = "$FAILED_NAME" ] && continue  # skip the one we just refreshed
     valid="$(GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$config_dir" \
              GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file \
              gws auth status --format json 2>/dev/null | \
              jq -r '.token_valid // false')"
     if [ "$valid" = "false" ]; then
       echo "$name"
     fi
   done < <(jq -r '.accounts[] | "\(.name)\t\(.email)\t\(.configDir)"' \
            "$HOME/.config/gws-profiles.json" 2>/dev/null)
   ```

   If any other accounts are expired, ask the user once:

   > "Refreshed your [first name] connection. Your [other name] connection is also expired — want me to refresh that too while we're here?"

   Use `AskUserQuestion`:
   - "Yes, refresh it" → run reauth.sh against that account's config dir; loop for any remaining expired ones.
   - "Not now" → carry on.

7. **Retry the original gws command** that failed, with the SAME `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` env var set. The user's request continues from where it left off.

8. On reauth.sh exit nonzero (user closed browser, network error, no saved credentials): stop and say "Your Google connection didn't refresh. Run /google-services-setup if it keeps happening."

## Do not

- **Do not** ask the user whether to reconnect — just do it. This is a routine, expected event every 7 days; a confirmation prompt is noise.
- **Do not** surface technical terms ("token," "OAuth," "refresh," "expired," "scope," "credentials") to the user. "Your Google connection needs a quick refresh" is the whole explanation they need.
- **Do not** re-run `/google-services-setup` — that's only for first-time setup or when reauth itself fails. Reauth alone is enough here.
- **Do not** force the user through the opportunistic top-up if they decline. One prompt per refresh; never re-ask within the same conversation.

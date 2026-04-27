---
name: spotify-services-setup
description: "Install the Spotify MCP server, register a Spotify Developer app, and complete OAuth."
---

# /spotify-services-setup

Drives the spotify-services first-time setup conversationally. Steps:

1. **Verify prerequisites.** Check `python3.12` and `uv` on PATH. If missing,
   stop and tell the user how to install them.
2. **Install the server.** Run `setup/install-server.sh`. Echo each `  ✓` line.
3. **Walk the developer-app registration.** Open `setup/register-app.md` in the
   user's preferred reader. Wait for them to paste back their Client ID.
4. **Run OAuth.** Run `setup/ingest-oauth.sh "<CLIENT_ID>"`. The browser will
   open; user authorizes; we capture the code.
5. **Hint at app restart.** Tell the user to restart Claude Code or refresh
   plugins so the MCP reconciler picks up the new server. (`/reload-plugins` works.)
6. **Run the smoke test.** Run `setup/smoke-test.sh`. Report results.
7. **Tell the user what to try first.** Suggest: "Ask Claude to show your top 5
   tracks of the last month."

## Premium reminder

Surface this prominently before step 4: "Spotify's 2026 platform-security
update means apps in Development Mode require the authorizing user to have
Premium. If you don't have Premium, the OAuth flow will fail with an error."

## Errors

If `install-server.sh` fails: surface stderr, suggest `pipx install uv` if uv
is missing.

If `ingest-oauth.sh` fails with "state mismatch" or "no code": something
intercepted the redirect. Re-run.

If smoke-test fails: capture stderr and offer to run `/spotify-services-reauth`.

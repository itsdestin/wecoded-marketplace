# Spotify Services

Spotify Web API + native local desktop control for any Claude Code project.

## What this plugin gives Claude

- **Search** tracks, albums, artists, playlists.
- **Read** your library: saved tracks, recently played, top tracks/artists.
- **Manage** playlists: list, view items, add/remove/reorder tracks, edit details.
- **Control playback** via Spotify Premium (transport, queue, volume, repeat/shuffle, device transfer).
- **Local desktop control** (macOS + Windows) — pause, skip, see what's playing, all without API calls.

## Requirements

- **Spotify Premium account.** Required for the entire plugin under Spotify's current developer-app rules (Feb 2026 platform-security update).
- **`uv` on PATH** (https://github.com/astral-sh/uv). uv self-manages Python — you do NOT need Python 3.12 installed system-wide. Setup will tell you if `uv` is missing.
- **macOS or Windows.** Linux (MPRIS) and Android (vendored Python deps) are deferred to v2.

## First-time setup

```bash
/spotify-services-setup
```

The walkthrough will:
1. Install the Python MCP server to `~/.spotify-services/server/`.
2. Walk you through registering your own Spotify Developer app (you keep the credentials; nothing is shared with this plugin).
3. Run the OAuth flow once and store tokens at `~/.youcoded/spotify-services/tokens.json` (mode 600).
4. Run a smoke test against your account.

## Re-authentication

```bash
/spotify-services-reauth
```

Use this if Spotify revokes your tokens (rare — happens after long inactivity or password change).

## Privacy

- **Your Spotify Developer app, your credentials.** This plugin contains no Client IDs, Client Secrets, or hardcoded keys. You register your own app at developer.spotify.com.
- **Tokens stay local.** `~/.youcoded/spotify-services/tokens.json`, mode 600.
- **PKCE flow.** No client secret needed; the auth code never travels through any third-party server.

## Deferred (not in v1)

- Linux MPRIS local control.
- Android (Termux Python lacks `pip`/`uv`; v2 will vendor deps).
- Podcasts / shows / episodes / audiobooks.
- Real-time playback monitoring (long-running streams).

## Troubleshooting

If a tool returns `{"error": "reauth_required"}`, run `/spotify-services-reauth`.
If a tool returns `{"error": "server_not_installed"}`, run `/spotify-services-setup`.
If a tool returns `{"error": "premium_required"}`, your Spotify account is on the free tier — the plugin can't help you on Spotify's side.

For deeper diagnostics: `bash ~/.spotify-services/server/setup/smoke-test.sh`.

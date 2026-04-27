# Register your Spotify Developer App

Spotify requires every API user to register their own developer app. The
plugin contains no shared credentials — your Client ID is yours alone.

## Prerequisites

- A **Spotify Premium** account (required for app authorization in 2026+).
- 5 minutes.

## Steps

1. Go to https://developer.spotify.com/dashboard
2. Sign in with your Spotify account.
3. Click **Create app**.
4. Fill in:
   - **App name:** YouCoded Local (or any name you'll recognize)
   - **App description:** Local Claude Code integration
   - **Website:** can be blank
   - **Redirect URI:** `http://127.0.0.1:8080/callback` (exact)
   - **Which API/SDKs are you planning to use:** check **Web API** only.
5. Agree to the developer terms; click **Save**.
6. On the app page, click **Settings**.
7. Copy the **Client ID** — you'll paste it back to the setup wizard.
8. **Do NOT need a Client Secret** — we use PKCE.

## Scopes

The setup wizard will request the following scopes when you authorize. Each
gives the plugin specific abilities:

- `user-read-private`, `user-read-email` — read your profile
- `playlist-read-private`, `playlist-read-collaborative` — read your playlists
- `playlist-modify-public`, `playlist-modify-private` — edit your playlists
- `user-library-read`, `user-library-modify` — read and manage your saved items
- `user-top-read`, `user-read-recently-played` — read top/recent listening
- `user-read-playback-state`, `user-read-currently-playing` — see what's playing
- `user-modify-playback-state` — control playback (play/pause/skip)

You can opt out of any of these at the Spotify auth screen; tools that need
the missing scope will return `{"error": "scope_missing"}`.

## Dev Mode quota (post-Feb-2026 reality)

By default, your app is in **Development Mode**:
- Capped at **5 authorized users** total.
- The user authorizing must have **Spotify Premium**.
- Some endpoints are restricted (the plugin only uses non-restricted ones).

For personal use this is fine. To raise these caps, you can apply for
Extended Quota at https://developer.spotify.com/extended-quota — typically
not needed unless you're sharing the app's Client ID with friends.

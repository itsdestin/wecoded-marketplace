---
name: spotify-shared
description: "Spotify Services: Shared reference for auth, errors, smart routing, and tool discovery. Read once at start of any Spotify task."
metadata:
  version: 0.1.0
  openclaw:
    category: "integrations"
    requires:
      bins:
        - python3.12
---

# Spotify Services — Shared Reference

## Authentication

The plugin uses Spotify's Authorization Code with PKCE flow. Tokens persist
at `~/.youcoded/spotify-services/tokens.json` (mode 600). The MCP server
auto-refreshes access tokens within 5 minutes of expiry.

If a tool returns `{"error": "reauth_required"}`, run `/spotify-services-reauth`.

## Premium requirement

Spotify's Feb 2026 platform-security update requires the authorizing user to
have Premium for any app not granted Extended Quota. **The plugin therefore
assumes Premium for all users.** Free-tier users will see `{"error":
"premium_required"}` on most calls.

## Smart routing convention

The plugin exposes three tool tiers:

- **Smart-routed (`now_playing`, `play_pause_smart`):** picks local or Web
  API automatically. **Use these by default.**
- **Local-only (`local.*`):** raw macOS/Windows desktop control. No auth,
  no API budget. Use when the desktop app is what you want to control,
  regardless of Web API state.
- **Web-API-only (`search.*`, `playlists.*`, `library.*`, `playback.*`,
  `queue.*`, `user.*`):** the canonical Web API surface. Use for reads,
  playlist edits, and library mutations.

## Error shapes

Every tool error is a JSON object with at least `{"error": "<code>"}`:

| Code | Meaning | What to do |
|------|---------|------------|
| `reauth_required` | Refresh token revoked or no tokens on disk | `/spotify-services-reauth` |
| `premium_required` | Operation needs Premium and user is free-tier | Inform the user |
| `scope_missing` | Token lacks scope; user opted out at first auth | `/spotify-services-reauth` to re-prompt for full scope |
| `rate_limited` | 429 after one retry; payload includes `retry_after_s` | Back off and tell the user |
| `local_backend_unavailable` | No macOS/Windows backend present (e.g., Linux) | Use Web API tools only |
| `desktop_app_not_running` | Local tool called but Spotify isn't open | Suggest opening Spotify, or fall back to Web API |
| `not_supported` | Local backend doesn't implement this op (e.g., Windows seek) | Use Web API equivalent |
| `not_found` | 404 on Web API | Inspect the ID/URI |
| `bad_request` | 400 on Web API | Inspect arguments |
| `upstream_error` | Other upstream failure | Surface message and consider retry |

## Pagination

Tools that wrap paginated endpoints (e.g., `playlists.list_mine`,
`library.saved_tracks`) accept `limit` and `offset`. They DO NOT auto-paginate
by default — pass `limit` to control page size and call iteratively if you
need everything.

The composite tool `export_all_playlists` IS a one-shot full-library export;
use it instead of looping when you need every playlist + every track.

## Removed endpoints (post-Feb-2026)

Do not attempt these — Spotify removed them. The plugin does not expose tools
for any of them; these are listed so you know not to suggest workarounds:

- Create Playlist for user (was `POST /users/{id}/playlists`)
- Get Artist's Top Tracks
- Get Several Albums / Artists / Tracks (all batch GETs)
- Audio Features / Audio Analysis / Recommendations / Related Artists (Nov 2024)
- Get New Releases / Categories / Markets

If a user asks for one of these, explain that Spotify removed it and suggest
an alternative if one exists (e.g., "we can list your playlists instead of
creating one programmatically").

## Tool naming convention

`namespace.action` (lowercase dotted). Common namespaces:

- `local.*` — local desktop control
- `search.*` — Web API search
- `library.*`, `playlists.*`, `playback.*`, `queue.*`, `user.*` — Web API
- `now_playing`, `play_pause_smart`, `export_all_playlists` — smart/composite (no namespace)

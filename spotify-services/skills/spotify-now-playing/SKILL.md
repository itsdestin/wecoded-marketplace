---
name: spotify-now-playing
description: "Spotify Services: What is the user currently listening to? Smart-routed (local instant, optional Web API enrichment)."
metadata:
  version: 0.1.0
  openclaw:
    category: "integrations"
---

# Now Playing (Smart-Routed)

Fetch the currently playing track with instant local response. Optionally enrich
with Web API metadata (Spotify URI, ISRC code) for use in queue/library operations.

## When to use this

- "What am I listening to right now?"
- "Show me the current song info"
- "Get the Spotify URI for the song playing now so I can share it"

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `now_playing` | `enrich: bool = false` — when true, follow up with Web API for track URI + ISRC; default false for instant local read | `{name, artist, album, duration_ms, position_ms, backend, enriched: bool, spotify_uri?: str, isrc?: str}` or error |

## Examples

### Example 1: Quick check (local instant)

User says: "What's playing right now?"
Claude calls: `now_playing` with `{"enrich": false}`.
Returns: `{name: "Blinding Lights", artist: "The Weeknd", album: "After Hours", duration_ms: 200000, position_ms: 45000, backend: "local", enriched: false}`.

### Example 2: Get full metadata for sharing

User says: "Get the Spotify URI for the song playing so I can share it"
Claude calls: `now_playing` with `{"enrich": true}`.
Returns: `{name: "Blinding Lights", artist: "The Weeknd", album: "After Hours", duration_ms: 200000, position_ms: 45000, backend: "local", enriched: true, spotify_uri: "spotify:track:...", isrc: "USUM72026776"}`.

## Notes

- Default `enrich: false` returns data instantly from the local desktop app (no API call)
- Set `enrich: true` to get Spotify URI and ISRC for use in queue/library operations
- `backend` field indicates whether the local app or Web API was the source
- **Premium NOT required** — unlike Web API reads, local now_playing works on free-tier

## Errors

This skill can return any of the standard errors documented in `spotify-shared`.
Common ones for this skill:

- `desktop_app_not_running` — Spotify app is not open; try opening it
- `local_backend_unavailable` — not on macOS/Windows; fall back to Web API tools

## See also

- `spotify-shared` — auth, error shapes, smart routing
- `spotify-playback` — control play/pause/skip from now_playing context
- `spotify-queue` — add the now-playing track to another device's queue

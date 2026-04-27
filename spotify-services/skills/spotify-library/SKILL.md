---
name: spotify-library
description: "Spotify Services: Read and modify the user's library — saved tracks, top tracks/artists, recently played, save/remove items."
metadata:
  version: 0.1.0
  openclaw:
    category: "integrations"
---

# Library

Read your saved tracks, top tracks and artists, recently played history. Also
save and remove items from your library. Library operations use generic Spotify
URIs (not limited to tracks).

## When to use this

- "Show my saved tracks"
- "What are my top songs of all time?"
- "List my top artists"
- "Show recently played"
- "Add this track to my library"
- "Remove a song from my saved tracks"

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `library.saved_tracks` | `limit: int = 20`, `offset: int = 0` | `{items: [...], total: int, limit: int, offset: int}` |
| `library.top_tracks` | `time_range: 'short_term' \| 'medium_term' \| 'long_term' = 'medium_term'`, `limit: int = 20`, `offset: int = 0` | `{items: [...], total: int}` |
| `library.top_artists` | `time_range: 'short_term' \| 'medium_term' \| 'long_term' = 'medium_term'`, `limit: int = 20`, `offset: int = 0` | `{items: [...], total: int}` |
| `library.recently_played` | `limit: int = 20` | `{items: [...], total: int}` (returns last 50 by Spotify limit) |
| `library.save` | `uris: list[str]` (Spotify URIs: `spotify:track:...`, `spotify:album:...`) | `{success: bool}` or error |
| `library.remove` | `uris: list[str]` (Spotify URIs) | `{success: bool}` or error |

## Examples

### Example 1: Get top songs

User says: "Show me my top 10 songs of all time"
Claude calls: `library.top_tracks` with `{"time_range": "long_term", "limit": 10}`.
Returns: `{items: [{name: "Song A", artist: "Artist X", ...}, ...], total: 427}`.

### Example 2: Save a track

User says: "Add the song we just talked about to my library"
Claude calls: `library.save` with `{"uris": ["spotify:track:3SDcvsCXu7kpw5T9vHhC0B"]}`.
Returns: `{success: true}`.

### Example 3: Recently played

User says: "Show what I've been listening to lately"
Claude calls: `library.recently_played` with `{"limit": 20}`.
Returns: `{items: [{name: "Track 1", artist: "Artist Y", played_at: "2026-04-26T..."}], total: 50}`.

## Notes

- Time ranges: `short_term` (last 4 weeks), `medium_term` (last 6 months), `long_term` (all time)
- Save/remove use generic Spotify URIs (tracks, albums, etc.) — not just track URIs
- Pagination: use `limit` and `offset` to iterate through results
- Recently played returns at most the last 50 tracks (Spotify API limit)

## Errors

This skill can return any of the standard errors documented in `spotify-shared`.
Common ones for this skill:

- `not_found` — a URI in save/remove does not exist
- `bad_request` — malformed URI or unsupported object type

## See also

- `spotify-shared` — auth, error shapes, smart routing
- `spotify-search` — find tracks to add to your library
- `spotify-playlists` — organize saved tracks into playlists
- `spotify-export-all-playlists` — back up your entire library

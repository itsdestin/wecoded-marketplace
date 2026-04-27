---
name: spotify-playlists
description: "Spotify Services: List, view, and edit the user's playlists. Note: Spotify removed playlist creation in Feb 2026."
metadata:
  version: 0.1.0
  openclaw:
    category: "integrations"
---

# Playlists

List, inspect, and edit your playlists. Add and remove tracks, reorder, rename,
and adjust public/collaborative status. Note: creating new playlists is not
supported (Spotify removed this endpoint in Feb 2026).

## When to use this

- "Show my playlists"
- "What tracks are in my 'Workout' playlist?"
- "Add these songs to my 'Road Trip' playlist"
- "Remove a track from my playlist"
- "Rename my playlist to something new"

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `playlists.list_mine` | `limit: int = 20`, `offset: int = 0` | `{items: [...], total: int, limit: int, offset: int}` |
| `playlists.get_items` | `playlist_id: str`, `limit: int = 20`, `offset: int = 0` | `{items: [tracks], total: int, limit: int, offset: int}` |
| `playlists.add_items` | `playlist_id: str`, `uris: list[str]` (Spotify URIs), `position: int \| None` | `{success: bool}` or error |
| `playlists.remove_items` | `playlist_id: str`, `uris: list[str]` | `{success: bool}` or error |
| `playlists.reorder` | `playlist_id: str`, `range_start: int`, `insert_before: int`, `range_length: int = 1` | `{success: bool}` or error |
| `playlists.update_details` | `playlist_id: str`, `name: str \| None`, `public: bool \| None`, `collaborative: bool \| None`, `description: str \| None` | `{success: bool}` or error |

## Examples

### Example 1: List playlists

User says: "Show my playlists"
Claude calls: `playlists.list_mine` with `{"limit": 20}`.
Returns: `{items: [{id: "pl1", name: "Road Trip", track_count: 45}, {id: "pl2", name: "Workout", track_count: 30}], total: 12}`.

### Example 2: Get playlist tracks

User says: "What songs are in my 'Workout' playlist?"
Claude calls: `playlists.get_items` with `{"playlist_id": "pl2", "limit": 20}`.
Returns: `{items: [{name: "Track 1", artist: "Artist A", ...}, ...], total: 30}`.

### Example 3: Add tracks to playlist

User says: "Add 'Eye of the Tiger' to my Workout playlist"
Claude calls first `search.query` to find the track URI, then `playlists.add_items` with `{"playlist_id": "pl2", "uris": ["spotify:track:..."]}`.
Returns: `{success: true}`.

## Notes

- **Cannot create playlists** — Spotify removed this in Feb 2026; use the Spotify app to create a playlist first
- Playlist IDs are returned from `list_mine` and embedded in playlist object URIs
- Use `update_details` to rename or change visibility (public/private/collaborative)
- Use `search.query` first if you don't already have track URIs for adding
- Pagination supported on all read operations; use `limit` and `offset`

## Errors

This skill can return any of the standard errors documented in `spotify-shared`.
Common ones for this skill:

- `not_found` — playlist or track URI does not exist
- `bad_request` — malformed arguments
- `premium_required` — some operations require Premium

## See also

- `spotify-shared` — auth, error shapes, smart routing
- `spotify-library` — manage your saved tracks separately from playlists
- `spotify-search` — find tracks to add to playlists
- `spotify-export-all-playlists` — back up all playlists at once

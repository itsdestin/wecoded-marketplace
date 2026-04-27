---
name: spotify-search
description: "Spotify Services: Search tracks, albums, artists, and playlists by query."
metadata:
  version: 0.1.0
  openclaw:
    category: "integrations"
---

# Spotify Search

Find tracks, albums, artists, and playlists by keyword. Search results include
artwork, URIs for queueing, and preview availability where applicable.

## When to use this

- "Find 'Blinding Lights' by The Weeknd"
- "Search for jazz playlists"
- "Look up the artist Billie Eilish"

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `search.query` | `query: str`, `types: list[str] = ["track"]`, `limit: int = 10`, `offset: int = 0`, `market: str \| None` | Spotify search result shape with matching items (tracks, albums, artists, playlists) |

## Examples

### Example 1: Search for a track

User says: "Find the song 'Levitating' by Dua Lipa"
Claude calls: `search.query` with `{"query": "Levitating Dua Lipa", "types": ["track"], "limit": 10}`.
Returns: `{tracks: {items: [{name: "Levitating", artist: "Dua Lipa", uri: "spotify:track:...", ...}]}}`.

### Example 2: Search for an artist

User says: "Look up artist Taylor Swift"
Claude calls: `search.query` with `{"query": "Taylor Swift", "types": ["artist"], "limit": 5}`.
Returns: `{artists: {items: [{name: "Taylor Swift", uri: "spotify:artist:...", ...}]}}`.

## Notes

- Post-Feb-2026, `limit` is capped internally at 10 by Spotify's platform-security update
- Use `offset` to paginate through results if you need pages beyond the first
- `market` filters results to a specific country (ISO 3166-1 alpha-2 code, e.g., "US")

## Errors

This skill can return any of the standard errors documented in `spotify-shared`.
Common ones for this skill:

- `bad_request` — invalid query or unsupported search type
- `rate_limited` — too many searches in a short window

## See also

- `spotify-shared` — auth, error shapes, smart routing
- `spotify-library` — read your saved tracks

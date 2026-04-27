---
name: spotify-export-all-playlists
description: "Spotify Services: Bulk-export every playlist + every track to a JSON file. Use when the user wants to snapshot their full Spotify library."
metadata:
  version: 0.1.0
  openclaw:
    category: "integrations"
---

# Export All Playlists

Snapshot your entire Spotify library — every playlist, every track, metadata,
and ordering — into a single JSON file. Useful for backups, local analysis,
migration to another service, or just offline browsing of what you've built.

## When to use this

- "Back up my Spotify library to a file"
- "Export all my playlists with their tracks"
- "Save a snapshot of my current Spotify library"

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `export_all_playlists` | `path: str` — absolute filesystem path where JSON will be written | `{written: bool, playlist_count: int, track_count: int, user_id: str}` or error |

## Examples

### Example 1: Full library export

User says: "Back up all my Spotify playlists to ~/my-spotify-backup.json"
Claude calls: `export_all_playlists` with `{"path": "/Users/alice/my-spotify-backup.json"}`.
Returns: `{written: true, playlist_count: 47, track_count: 1203, user_id: "spotify_user_123"}`.

### Example 2: Export to a specific location

User says: "Save all my playlists to my Documents folder"
Claude calls: `export_all_playlists` with `{"path": "/Users/bob/Documents/spotify-export.json"}`.
Returns: `{written: true, playlist_count: 12, track_count: 450, user_id: "spotify_user_456"}`.

## Errors

This skill can return any of the standard errors documented in `spotify-shared`.
Common ones for this skill:

- `reauth_required` — your Spotify auth is stale; run `/spotify-services-reauth`
- `rate_limited` — Spotify API is throttling; wait and try again
- `premium_required` — your account is free-tier; some endpoints require Premium

## See also

- `spotify-shared` — auth, error shapes, smart routing
- `spotify-playlists` — query and edit individual playlists
- `spotify-library` — read and manage library favorites

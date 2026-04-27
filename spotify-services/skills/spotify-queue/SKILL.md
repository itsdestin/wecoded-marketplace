---
name: spotify-queue
description: "Spotify Services: View the playback queue and add tracks to it. Premium required to add."
metadata:
  version: 0.1.0
  openclaw:
    category: "integrations"
---

# Queue

View what's playing next and programmatically add tracks to the queue. Queue
operations require a Spotify URI (obtainable from search results or track metadata).

## When to use this

- "Show me what's up next in the queue"
- "Add this song to the queue"
- "Queue up the track I just searched for"

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `queue.list` | (none) | `{currently_playing: {...}, queue: [...]}`  — both may be `null` if nothing is queued |
| `queue.add` | `uri: str` (Spotify track URI), `device_id: str \| None` | `{success: bool}` or error |

## Examples

### Example 1: Check the queue

User says: "What's in the queue right now?"
Claude calls: `queue.list` with `{}`.
Returns: `{currently_playing: {name: "Blinding Lights", artist: "The Weeknd", ...}, queue: [{name: "Levitating", ...}, {name: "Shut Up and Dance", ...}]}`.

### Example 2: Add a track to the queue

User says: "Add 'Levitating' by Dua Lipa to the queue"
Claude calls first `search.query` to find the track URI, then `queue.add` with `{"uri": "spotify:track:3SDcvsCXu7kpw5T9vHhC0B"}`.
Returns: `{success: true}`.

## Notes

- Read queue without adding is free-tier compatible
- Adding to queue requires Premium
- `uri` must be a valid Spotify track URI (format: `spotify:track:<id>`)
- Use `search.query` first if you don't already have the URI
- `device_id` is optional; `null` targets the currently active device

## Errors

This skill can return any of the standard errors documented in `spotify-shared`.
Common ones for this skill:

- `premium_required` — adding to queue requires Premium; reading is free
- `bad_request` — malformed or non-track URI
- `not_found` — track URI does not exist

## See also

- `spotify-shared` — auth, error shapes, smart routing
- `spotify-search` — find tracks and get their URIs for queueing
- `spotify-playback` — control play/pause/skip
- `spotify-devices` — see which device the queue belongs to

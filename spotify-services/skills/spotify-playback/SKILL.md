---
name: spotify-playback
description: "Spotify Services: Control Spotify playback — play, pause, skip, seek, volume, repeat, shuffle. Premium required for Web API path."
metadata:
  version: 0.1.0
  openclaw:
    category: "integrations"
---

# Playback Control

Play, pause, skip forward/backward, seek to a position, adjust volume, toggle
shuffle and repeat modes. Works via smart routing (local desktop when available,
falls back to Web API) or direct Web API calls.

## When to use this

- "Play the music"
- "Pause Spotify"
- "Skip to the next track"
- "Seek to 2 minutes into the song"
- "Set volume to 50%"
- "Turn on shuffle"

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `play_pause_smart` | `action: 'play' \| 'pause' \| 'next' \| 'previous'` | `{success: bool, message: str}` or error |
| `playback.play` | `device_id: str \| None` | `{success: bool}` or error |
| `playback.pause` | `device_id: str \| None` | `{success: bool}` or error |
| `playback.next` | `device_id: str \| None` | `{success: bool}` or error |
| `playback.previous` | `device_id: str \| None` | `{success: bool}` or error |
| `playback.seek` | `position_ms: int`, `device_id: str \| None` | `{success: bool}` or error |
| `playback.set_volume` | `volume_percent: int` (0-100), `device_id: str \| None` | `{success: bool}` or error |
| `playback.set_repeat` | `state: 'off' \| 'track' \| 'context'`, `device_id: str \| None` | `{success: bool}` or error |
| `playback.set_shuffle` | `state: bool`, `device_id: str \| None` | `{success: bool}` or error |

## Examples

### Example 1: Smart-routed skip (preferred)

User says: "Skip to the next song"
Claude calls: `play_pause_smart` with `{"action": "next"}`.
Returns: `{success: true, message: "Skipped to next track"}`.

### Example 2: Seek via Web API

User says: "Seek to 1 minute and 30 seconds"
Claude calls: `playback.seek` with `{"position_ms": 90000}`.
Returns: `{success: true}`.

### Example 3: Set volume

User says: "Turn the volume up to 75%"
Claude calls: `playback.set_volume` with `{"volume_percent": 75}`.
Returns: `{success: true}`.

## Notes

- **Use `play_pause_smart` by default** for play/pause/skip — it picks the right backend
- Namespaced tools (`playback.*`) route only to Web API and require Premium
- `device_id` selects which device; `null` uses the currently active device
- Volume is 0-100 (percentage)
- Repeat states: `off`, `track` (repeat one), `context` (repeat playlist/album)

## Errors

This skill can return any of the standard errors documented in `spotify-shared`.
Common ones for this skill:

- `premium_required` — Web API playback control needs Premium
- `desktop_app_not_running` — local smart-routed call failed because Spotify isn't open
- `not_supported` — local backend doesn't implement this operation (e.g., Windows seek)

## See also

- `spotify-shared` — auth, error shapes, smart routing
- `spotify-now-playing` — get current playback state before controlling
- `spotify-devices` — list devices and transfer playback between them
- `spotify-queue` — add tracks to be played next

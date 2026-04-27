---
name: spotify-devices
description: "Spotify Services: List Spotify-connected devices and transfer playback between them."
metadata:
  version: 0.1.0
  openclaw:
    category: "integrations"
---

# Devices

List all devices connected to your Spotify account and transfer playback between
them. Useful for controlling which speaker, phone, or computer is playing your
music.

## When to use this

- "What devices do I have connected to Spotify?"
- "Switch playback to my phone"
- "Transfer music to the living room speaker"

## Tools

| Tool | Args | Returns |
|------|------|---------|
| `playback.devices` | (none) | `{devices: [{id, name, type, is_active, volume_percent}], ...]}` |
| `playback.transfer_to_device` | `device_id: str`, `force_play: bool = true` | `{success: bool}` or error |

## Examples

### Example 1: List devices

User says: "Show me all my Spotify devices"
Claude calls: `playback.devices` with `{}`.
Returns: `{devices: [{id: "dev1", name: "iPhone", type: "Smartphone", is_active: true, volume_percent: 75}, {id: "dev2", name: "Living Room Speaker", type: "Speaker", is_active: false, volume_percent: 100}]}`.

### Example 2: Transfer playback

User says: "Switch to the living room speaker"
Claude calls: `playback.transfer_to_device` with `{"device_id": "dev2", "force_play": true}`.
Returns: `{success: true}`.

## Notes

- Device list includes both currently active and inactive devices
- Volume shown is the last known setting; may not reflect real-time state
- `force_play: true` starts playback on the target device; `false` pauses first
- Device IDs are obtained from the devices list returned by `playback.devices`

## Errors

This skill can return any of the standard errors documented in `spotify-shared`.
Common ones for this skill:

- `premium_required` — transferring playback requires Premium
- `not_found` — device ID does not exist or is no longer available
- `bad_request` — invalid device ID format

## See also

- `spotify-shared` — auth, error shapes, smart routing
- `spotify-playback` — control play/pause/volume on the active device
- `spotify-now-playing` — see what's playing on the current device

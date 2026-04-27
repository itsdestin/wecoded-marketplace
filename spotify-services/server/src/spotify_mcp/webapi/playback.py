"""Web API playback/transport operations — all Premium-gated.

Spotify returns 403 'Restriction violated: Premium required' for free accounts.
webapi/client._translate maps that to StructuredError("premium_required", ...).

None-valued optional kwargs are stripped before forwarding to spotipy —
passing None might signal Spotify to clear or default the parameter in ways
the caller didn't intend.
"""
from __future__ import annotations
from typing import Any
import spotipy

from spotify_mcp.webapi.client import call


def devices(sp: spotipy.Spotify) -> dict[str, Any]:
    """Return the list of available playback devices for the current user."""
    return call(sp.devices)


def transfer_to_device(sp: spotipy.Spotify, *,
                       device_id: str,
                       force_play: bool = False) -> dict[str, Any]:
    """Transfer playback to the given device.

    force_play: if True, immediately start playback on the target device even
    if paused on the current device.
    """
    return call(sp.transfer_playback, device_id=device_id, force_play=force_play)


def play(sp: spotipy.Spotify, *,
         device_id: str | None = None,
         context_uri: str | None = None,
         uris: list[str] | None = None,
         position_ms: int | None = None) -> dict[str, Any]:
    """Start or resume playback, optionally targeting a specific device.

    context_uri: Spotify URI of an album, artist, or playlist to play.
    uris: list of track/episode URIs to play (mutually exclusive with context_uri).
    position_ms: seek position within the current track.

    Why strip None: spotipy.start_playback forwards every kwarg to Spotify.
    Sending explicit None values can confuse the Spotify API into treating
    them as 'clear this field'. Only forward what was explicitly provided.
    """
    kwargs: dict[str, Any] = {}
    if device_id is not None:
        kwargs["device_id"] = device_id
    if context_uri is not None:
        kwargs["context_uri"] = context_uri
    if uris is not None:
        kwargs["uris"] = uris
    if position_ms is not None:
        kwargs["position_ms"] = position_ms
    return call(sp.start_playback, **kwargs)


def pause(sp: spotipy.Spotify, *,
          device_id: str | None = None) -> dict[str, Any]:
    """Pause playback on the current (or specified) device. Premium only."""
    kwargs: dict[str, Any] = {}
    if device_id is not None:
        kwargs["device_id"] = device_id
    return call(sp.pause_playback, **kwargs)


def next_track(sp: spotipy.Spotify, *,
               device_id: str | None = None) -> dict[str, Any]:
    """Skip to the next track. Premium only."""
    kwargs: dict[str, Any] = {}
    if device_id is not None:
        kwargs["device_id"] = device_id
    return call(sp.next_track, **kwargs)


def previous_track(sp: spotipy.Spotify, *,
                   device_id: str | None = None) -> dict[str, Any]:
    """Skip to the previous track. Premium only."""
    kwargs: dict[str, Any] = {}
    if device_id is not None:
        kwargs["device_id"] = device_id
    return call(sp.previous_track, **kwargs)


def seek(sp: spotipy.Spotify, *,
         position_ms: int,
         device_id: str | None = None) -> dict[str, Any]:
    """Seek to a position within the current track. Premium only.

    position_ms: target position in milliseconds.
    """
    kwargs: dict[str, Any] = {"position_ms": position_ms}
    if device_id is not None:
        kwargs["device_id"] = device_id
    return call(sp.seek_track, **kwargs)


def set_volume(sp: spotipy.Spotify, *,
               volume_percent: int,
               device_id: str | None = None) -> dict[str, Any]:
    """Set playback volume (0–100). Premium only."""
    kwargs: dict[str, Any] = {"volume_percent": volume_percent}
    if device_id is not None:
        kwargs["device_id"] = device_id
    return call(sp.volume, **kwargs)


def set_repeat(sp: spotipy.Spotify, *,
               state: str,
               device_id: str | None = None) -> dict[str, Any]:
    """Set the repeat mode. Premium only.

    state: 'track' (repeat current track), 'context' (repeat playlist/album),
           or 'off' (no repeat).
    """
    kwargs: dict[str, Any] = {"state": state}
    if device_id is not None:
        kwargs["device_id"] = device_id
    return call(sp.repeat, **kwargs)


def set_shuffle(sp: spotipy.Spotify, *,
                state: bool,
                device_id: str | None = None) -> dict[str, Any]:
    """Enable or disable shuffle. Premium only."""
    kwargs: dict[str, Any] = {"state": state}
    if device_id is not None:
        kwargs["device_id"] = device_id
    return call(sp.shuffle, **kwargs)

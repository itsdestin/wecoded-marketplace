"""Web API queue operations.

add: Premium-gated (403 → premium_required via client._translate).
list_queue: available on free tier.

Note: the public function is named list_queue (not list) to avoid shadowing
the Python builtin. The MCP tool registers as 'queue.list'.
"""
from __future__ import annotations
from typing import Any
import spotipy

from spotify_mcp.webapi.client import call


def add(sp: spotipy.Spotify, *,
        uri: str,
        device_id: str | None = None) -> dict[str, Any]:
    """Add a track or episode to the end of the user's playback queue.

    Premium-gated — Spotify returns 403 for free accounts.

    Why strip None device_id: passing None explicitly to spotipy can be
    forwarded to the API as a null parameter. Only send it if provided.
    """
    kwargs: dict[str, Any] = {"uri": uri}
    if device_id is not None:
        kwargs["device_id"] = device_id
    return call(sp.add_to_queue, **kwargs)


def list_queue(sp: spotipy.Spotify) -> dict[str, Any]:
    """Return the user's current playback queue.

    Returns a dict with 'currently_playing' (the active track) and
    'queue' (list of upcoming tracks/episodes). Available on free tier.
    """
    return call(sp.queue)

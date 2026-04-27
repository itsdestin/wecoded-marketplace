"""MCP tool handlers for webapi.* tools.

Each handler:
1. Acquires an access token via auth.with_access_token()
2. Builds a spotipy.Spotify(auth=token) client
3. Calls the webapi/* function
4. Catches StructuredError and returns its .to_json() shape"""
from __future__ import annotations
from typing import Any
import os
import spotipy

from spotify_mcp.auth import AuthError, TokenStore, with_access_token
from spotify_mcp.errors import StructuredError
from spotify_mcp.webapi.search import search as _search
from spotify_mcp.webapi import library as _library
from spotify_mcp.webapi import playlists as _playlists
from spotify_mcp.webapi import playback as _playback
from spotify_mcp.webapi import queue as _queue
from spotify_mcp.webapi import user as _user


def _client() -> spotipy.Spotify:
    cid = os.environ.get("SPOTIFY_CLIENT_ID")
    if not cid:
        raise StructuredError(
            "client_id_missing",
            "SPOTIFY_CLIENT_ID environment variable not set. "
            "The launcher should set this from ~/.youcoded/spotify-services/client.env.",
        )
    token = with_access_token(client_id=cid, store=TokenStore())
    return spotipy.Spotify(auth=token)


def _safe(handler):
    """Decorator: convert StructuredError + AuthError into a JSON error shape."""
    async def _wrap(args: dict[str, Any]) -> dict[str, Any]:
        try:
            return await handler(args)
        except AuthError as e:
            return {"error": e.code, "message": e.message}
        except StructuredError as e:
            return e.to_json()
    return _wrap


@_safe
async def search_query(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _search(
        sp,
        query=args["query"],
        types=args.get("types") or ["track"],
        limit=int(args.get("limit") or 10),
        offset=int(args.get("offset") or 0),
        market=args.get("market"),
    )


# ---------------------------------------------------------------------------
# Library tools
# ---------------------------------------------------------------------------

@_safe
async def library_saved_tracks(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _library.saved_tracks(
        sp,
        limit=int(args.get("limit") or 20),
        offset=int(args.get("offset") or 0),
        market=args.get("market"),
    )


@_safe
async def library_top_tracks(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _library.top_tracks(
        sp,
        time_range=args.get("time_range") or "medium_term",
        limit=int(args.get("limit") or 20),
        offset=int(args.get("offset") or 0),
    )


@_safe
async def library_top_artists(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _library.top_artists(
        sp,
        time_range=args.get("time_range") or "medium_term",
        limit=int(args.get("limit") or 20),
        offset=int(args.get("offset") or 0),
    )


@_safe
async def library_recently_played(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    # after/before are millisecond timestamps — pass as int if present
    after = int(args["after"]) if args.get("after") is not None else None
    before = int(args["before"]) if args.get("before") is not None else None
    return _library.recently_played(
        sp,
        limit=int(args.get("limit") or 20),
        after=after,
        before=before,
    )


@_safe
async def library_save(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _library.library_save(sp, uris=args["uris"])


@_safe
async def library_remove(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _library.library_remove(sp, uris=args["uris"])


# ---------------------------------------------------------------------------
# Playlists tools
# ---------------------------------------------------------------------------

@_safe
async def playlists_list_mine(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _playlists.list_mine(
        sp,
        limit=int(args.get("limit") or 50),
        offset=int(args.get("offset") or 0),
    )


@_safe
async def playlists_get_items(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _playlists.get_items(
        sp,
        playlist_id=args["playlist_id"],
        limit=int(args.get("limit") or 100),
        offset=int(args.get("offset") or 0),
        fields=args.get("fields"),
        market=args.get("market"),
    )


@_safe
async def playlists_add_items(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    position = int(args["position"]) if args.get("position") is not None else None
    return _playlists.add_items(
        sp,
        playlist_id=args["playlist_id"],
        uris=args["uris"],
        position=position,
    )


@_safe
async def playlists_remove_items(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _playlists.remove_items(
        sp,
        playlist_id=args["playlist_id"],
        uris=args["uris"],
    )


@_safe
async def playlists_reorder(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _playlists.reorder(
        sp,
        playlist_id=args["playlist_id"],
        range_start=int(args["range_start"]),
        insert_before=int(args["insert_before"]),
        range_length=int(args.get("range_length") or 1),
    )


@_safe
async def playlists_update_details(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _playlists.update_details(
        sp,
        playlist_id=args["playlist_id"],
        name=args.get("name"),
        public=args.get("public"),
        collaborative=args.get("collaborative"),
        description=args.get("description"),
    )


# ---------------------------------------------------------------------------
# Playback tools (Premium-gated)
# ---------------------------------------------------------------------------

@_safe
async def playback_devices(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _playback.devices(sp)


@_safe
async def playback_transfer_to_device(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _playback.transfer_to_device(
        sp,
        device_id=args["device_id"],
        force_play=bool(args.get("force_play") or False),
    )


@_safe
async def playback_play(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    position_ms = int(args["position_ms"]) if args.get("position_ms") is not None else None
    return _playback.play(
        sp,
        device_id=args.get("device_id"),
        context_uri=args.get("context_uri"),
        uris=args.get("uris"),
        position_ms=position_ms,
    )


@_safe
async def playback_pause(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _playback.pause(sp, device_id=args.get("device_id"))


@_safe
async def playback_next(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _playback.next_track(sp, device_id=args.get("device_id"))


@_safe
async def playback_previous(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _playback.previous_track(sp, device_id=args.get("device_id"))


@_safe
async def playback_seek(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _playback.seek(
        sp,
        position_ms=int(args["position_ms"]),
        device_id=args.get("device_id"),
    )


@_safe
async def playback_set_volume(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _playback.set_volume(
        sp,
        volume_percent=int(args["volume_percent"]),
        device_id=args.get("device_id"),
    )


@_safe
async def playback_set_repeat(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _playback.set_repeat(
        sp,
        state=args["state"],
        device_id=args.get("device_id"),
    )


@_safe
async def playback_set_shuffle(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _playback.set_shuffle(
        sp,
        state=bool(args["state"]),
        device_id=args.get("device_id"),
    )


# ---------------------------------------------------------------------------
# Queue tools
# ---------------------------------------------------------------------------

@_safe
async def queue_add(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _queue.add(
        sp,
        uri=args["uri"],
        device_id=args.get("device_id"),
    )


@_safe
async def queue_list(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _queue.list_queue(sp)


# ---------------------------------------------------------------------------
# User tools
# ---------------------------------------------------------------------------

@_safe
async def user_profile(args: dict[str, Any]) -> dict[str, Any]:
    sp = _client()
    return _user.profile(sp)

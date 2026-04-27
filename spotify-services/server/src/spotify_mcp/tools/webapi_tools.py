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

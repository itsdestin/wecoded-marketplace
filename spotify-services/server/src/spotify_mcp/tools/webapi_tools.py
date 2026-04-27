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

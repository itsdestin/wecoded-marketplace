"""Web API search — types-multiplexed.

Note: as of Feb 2026, Spotify capped `limit` at 10 (was 50). We clamp
silently rather than rejecting — Claude tends to ask for 50 and we'd
rather honor the spirit of the request."""
from __future__ import annotations
from typing import Any
import spotipy

from spotify_mcp.webapi.client import call

LIMIT_CAP = 10


def search(sp: spotipy.Spotify, *, query: str, types: list[str],
           limit: int = 10, offset: int = 0,
           market: str | None = None) -> dict[str, Any]:
    """Multi-type search. Returns the raw Spotify shape.

    types: any subset of {"track","album","artist","playlist","show","episode","audiobook"}.
    """
    return call(sp.search,
                q=query, type=",".join(types),
                limit=min(limit, LIMIT_CAP), offset=offset, market=market)

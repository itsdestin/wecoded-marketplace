"""Web API user profile operations.

Feb 2026 note: Spotify removed country, email, and product from the default
/me response. profile() passes through whatever spotipy returns without
asserting field presence — callers must treat those fields as optional.
"""
from __future__ import annotations
from typing import Any
import spotipy

from spotify_mcp.webapi.client import call


def profile(sp: spotipy.Spotify) -> dict[str, Any]:
    """Return the current user's public profile.

    Returns spotipy's raw response from sp.current_user() (GET /me).
    Note: country, email, and product are absent from the default scope
    response as of Feb 2026 — do not assume their presence.
    """
    return call(sp.current_user)

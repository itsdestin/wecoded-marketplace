"""Web API library operations — saved tracks, top items, recently played,
and generic save/remove.

Feb 2026 note: Spotify removed the entity-typed save/remove endpoints
(/me/tracks, /me/albums, /me/episodes). All library mutations now go through
the generic POST/DELETE /me/library endpoint with a {"uris": [...]} payload.
spotipy 2.26.0 has no first-class method for this generic endpoint, so we
call sp._put / sp._delete directly.
"""
from __future__ import annotations
from typing import Any
import spotipy

from spotify_mcp.webapi.client import call


def saved_tracks(sp: spotipy.Spotify, *,
                 limit: int = 20,
                 offset: int = 0,
                 market: str | None = None) -> dict[str, Any]:
    """Return the current user's saved tracks (liked songs)."""
    return call(sp.current_user_saved_tracks,
                limit=limit, offset=offset, market=market)


def top_tracks(sp: spotipy.Spotify, *,
               time_range: str = "medium_term",
               limit: int = 20,
               offset: int = 0) -> dict[str, Any]:
    """Return the current user's top tracks.

    time_range: 'short_term' (~4 weeks), 'medium_term' (~6 months),
    or 'long_term' (years).
    """
    return call(sp.current_user_top_tracks,
                limit=limit, offset=offset, time_range=time_range)


def top_artists(sp: spotipy.Spotify, *,
                time_range: str = "medium_term",
                limit: int = 20,
                offset: int = 0) -> dict[str, Any]:
    """Return the current user's top artists.

    time_range: 'short_term' (~4 weeks), 'medium_term' (~6 months),
    or 'long_term' (years).
    """
    return call(sp.current_user_top_artists,
                limit=limit, offset=offset, time_range=time_range)


def recently_played(sp: spotipy.Spotify, *,
                    limit: int = 20,
                    after: int | None = None,
                    before: int | None = None) -> dict[str, Any]:
    """Return the current user's recently played tracks.

    after/before: Unix timestamps in milliseconds (mutually exclusive per
    Spotify's API — pass one or neither).
    """
    return call(sp.current_user_recently_played,
                limit=limit, after=after, before=before)


def library_save(sp: spotipy.Spotify, *, uris: list[str]) -> None:
    """Save items to the current user's library via the generic endpoint.

    Uses POST /me/library with {"uris": [...]} — the post-Feb-2026
    replacement for the removed entity-typed /me/tracks /me/albums paths.
    spotipy 2.26.0 has no first-class method for this, so we use sp._put.
    """
    # Why sp._put directly: spotipy has no current_user_library_save() method
    # for the generic endpoint introduced in Feb 2026.
    return call(sp._put, "me/library", payload={"uris": uris})


def library_remove(sp: spotipy.Spotify, *, uris: list[str]) -> None:
    """Remove items from the current user's library via the generic endpoint.

    Uses DELETE /me/library with {"uris": [...]} — the post-Feb-2026
    replacement for the removed entity-typed /me/tracks /me/albums paths.
    spotipy 2.26.0 has no first-class method for this, so we use sp._delete.
    """
    # Why sp._delete directly: spotipy has no current_user_library_delete()
    # method for the generic endpoint introduced in Feb 2026.
    return call(sp._delete, "me/library", payload={"uris": uris})

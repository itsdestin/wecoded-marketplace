"""Web API playlist operations.

Feb 2026 note: Spotify renamed /playlists/{id}/tracks to
/playlists/{id}/items. spotipy 2.26.0 has both sp.playlist_items (new)
and sp.playlist_tracks (old wrapper); we always use playlist_items.
"""
from __future__ import annotations
from typing import Any
import spotipy

from spotify_mcp.webapi.client import call


def list_mine(sp: spotipy.Spotify, *,
              limit: int = 50,
              offset: int = 0) -> dict[str, Any]:
    """Return the current user's playlists (owned and followed)."""
    return call(sp.current_user_playlists, limit=limit, offset=offset)


def get_items(sp: spotipy.Spotify, *,
              playlist_id: str,
              limit: int = 100,
              offset: int = 0,
              fields: str | None = None,
              market: str | None = None) -> dict[str, Any]:
    """Return items (tracks + episodes) in a playlist.

    Uses sp.playlist_items — the post-Feb-2026 renamed method that maps to
    /playlists/{id}/items. Never use sp.playlist_tracks (/tracks is removed).
    """
    # Why playlist_items not playlist_tracks: Spotify renamed the endpoint
    # from /tracks to /items in Feb 2026 to support mixed track+episode
    # playlists. playlist_tracks still exists in spotipy 2.26.0 as a
    # compatibility shim but calls the removed /tracks URL.
    return call(sp.playlist_items,
                playlist_id=playlist_id,
                limit=limit,
                offset=offset,
                fields=fields,
                market=market)


def add_items(sp: spotipy.Spotify, *,
              playlist_id: str,
              uris: list[str],
              position: int | None = None) -> dict[str, Any]:
    """Add tracks or episodes to a playlist by URI.

    Returns {"snapshot_id": ...} on success.
    """
    return call(sp.playlist_add_items,
                playlist_id=playlist_id,
                items=uris,
                position=position)


def remove_items(sp: spotipy.Spotify, *,
                 playlist_id: str,
                 uris: list[str]) -> dict[str, Any]:
    """Remove all occurrences of the given URIs from a playlist.

    Returns {"snapshot_id": ...} on success.
    """
    return call(sp.playlist_remove_all_occurrences_of_items,
                playlist_id=playlist_id,
                items=uris)


def reorder(sp: spotipy.Spotify, *,
            playlist_id: str,
            range_start: int,
            insert_before: int,
            range_length: int = 1) -> dict[str, Any]:
    """Reorder a range of items within a playlist.

    Moves `range_length` items starting at `range_start` to `insert_before`.
    Returns {"snapshot_id": ...} on success.
    """
    return call(sp.playlist_reorder_items,
                playlist_id=playlist_id,
                range_start=range_start,
                insert_before=insert_before,
                range_length=range_length)


def update_details(sp: spotipy.Spotify, *,
                   playlist_id: str,
                   name: str | None = None,
                   public: bool | None = None,
                   collaborative: bool | None = None,
                   description: str | None = None) -> None:
    """Update a playlist's metadata (name, visibility, description).

    Only fields with non-None values are forwarded to spotipy — passing
    None would tell Spotify to clear that field, which is almost never
    what the caller intends.
    """
    # Why strip None: spotipy.playlist_change_details forwards every kwarg
    # to Spotify. A None public/collaborative may be interpreted as 'clear
    # this setting'. Only send what the caller explicitly provided.
    kwargs: dict[str, Any] = {"playlist_id": playlist_id}
    if name is not None:
        kwargs["name"] = name
    if public is not None:
        kwargs["public"] = public
    if collaborative is not None:
        kwargs["collaborative"] = collaborative
    if description is not None:
        kwargs["description"] = description
    return call(sp.playlist_change_details, **kwargs)


def paginate_all(sp: spotipy.Spotify, fetch_page) -> list[dict]:
    """Iterate Spotify's pagination links until exhausted.

    fetch_page is called with no args to get the first page; subsequent
    pages are fetched via sp.next(prev_page) until next is None.
    Returns the concatenated items arrays from every page.
    Each sp.next call goes through client.call() for retry/error handling.
    """
    items: list[dict] = []
    page = fetch_page()
    while page:
        items.extend(page.get("items", []))
        if not page.get("next"):
            break
        page = call(sp.next, page)
    return items

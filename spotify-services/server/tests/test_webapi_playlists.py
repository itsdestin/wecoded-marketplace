"""Tests for webapi.playlists — written TDD-first (fail before module exists).

Critical test marked with WHY comment: test_get_items_uses_renamed_endpoint
guards against using the old pre-Feb-2026 /tracks endpoint."""
from unittest.mock import MagicMock, call, patch
import pytest

from spotify_mcp.webapi.playlists import (
    list_mine,
    get_items,
    add_items,
    remove_items,
    reorder,
    update_details,
    paginate_all,
)


# ---------------------------------------------------------------------------
# list_mine
# ---------------------------------------------------------------------------

def test_list_mine_passes_pagination_args():
    sp = MagicMock()
    sp.current_user_playlists.return_value = {"items": [], "total": 0}
    list_mine(sp, limit=10, offset=5)
    kwargs = sp.current_user_playlists.call_args.kwargs
    assert kwargs["limit"] == 10
    assert kwargs["offset"] == 5


def test_list_mine_uses_defaults():
    sp = MagicMock()
    sp.current_user_playlists.return_value = {"items": []}
    list_mine(sp)
    kwargs = sp.current_user_playlists.call_args.kwargs
    assert kwargs["limit"] == 50
    assert kwargs["offset"] == 0


def test_list_mine_returns_spotify_shape():
    sp = MagicMock()
    expected = {"items": [{"id": "pl1"}], "total": 1}
    sp.current_user_playlists.return_value = expected
    assert list_mine(sp) == expected


# ---------------------------------------------------------------------------
# get_items
# ---------------------------------------------------------------------------

def test_get_items_uses_renamed_endpoint():
    """CRITICAL: Feb 2026 — Spotify renamed /playlists/{id}/tracks to
    /playlists/{id}/items. We must call sp.playlist_items (the new name),
    NOT sp.playlist_tracks (the old name that maps to the removed endpoint).
    This test asserts that sp.playlist_items is called and sp.playlist_tracks
    is never called."""
    sp = MagicMock()
    sp.playlist_items.return_value = {"items": [], "total": 0}

    get_items(sp, playlist_id="pl123", limit=50, offset=0)

    # Must use the new /items endpoint
    sp.playlist_items.assert_called_once()
    # Must NOT fall back to the old /tracks endpoint
    sp.playlist_tracks.assert_not_called()


def test_get_items_passes_playlist_id_and_params():
    sp = MagicMock()
    sp.playlist_items.return_value = {"items": []}
    get_items(sp, playlist_id="pl456", limit=25, offset=10,
              fields="items.track.id", market="GB")
    kwargs = sp.playlist_items.call_args.kwargs
    assert kwargs["playlist_id"] == "pl456"
    assert kwargs["limit"] == 25
    assert kwargs["offset"] == 10
    assert kwargs["fields"] == "items.track.id"
    assert kwargs["market"] == "GB"


def test_get_items_uses_defaults():
    sp = MagicMock()
    sp.playlist_items.return_value = {"items": []}
    get_items(sp, playlist_id="pl789")
    kwargs = sp.playlist_items.call_args.kwargs
    assert kwargs["limit"] == 100
    assert kwargs["offset"] == 0
    assert kwargs["fields"] is None
    assert kwargs["market"] is None


# ---------------------------------------------------------------------------
# add_items
# ---------------------------------------------------------------------------

def test_add_items_passes_uris_and_position():
    sp = MagicMock()
    sp.playlist_add_items.return_value = {"snapshot_id": "snap1"}
    uris = ["spotify:track:a", "spotify:track:b"]
    result = add_items(sp, playlist_id="pl1", uris=uris, position=3)
    kwargs = sp.playlist_add_items.call_args.kwargs
    assert kwargs["playlist_id"] == "pl1"
    assert kwargs["items"] == uris
    assert kwargs["position"] == 3


def test_add_items_position_defaults_to_none():
    sp = MagicMock()
    sp.playlist_add_items.return_value = {"snapshot_id": "snap2"}
    add_items(sp, playlist_id="pl1", uris=["spotify:track:a"])
    kwargs = sp.playlist_add_items.call_args.kwargs
    assert kwargs["position"] is None


# ---------------------------------------------------------------------------
# remove_items
# ---------------------------------------------------------------------------

def test_remove_items_passes_uris():
    sp = MagicMock()
    sp.playlist_remove_all_occurrences_of_items.return_value = {"snapshot_id": "snap3"}
    uris = ["spotify:track:x", "spotify:track:y"]
    remove_items(sp, playlist_id="pl2", uris=uris)
    kwargs = sp.playlist_remove_all_occurrences_of_items.call_args.kwargs
    assert kwargs["playlist_id"] == "pl2"
    assert kwargs["items"] == uris


# ---------------------------------------------------------------------------
# reorder
# ---------------------------------------------------------------------------

def test_reorder_passes_range_params():
    sp = MagicMock()
    sp.playlist_reorder_items.return_value = {"snapshot_id": "snap4"}
    reorder(sp, playlist_id="pl3", range_start=2, insert_before=5, range_length=2)
    kwargs = sp.playlist_reorder_items.call_args.kwargs
    assert kwargs["playlist_id"] == "pl3"
    assert kwargs["range_start"] == 2
    assert kwargs["insert_before"] == 5
    assert kwargs["range_length"] == 2


def test_reorder_range_length_defaults_to_1():
    sp = MagicMock()
    sp.playlist_reorder_items.return_value = {"snapshot_id": "snap5"}
    reorder(sp, playlist_id="pl3", range_start=0, insert_before=3)
    kwargs = sp.playlist_reorder_items.call_args.kwargs
    assert kwargs["range_length"] == 1


# ---------------------------------------------------------------------------
# update_details
# ---------------------------------------------------------------------------

def test_update_details_only_passes_set_fields():
    """Spotipy's playlist_change_details treats None as 'clear this field'
    for some params. We must strip None values from the kwargs so only
    explicitly-set fields are forwarded. Passing name='X' should result in
    only name being in the call kwargs, not public=None, collaborative=None, etc."""
    sp = MagicMock()
    sp.playlist_change_details.return_value = None
    update_details(sp, playlist_id="pl4", name="My Playlist")
    kwargs = sp.playlist_change_details.call_args.kwargs
    assert kwargs.get("name") == "My Playlist"
    # None-valued keys must NOT be forwarded
    assert "public" not in kwargs
    assert "collaborative" not in kwargs
    assert "description" not in kwargs


def test_update_details_passes_all_set_fields():
    sp = MagicMock()
    sp.playlist_change_details.return_value = None
    update_details(sp, playlist_id="pl4", name="X", public=True,
                   collaborative=False, description="desc")
    kwargs = sp.playlist_change_details.call_args.kwargs
    assert kwargs["name"] == "X"
    assert kwargs["public"] is True
    assert kwargs["collaborative"] is False
    assert kwargs["description"] == "desc"


def test_update_details_passes_playlist_id():
    sp = MagicMock()
    sp.playlist_change_details.return_value = None
    update_details(sp, playlist_id="pl99", name="test")
    kwargs = sp.playlist_change_details.call_args.kwargs
    assert kwargs["playlist_id"] == "pl99"


# ---------------------------------------------------------------------------
# paginate_all
# ---------------------------------------------------------------------------

def test_paginate_all_concatenates_pages():
    """Verify paginate_all calls fetch_page once, then sp.next twice (for a
    3-page result), and returns all items concatenated in order."""
    sp = MagicMock()

    page1 = {"items": [{"id": "a"}, {"id": "b"}], "next": "url1"}
    page2 = {"items": [{"id": "c"}], "next": "url2"}
    page3 = {"items": [{"id": "d"}, {"id": "e"}], "next": None}

    fetch_page = MagicMock(return_value=page1)
    # sp.next returns page2 on first call, page3 on second
    sp.next.side_effect = [page2, page3]

    result = paginate_all(sp, fetch_page)

    fetch_page.assert_called_once_with()
    assert sp.next.call_count == 2
    assert result == [{"id": "a"}, {"id": "b"}, {"id": "c"}, {"id": "d"}, {"id": "e"}]


def test_paginate_all_single_page():
    """A single page with next=None should not call sp.next."""
    sp = MagicMock()
    page = {"items": [{"id": "only"}], "next": None}
    fetch_page = MagicMock(return_value=page)
    result = paginate_all(sp, fetch_page)
    sp.next.assert_not_called()
    assert result == [{"id": "only"}]


def test_paginate_all_empty_page():
    """An empty page should return an empty list."""
    sp = MagicMock()
    page = {"items": [], "next": None}
    fetch_page = MagicMock(return_value=page)
    result = paginate_all(sp, fetch_page)
    assert result == []

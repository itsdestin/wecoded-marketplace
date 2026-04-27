"""Tests for webapi.library — written TDD-first (fail before module exists).

Critical tests are marked with WHY comments explaining what breaking change
they guard against (Feb 2026 Spotify API removals)."""
from unittest.mock import MagicMock, call
import pytest

from spotify_mcp.webapi.library import (
    saved_tracks,
    top_tracks,
    top_artists,
    recently_played,
    library_save,
    library_remove,
)


# ---------------------------------------------------------------------------
# saved_tracks
# ---------------------------------------------------------------------------

def test_saved_tracks_passes_args_to_spotipy():
    sp = MagicMock()
    sp.current_user_saved_tracks.return_value = {"items": [], "total": 0}
    saved_tracks(sp, limit=10, offset=5, market="US")
    kwargs = sp.current_user_saved_tracks.call_args.kwargs
    assert kwargs["limit"] == 10
    assert kwargs["offset"] == 5
    assert kwargs["market"] == "US"


def test_saved_tracks_returns_spotify_shape():
    sp = MagicMock()
    expected = {"items": [{"track": {"id": "abc"}}], "total": 1}
    sp.current_user_saved_tracks.return_value = expected
    result = saved_tracks(sp)
    assert result == expected


def test_saved_tracks_uses_defaults():
    sp = MagicMock()
    sp.current_user_saved_tracks.return_value = {"items": []}
    saved_tracks(sp)
    kwargs = sp.current_user_saved_tracks.call_args.kwargs
    assert kwargs["limit"] == 20
    assert kwargs["offset"] == 0
    assert kwargs["market"] is None


# ---------------------------------------------------------------------------
# top_tracks
# ---------------------------------------------------------------------------

def test_top_tracks_passes_time_range():
    """Verify all three valid time_range values propagate correctly."""
    for time_range in ("short_term", "medium_term", "long_term"):
        sp = MagicMock()
        sp.current_user_top_tracks.return_value = {"items": []}
        top_tracks(sp, time_range=time_range, limit=10, offset=0)
        kwargs = sp.current_user_top_tracks.call_args.kwargs
        assert kwargs["time_range"] == time_range, f"Expected {time_range!r}"


def test_top_tracks_passes_limit_and_offset():
    sp = MagicMock()
    sp.current_user_top_tracks.return_value = {"items": []}
    top_tracks(sp, time_range="short_term", limit=5, offset=10)
    kwargs = sp.current_user_top_tracks.call_args.kwargs
    assert kwargs["limit"] == 5
    assert kwargs["offset"] == 10


# ---------------------------------------------------------------------------
# top_artists
# ---------------------------------------------------------------------------

def test_top_artists_passes_time_range():
    """Verify all three valid time_range values propagate correctly."""
    for time_range in ("short_term", "medium_term", "long_term"):
        sp = MagicMock()
        sp.current_user_top_artists.return_value = {"items": []}
        top_artists(sp, time_range=time_range)
        kwargs = sp.current_user_top_artists.call_args.kwargs
        assert kwargs["time_range"] == time_range


def test_top_artists_uses_defaults():
    sp = MagicMock()
    sp.current_user_top_artists.return_value = {"items": []}
    top_artists(sp)
    kwargs = sp.current_user_top_artists.call_args.kwargs
    assert kwargs["time_range"] == "medium_term"
    assert kwargs["limit"] == 20
    assert kwargs["offset"] == 0


# ---------------------------------------------------------------------------
# recently_played
# ---------------------------------------------------------------------------

def test_recently_played_passes_after_before_filters():
    """Verify after/before timestamp params propagate to Spotify."""
    sp = MagicMock()
    sp.current_user_recently_played.return_value = {"items": []}
    recently_played(sp, limit=15, after=1700000000000, before=1700001000000)
    kwargs = sp.current_user_recently_played.call_args.kwargs
    assert kwargs["limit"] == 15
    assert kwargs["after"] == 1700000000000
    assert kwargs["before"] == 1700001000000


def test_recently_played_defaults_after_before_to_none():
    sp = MagicMock()
    sp.current_user_recently_played.return_value = {"items": []}
    recently_played(sp)
    kwargs = sp.current_user_recently_played.call_args.kwargs
    assert kwargs["after"] is None
    assert kwargs["before"] is None


# ---------------------------------------------------------------------------
# library_save  (Feb 2026 load-bearing test)
# ---------------------------------------------------------------------------

def test_library_save_uses_generic_me_library_endpoint():
    """CRITICAL: Feb 2026 — Spotify removed entity-typed save endpoints
    (/me/tracks, /me/albums, /me/episodes). The new generic endpoint is
    POST /me/library with a body of {"uris": [...]}. This test asserts
    the call goes to sp._put("me/library", ...) NOT sp.current_user_saved_tracks_add
    or any other entity-specific method."""
    sp = MagicMock()
    sp._put.return_value = None  # Spotify returns 200 OK with empty body

    uris = ["spotify:track:abc123", "spotify:album:def456"]
    result = library_save(sp, uris=uris)

    # Must call sp._put, not any entity-specific method
    sp._put.assert_called_once()
    call_args = sp._put.call_args
    # First positional arg is the URL
    url = call_args.args[0] if call_args.args else call_args.kwargs.get("url")
    assert url == "me/library", (
        f"Expected 'me/library' but got {url!r}. "
        "library_save must use the post-Feb-2026 generic endpoint."
    )
    # Payload must include the uris list
    payload = call_args.kwargs.get("payload", {})
    assert payload.get("uris") == uris

    # Must NOT call any entity-specific save methods
    sp.current_user_saved_tracks_add.assert_not_called()


def test_library_save_returns_none_for_empty_body():
    """Spotify's POST /me/library returns 200 with no body; we return None."""
    sp = MagicMock()
    sp._put.return_value = None
    result = library_save(sp, uris=["spotify:track:xyz"])
    assert result is None


# ---------------------------------------------------------------------------
# library_remove  (Feb 2026 load-bearing test)
# ---------------------------------------------------------------------------

def test_library_remove_uses_generic_me_library_endpoint():
    """CRITICAL: Feb 2026 — Spotify removed entity-typed delete endpoints
    (/me/tracks, /me/albums, /me/episodes). The new generic endpoint is
    DELETE /me/library with a body of {"uris": [...]}. This test asserts
    the call goes to sp._delete("me/library", ...) NOT
    sp.current_user_saved_tracks_delete or any other entity-specific method."""
    sp = MagicMock()
    sp._delete.return_value = None  # Spotify returns 200 OK with empty body

    uris = ["spotify:track:abc123", "spotify:episode:ghi789"]
    library_remove(sp, uris=uris)

    sp._delete.assert_called_once()
    call_args = sp._delete.call_args
    url = call_args.args[0] if call_args.args else call_args.kwargs.get("url")
    assert url == "me/library", (
        f"Expected 'me/library' but got {url!r}. "
        "library_remove must use the post-Feb-2026 generic endpoint."
    )
    payload = call_args.kwargs.get("payload", {})
    assert payload.get("uris") == uris

    # Must NOT call any entity-specific delete methods
    sp.current_user_saved_tracks_delete.assert_not_called()


def test_library_remove_returns_none_for_empty_body():
    """Spotify's DELETE /me/library returns 200 with no body; we return None."""
    sp = MagicMock()
    sp._delete.return_value = None
    result = library_remove(sp, uris=["spotify:track:xyz"])
    assert result is None

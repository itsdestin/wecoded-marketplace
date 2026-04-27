"""Tests for webapi.queue — add (Premium-gated) and list_queue (free)."""
from unittest.mock import MagicMock
import pytest
import spotipy

from spotify_mcp.errors import StructuredError


def _import():
    from spotify_mcp.webapi.queue import add, list_queue
    return add, list_queue


# ---------------------------------------------------------------------------
# add
# ---------------------------------------------------------------------------

def test_add_passes_uri_and_device_id():
    add, _ = _import()
    sp = MagicMock()
    sp.add_to_queue.return_value = None
    add(sp, uri="spotify:track:abc123", device_id="dev1")
    kwargs = sp.add_to_queue.call_args.kwargs
    assert kwargs["uri"] == "spotify:track:abc123"
    assert kwargs["device_id"] == "dev1"


def test_add_premium_403_translates():
    """Add-to-queue is Premium-gated. 403 must translate to premium_required."""
    add, _ = _import()
    sp = MagicMock()
    sp.add_to_queue.side_effect = spotipy.SpotifyException(
        403, -1, "Restriction violated: Premium required", headers={}
    )
    with pytest.raises(StructuredError) as exc_info:
        add(sp, uri="spotify:track:xyz")
    assert exc_info.value.code == "premium_required"


# ---------------------------------------------------------------------------
# list_queue
# ---------------------------------------------------------------------------

def test_list_queue_returns_spotipy_shape():
    _, list_queue = _import()
    sp = MagicMock()
    expected = {
        "currently_playing": {"id": "track1"},
        "queue": [{"id": "track2"}, {"id": "track3"}],
    }
    sp.queue.return_value = expected
    result = list_queue(sp)
    sp.queue.assert_called_once()
    assert result == expected

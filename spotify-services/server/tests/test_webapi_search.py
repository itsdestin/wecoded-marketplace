"""Tests for webapi.search."""
from unittest.mock import MagicMock
import pytest

from spotify_mcp.webapi.search import search

POST_FEB_2026_LIMIT_CAP = 10  # Spotify capped search limit at 10 in Feb 2026.


def test_search_caps_limit_at_post_feb_2026_value():
    sp = MagicMock()
    sp.search.return_value = {"tracks": {"items": []}}
    search(sp, query="x", types=["track"], limit=50)
    args, kwargs = sp.search.call_args
    assert kwargs["limit"] == POST_FEB_2026_LIMIT_CAP


def test_search_passes_query_and_types():
    sp = MagicMock()
    sp.search.return_value = {"tracks": {"items": []}}
    search(sp, query="abba", types=["track", "album"], limit=5)
    kwargs = sp.search.call_args.kwargs
    assert kwargs["q"] == "abba"
    assert kwargs["type"] == "track,album"
    assert kwargs["limit"] == 5

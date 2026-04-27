"""Tests for the spotipy.Spotify wrapper."""
from unittest.mock import MagicMock, patch
import pytest
import spotipy

from spotify_mcp.errors import StructuredError
from spotify_mcp.webapi.client import call, retry_after_seconds


def test_call_passes_through_on_success():
    fn = MagicMock(return_value={"ok": True})
    out = call(fn, "arg1", k="v")
    assert out == {"ok": True}
    fn.assert_called_once_with("arg1", k="v")


def test_call_translates_403_premium_required():
    err = spotipy.SpotifyException(403, -1,
        "Restriction violated: Premium account required.", headers={})
    fn = MagicMock(side_effect=err)
    with pytest.raises(StructuredError) as ex:
        call(fn)
    assert ex.value.code == "premium_required"


def test_call_translates_403_scope_error():
    err = spotipy.SpotifyException(403, -1,
        "Insufficient client scope", headers={})
    fn = MagicMock(side_effect=err)
    with pytest.raises(StructuredError) as ex:
        call(fn)
    assert ex.value.code == "scope_missing"


def test_call_retries_once_on_429_then_surfaces_rate_limit():
    err = spotipy.SpotifyException(429, -1, "Too Many Requests",
                                    headers={"Retry-After": "2"})
    fn = MagicMock(side_effect=[err, err])
    with patch("spotify_mcp.webapi.client.time.sleep"):
        with pytest.raises(StructuredError) as ex:
            call(fn)
    assert ex.value.code == "rate_limited"
    assert ex.value.payload["retry_after_s"] == 2
    assert fn.call_count == 2


def test_retry_after_seconds_parses_int():
    err = spotipy.SpotifyException(429, -1, "x", headers={"Retry-After": "5"})
    assert retry_after_seconds(err) == 5


def test_retry_after_seconds_falls_back_to_one_when_missing():
    err = spotipy.SpotifyException(429, -1, "x", headers={})
    assert retry_after_seconds(err) == 1

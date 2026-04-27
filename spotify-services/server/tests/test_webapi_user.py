"""Tests for webapi.user — current user profile.

Note: Spotify removed country/email/product from the default profile response
in Feb 2026. Tests verify the function works with both full and minimal shapes.
"""
from unittest.mock import MagicMock


def _import():
    from spotify_mcp.webapi.user import profile
    return profile


# ---------------------------------------------------------------------------
# profile
# ---------------------------------------------------------------------------

def test_profile_returns_spotipy_shape():
    """profile() should pass through the spotipy response unchanged."""
    profile = _import()
    sp = MagicMock()
    expected = {"id": "destin", "display_name": "Destin"}
    sp.current_user.return_value = expected
    result = profile(sp)
    sp.current_user.assert_called_once()
    assert result == expected


def test_profile_handles_missing_post_feb_2026_fields():
    """Feb 2026: Spotify removed country/email/product from the default
    profile response. profile() must succeed and pass through whatever
    spotipy returns — no field-presence validation."""
    profile = _import()
    sp = MagicMock()
    # Minimal shape — no country, email, or product
    minimal = {"id": "destin"}
    sp.current_user.return_value = minimal
    result = profile(sp)
    assert result == minimal

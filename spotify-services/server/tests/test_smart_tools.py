"""Tests for smart-routed tools (now_playing + play_pause_smart)."""
from unittest.mock import AsyncMock, MagicMock
import pytest

from spotify_mcp.errors import StructuredError


@pytest.mark.asyncio
async def test_now_playing_uses_local_when_available(monkeypatch):
    backend = MagicMock()
    backend.now_playing = AsyncMock(return_value={
        "name": "T", "artist": "A", "album": "Al",
        "duration_ms": 1000, "position_ms": 100,
        "backend": "local_macos",
    })
    monkeypatch.setattr("spotify_mcp.tools.smart_tools.select_backend",
                        lambda: backend)
    from spotify_mcp.tools.smart_tools import now_playing
    out = await now_playing({})
    assert out["name"] == "T"
    assert out["enriched"] is False


@pytest.mark.asyncio
async def test_now_playing_falls_back_to_webapi_when_no_local(monkeypatch):
    monkeypatch.setattr("spotify_mcp.tools.smart_tools.select_backend",
                        lambda: None)
    fake_sp = MagicMock()
    fake_sp.current_playback.return_value = {
        "is_playing": True,
        "item": {"name": "T", "artists": [{"name": "A"}],
                 "album": {"name": "Al"}, "duration_ms": 1000},
        "progress_ms": 100,
    }
    monkeypatch.setattr("spotify_mcp.tools.smart_tools._client",
                        lambda: fake_sp)
    from spotify_mcp.tools.smart_tools import now_playing
    out = await now_playing({})
    assert out["name"] == "T"
    assert out["backend"] == "webapi_fallback"


@pytest.mark.asyncio
async def test_play_pause_smart_premium_required_when_free_and_no_local(monkeypatch):
    monkeypatch.setattr("spotify_mcp.tools.smart_tools.select_backend",
                        lambda: None)
    fake_sp = MagicMock()
    import spotipy
    fake_sp.start_playback.side_effect = spotipy.SpotifyException(
        403, -1, "Restriction violated: Premium required", headers={})
    fake_sp.devices.return_value = {"devices": []}
    monkeypatch.setattr("spotify_mcp.tools.smart_tools._client",
                        lambda: fake_sp)
    from spotify_mcp.tools.smart_tools import play_pause_smart
    out = await play_pause_smart({"action": "play"})
    assert out["error"] == "premium_required"
    assert "Open the Spotify desktop app" in out.get("hint", "")

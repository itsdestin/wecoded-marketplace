"""Tests for macOS AppleScript backend (subprocess mocked)."""
import pytest

from spotify_mcp.local.macos import MacOsBackend


@pytest.mark.asyncio
async def test_play_invokes_correct_applescript(monkeypatch):
    captured = []

    async def fake_run(script: str) -> str:
        captured.append(script)
        return ""

    monkeypatch.setattr("spotify_mcp.local.macos._run_osascript", fake_run)
    await MacOsBackend().play()
    assert any('tell application "Spotify"' in s and "play" in s
               for s in captured)


@pytest.mark.asyncio
async def test_is_running_returns_false_on_empty(monkeypatch):
    async def fake_run(script: str) -> str:
        return "false"
    monkeypatch.setattr("spotify_mcp.local.macos._run_osascript", fake_run)
    assert await MacOsBackend().is_running() is False


@pytest.mark.asyncio
async def test_now_playing_parses_track_metadata(monkeypatch):
    # is_running() short-circuits if we don't return "true" first
    call_count = [0]
    async def fake_run(script: str) -> str:
        call_count[0] += 1
        if call_count[0] == 1:  # is_running check
            return "true"
        return "Foo Track‖Bar Artist‖Baz Album‖142000‖30.0"
    monkeypatch.setattr("spotify_mcp.local.macos._run_osascript", fake_run)
    out = await MacOsBackend().now_playing()
    assert out["name"] == "Foo Track"
    assert out["artist"] == "Bar Artist"
    assert out["album"] == "Baz Album"
    assert out["duration_ms"] == 142000
    assert out["position_ms"] == 30000  # 30.0 seconds → 30000 ms
    assert out["backend"] == "local_macos"

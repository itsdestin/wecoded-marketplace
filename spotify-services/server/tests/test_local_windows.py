"""Tests for Windows SMTC backend (winrt mocked).

Tests work cross-platform because we mock the winrt import — the dev box
might be macOS/Linux, but these tests still exercise the WindowsBackend
logic without needing pywinrt."""
from unittest.mock import AsyncMock, MagicMock
import sys
import pytest


@pytest.fixture
def fake_winrt(monkeypatch):
    """Mock the winrt.windows.media.control module."""
    media_control = MagicMock()
    monkeypatch.setitem(sys.modules, "winrt", MagicMock())
    monkeypatch.setitem(sys.modules, "winrt.windows", MagicMock())
    monkeypatch.setitem(sys.modules, "winrt.windows.media", MagicMock())
    monkeypatch.setitem(sys.modules, "winrt.windows.media.control", media_control)
    return media_control


@pytest.mark.asyncio
async def test_is_running_returns_true_when_spotify_session_exists(fake_winrt):
    from spotify_mcp.local.windows import WindowsBackend
    session = MagicMock()
    session.source_app_user_model_id = "Spotify.exe"
    sessions = MagicMock()
    sessions.get_sessions.return_value = [session]
    fake_winrt.GlobalSystemMediaTransportControlsSessionManager.request_async = \
        AsyncMock(return_value=sessions)

    assert await WindowsBackend().is_running() is True


@pytest.mark.asyncio
async def test_is_running_returns_false_when_no_spotify_session(fake_winrt):
    from spotify_mcp.local.windows import WindowsBackend
    session = MagicMock()
    session.source_app_user_model_id = "Chrome.exe"
    sessions = MagicMock()
    sessions.get_sessions.return_value = [session]
    fake_winrt.GlobalSystemMediaTransportControlsSessionManager.request_async = \
        AsyncMock(return_value=sessions)
    assert await WindowsBackend().is_running() is False

"""Tests for the local-backend platform router."""
from unittest.mock import patch

from spotify_mcp.local import select_backend


def test_select_backend_returns_macos_on_darwin():
    with patch("sys.platform", "darwin"):
        from spotify_mcp.local.macos import MacOsBackend
        b = select_backend()
        assert isinstance(b, MacOsBackend)


def test_select_backend_returns_windows_on_win32():
    with patch("sys.platform", "win32"):
        from spotify_mcp.local.windows import WindowsBackend
        b = select_backend()
        assert isinstance(b, WindowsBackend)


def test_select_backend_returns_none_on_unsupported():
    with patch("sys.platform", "linux"):
        assert select_backend() is None

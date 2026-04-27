"""Local backend selector. Returns None on unsupported platforms."""
from __future__ import annotations
import sys

from spotify_mcp.local.base import LocalBackend


def select_backend() -> LocalBackend | None:
    if sys.platform == "darwin":
        from spotify_mcp.local.macos import MacOsBackend
        return MacOsBackend()
    if sys.platform == "win32":
        from spotify_mcp.local.windows import WindowsBackend
        return WindowsBackend()
    return None

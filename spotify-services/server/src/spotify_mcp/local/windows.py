"""Windows local backend via SMTC (System Media Transport Controls).

Reads playback state and issues transport commands through pywinrt's
GlobalSystemMediaTransportControlsSessionManager. SMTC does NOT expose
seek or volume — those raise StructuredError("not_supported", ...) from
the base class."""
from __future__ import annotations
from typing import Any

from spotify_mcp.local.base import LocalBackend
from spotify_mcp.errors import StructuredError


def _smtc():
    """Lazy import — fails cleanly on non-Windows."""
    try:
        from winrt.windows.media.control import (  # type: ignore
            GlobalSystemMediaTransportControlsSessionManager as M,
        )
        return M
    except ImportError as e:
        raise StructuredError("local_backend_unavailable",
                              f"pywinrt not installed: {e}")


def _is_spotify(session) -> bool:
    """SMTC `source_app_user_model_id` for Spotify is `Spotify.exe`
    (Win32 install) or `SpotifyAB.SpotifyMusic_zpdnekdrzrea0!Spotify` (Store)."""
    aumid = session.source_app_user_model_id or ""
    return "Spotify" in aumid


class WindowsBackend(LocalBackend):
    @property
    def name(self) -> str: return "windows"

    async def _spotify_session(self):
        sessions = await _smtc().request_async()
        for s in sessions.get_sessions():
            if _is_spotify(s):
                return s
        return None

    async def is_running(self) -> bool:
        return (await self._spotify_session()) is not None

    async def now_playing(self) -> dict[str, Any] | None:
        s = await self._spotify_session()
        if s is None:
            return None
        props = await s.try_get_media_properties_async()
        timeline = s.get_timeline_properties()
        return {
            "name": props.title or "",
            "artist": props.artist or "",
            "album": props.album_title or "",
            "duration_ms": int(timeline.end_time.duration / 10_000)
                if timeline.end_time else 0,
            "position_ms": int(timeline.position.duration / 10_000)
                if timeline.position else 0,
            "backend": "local_windows",
        }

    async def play(self) -> None:
        s = await self._require_session()
        await s.try_play_async()

    async def pause(self) -> None:
        s = await self._require_session()
        await s.try_pause_async()

    async def next(self) -> None:
        s = await self._require_session()
        await s.try_skip_next_async()

    async def previous(self) -> None:
        s = await self._require_session()
        await s.try_skip_previous_async()

    async def _require_session(self):
        s = await self._spotify_session()
        if s is None:
            raise StructuredError("desktop_app_not_running",
                                  "Spotify desktop app is not running.")
        return s

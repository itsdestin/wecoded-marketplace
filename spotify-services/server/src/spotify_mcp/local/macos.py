"""macOS local backend via osascript subprocess.

Spotify exposes a rich AppleScript dictionary. We invoke `osascript -e <script>`
in async subprocess; output is captured as plain text and parsed."""
from __future__ import annotations
import asyncio
from typing import Any

from spotify_mcp.local.base import LocalBackend


async def _run_osascript(script: str) -> str:
    """Run an AppleScript snippet via osascript. Returns stdout-trimmed."""
    proc = await asyncio.create_subprocess_exec(
        "osascript", "-e", script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        from spotify_mcp.errors import StructuredError
        raise StructuredError("local_backend_error",
                              f"osascript failed: {stderr.decode().strip()}")
    return stdout.decode().strip()


class MacOsBackend(LocalBackend):
    @property
    def name(self) -> str: return "macos"

    async def is_running(self) -> bool:
        out = await _run_osascript(
            'tell application "System Events" to (name of processes) contains "Spotify"'
        )
        return out == "true"

    async def now_playing(self) -> dict[str, Any] | None:
        if not await self.is_running():
            return None
        # Use a unicode sentinel that's vanishingly unlikely in track metadata.
        out = await _run_osascript("""
            tell application "Spotify"
              set theName to name of current track
              set theArtist to artist of current track
              set theAlbum to album of current track
              set theDur to duration of current track
              set thePos to player position
              return theName & "‖" & theArtist & "‖" & theAlbum & "‖" & theDur & "‖" & thePos
            end tell
        """)
        parts = out.split("‖")
        if len(parts) < 5:
            return None
        return {
            "name": parts[0], "artist": parts[1], "album": parts[2],
            "duration_ms": int(parts[3]),
            # AppleScript returns player position in seconds (float); convert.
            "position_ms": int(float(parts[4]) * 1000)
                if "." in parts[4] else int(parts[4]),
            "backend": "local_macos",
        }

    async def play(self) -> None:
        await _run_osascript('tell application "Spotify" to play')

    async def pause(self) -> None:
        await _run_osascript('tell application "Spotify" to pause')

    async def next(self) -> None:
        await _run_osascript('tell application "Spotify" to next track')

    async def previous(self) -> None:
        await _run_osascript('tell application "Spotify" to previous track')

    async def seek_to(self, position_ms: int) -> None:
        seconds = position_ms / 1000.0
        await _run_osascript(
            f'tell application "Spotify" to set player position to {seconds}'
        )

    async def set_volume(self, level: int) -> None:
        # Spotify AppleScript volume is 0-100.
        clamped = max(0, min(100, level))
        await _run_osascript(
            f'tell application "Spotify" to set sound volume to {clamped}'
        )

    async def launch(self) -> None:
        await _run_osascript('tell application "Spotify" to activate')

    async def quit(self) -> None:
        await _run_osascript('tell application "Spotify" to quit')

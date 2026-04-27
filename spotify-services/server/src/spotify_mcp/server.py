"""MCP server wiring — tool registration table and stdio runner.

Tools are registered in `build_server()` so tests can introspect the table
without spawning stdio. `run_stdio()` is the production entrypoint."""
from __future__ import annotations
from typing import Any
from mcp.server import Server  # noqa: F401  # interface-stable since 0.9
from mcp.server.stdio import stdio_server

from spotify_mcp import __version__
from spotify_mcp.tools.webapi_tools import (
    search_query,
    library_saved_tracks,
    library_top_tracks,
    library_top_artists,
    library_recently_played,
    library_save,
    library_remove,
    playlists_list_mine,
    playlists_get_items,
    playlists_add_items,
    playlists_remove_items,
    playlists_reorder,
    playlists_update_details,
    playback_devices,
    playback_transfer_to_device,
    playback_play,
    playback_pause,
    playback_next,
    playback_previous,
    playback_seek,
    playback_set_volume,
    playback_set_repeat,
    playback_set_shuffle,
    queue_add,
    queue_list,
    user_profile,
)
from spotify_mcp.tools.local_tools import (
    local_play, local_pause, local_next, local_previous,
    local_now_playing, local_is_running,
    local_seek_to, local_set_volume, local_launch, local_quit,
)
from spotify_mcp.tools.smart_tools import now_playing, play_pause_smart
from spotify_mcp.tools.export import export_all_playlists


class _SpotifyMcpServer:
    """Thin wrapper around mcp.Server that exposes a synchronous list_tools()
    for tests. Production callers go through `run_stdio()`."""

    def __init__(self) -> None:
        self._tools: dict[str, _ToolEntry] = {}

    def register(self, name: str, handler) -> None:
        self._tools[name] = _ToolEntry(name=name, handler=handler)

    def list_tools(self) -> list["_ToolEntry"]:
        return list(self._tools.values())

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        tool = self._tools.get(name)
        if tool is None:
            return {"error": "unknown_tool", "name": name}
        return await tool.handler(arguments)


class _ToolEntry:
    def __init__(self, name: str, handler) -> None:
        self.name = name
        self.handler = handler


async def _health(_: dict[str, Any]) -> dict[str, Any]:
    return {"status": "ok", "version": __version__}


def build_server() -> _SpotifyMcpServer:
    """Construct the server with all tools registered. Used by tests AND
    by `run_stdio()`. Adding a tool means: import its handler, then
    `s.register("namespace.action", handler)` here."""
    s = _SpotifyMcpServer()
    s.register("server.health", _health)
    s.register("search.query", search_query)
    s.register("library.saved_tracks", library_saved_tracks)
    s.register("library.top_tracks", library_top_tracks)
    s.register("library.top_artists", library_top_artists)
    s.register("library.recently_played", library_recently_played)
    s.register("library.save", library_save)
    s.register("library.remove", library_remove)
    s.register("playlists.list_mine", playlists_list_mine)
    s.register("playlists.get_items", playlists_get_items)
    s.register("playlists.add_items", playlists_add_items)
    s.register("playlists.remove_items", playlists_remove_items)
    s.register("playlists.reorder", playlists_reorder)
    s.register("playlists.update_details", playlists_update_details)
    s.register("playback.devices", playback_devices)
    s.register("playback.transfer_to_device", playback_transfer_to_device)
    s.register("playback.play", playback_play)
    s.register("playback.pause", playback_pause)
    s.register("playback.next", playback_next)
    s.register("playback.previous", playback_previous)
    s.register("playback.seek", playback_seek)
    s.register("playback.set_volume", playback_set_volume)
    s.register("playback.set_repeat", playback_set_repeat)
    s.register("playback.set_shuffle", playback_set_shuffle)
    s.register("queue.add", queue_add)
    s.register("queue.list", queue_list)
    s.register("user.profile", user_profile)
    s.register("local.play", local_play)
    s.register("local.pause", local_pause)
    s.register("local.next", local_next)
    s.register("local.previous", local_previous)
    s.register("local.now_playing", local_now_playing)
    s.register("local.is_running", local_is_running)
    s.register("local.seek_to", local_seek_to)
    s.register("local.set_volume", local_set_volume)
    s.register("local.launch", local_launch)
    s.register("local.quit", local_quit)
    s.register("now_playing", now_playing)
    s.register("play_pause_smart", play_pause_smart)
    s.register("export_all_playlists", export_all_playlists)
    return s


async def run_stdio() -> None:
    """Run the MCP server over stdio. Production entrypoint.

    Bridges our internal _SpotifyMcpServer (which uses plain dicts) to the
    mcp.Server protocol (which since SDK v1.x requires Pydantic Tool /
    TextContent objects). Earlier versions of this function returned dicts
    directly — that worked under SDK 0.x, but SDK 1.x reads fields via
    attribute access (`tool.name`) and crashes 'tools/list' with
    "'dict' object has no attribute 'name'". Verified live with mcp 1.27.0
    on 2026-04-26."""
    import json as _json
    from mcp.server import Server as _Server
    from mcp.types import Tool as _Tool, TextContent as _TextContent

    s = build_server()
    async with stdio_server() as (read, write):
        proto = _Server("spotify-services")

        @proto.list_tools()
        async def _list() -> list[_Tool]:
            return [
                _Tool(
                    name=t.name,
                    description=f"{t.name} (v{__version__})",
                    inputSchema={
                        "type": "object",
                        "properties": {},
                        "additionalProperties": True,
                    },
                )
                for t in s.list_tools()
            ]

        @proto.call_tool()
        async def _call(name: str, arguments: dict[str, Any] | None) -> list[_TextContent]:
            result = await s.call_tool(name, arguments or {})
            # All our tools return JSON-able dicts. Wrap in a single
            # TextContent block — clients that want structured output can
            # parse the .text as JSON.
            return [_TextContent(type="text", text=_json.dumps(result, ensure_ascii=False))]

        await proto.run(read, write, proto.create_initialization_options())

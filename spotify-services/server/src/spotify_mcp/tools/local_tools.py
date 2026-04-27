"""MCP tool handlers for local.* tools."""
from __future__ import annotations
from typing import Any

from spotify_mcp.local import select_backend
from spotify_mcp.errors import StructuredError


def _safe(handler):
    async def _wrap(args: dict[str, Any]) -> dict[str, Any]:
        try:
            backend = select_backend()
            if backend is None:
                return {"error": "local_backend_unavailable",
                        "message": "No local backend for this OS (v1: macOS + Windows only)."}
            return await handler(backend, args)
        except StructuredError as e:
            return e.to_json()
    return _wrap


@_safe
async def local_play(backend, _): await backend.play(); return {"ok": True}

@_safe
async def local_pause(backend, _): await backend.pause(); return {"ok": True}

@_safe
async def local_next(backend, _): await backend.next(); return {"ok": True}

@_safe
async def local_previous(backend, _): await backend.previous(); return {"ok": True}

@_safe
async def local_now_playing(backend, _):
    out = await backend.now_playing()
    return out if out else {"playing": False}

@_safe
async def local_is_running(backend, _):
    return {"running": await backend.is_running()}

@_safe
async def local_seek_to(backend, args):
    await backend.seek_to(int(args["position_ms"])); return {"ok": True}

@_safe
async def local_set_volume(backend, args):
    await backend.set_volume(int(args["level"])); return {"ok": True}

@_safe
async def local_launch(backend, _): await backend.launch(); return {"ok": True}

@_safe
async def local_quit(backend, _): await backend.quit(); return {"ok": True}

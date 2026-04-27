"""Smart-routed MCP tools: now_playing, play_pause_smart."""
from __future__ import annotations
from typing import Any

from spotify_mcp.errors import StructuredError
from spotify_mcp.local import select_backend
from spotify_mcp.tools.routing import decide_transport_route
from spotify_mcp.tools.webapi_tools import _client  # reuse client builder


async def now_playing(args: dict[str, Any]) -> dict[str, Any]:
    """Smart now_playing.

    Defaults to local backend (free, instant). If `enrich=true`, follows
    up with a Web API lookup to attach the Spotify track URI / ISRC."""
    enrich = bool(args.get("enrich", False))
    backend = select_backend()
    if backend is not None:
        out = await backend.now_playing()
        if out is not None:
            out = dict(out)
            out["enriched"] = False
            if enrich:
                try:
                    sp = _client()
                    cur = sp.current_playback()
                    if cur and cur.get("item"):
                        out["spotify_uri"] = cur["item"]["uri"]
                        if cur["item"].get("external_ids", {}).get("isrc"):
                            out["isrc"] = cur["item"]["external_ids"]["isrc"]
                        out["enriched"] = True
                except StructuredError:
                    pass  # Enrichment is best-effort.
            return out

    # No local backend or local says nothing playing — try Web API.
    try:
        sp = _client()
        cur = sp.current_playback()
        if not cur or not cur.get("item"):
            return {"playing": False, "backend": "webapi_fallback"}
        return {
            "name": cur["item"]["name"],
            "artist": ", ".join(a["name"] for a in cur["item"]["artists"]),
            "album": cur["item"]["album"]["name"],
            "duration_ms": cur["item"]["duration_ms"],
            "position_ms": cur.get("progress_ms", 0),
            "backend": "webapi_fallback",
        }
    except StructuredError as e:
        return e.to_json()


async def play_pause_smart(args: dict[str, Any]) -> dict[str, Any]:
    """Single tool that "just works" regardless of where playback is.

    action: 'play' | 'pause' | 'next' | 'previous'

    Routing: prefer local when desktop app is the active device (avoids
    the split-brain bug where local pauses the laptop while the phone
    keeps playing). Free-tier+no-local-app returns premium_required."""
    action = args.get("action") or "play"
    backend = select_backend()

    try:
        sp = _client()
        fetch = lambda: sp.devices()  # noqa: E731
    except StructuredError:
        sp = None
        fetch = lambda: {"devices": []}  # noqa: E731

    route = await decide_transport_route(backend=backend, fetch_devices=fetch)

    if route == "local" and backend is not None:
        try:
            await getattr(backend, action)()
            return {"ok": True, "backend": backend.name}
        except StructuredError as e:
            return e.to_json()

    if sp is None:
        return {"error": "no_route_available",
                "hint": "Local backend unavailable AND no Spotify access. "
                        "Run /spotify-services-setup."}

    try:
        if action == "play": sp.start_playback()
        elif action == "pause": sp.pause_playback()
        elif action == "next": sp.next_track()
        elif action == "previous": sp.previous_track()
        else:
            return {"error": "bad_request", "message": f"Unknown action: {action}"}
        return {"ok": True, "backend": "webapi"}
    except Exception as e:
        # Spotify SDK 403 -> premium_required via webapi.client.
        from spotify_mcp.webapi.client import _translate
        import spotipy
        if isinstance(e, spotipy.SpotifyException):
            err = _translate(e)
            out = err.to_json()
            if err.code == "premium_required":
                out["hint"] = ("Open the Spotify desktop app to play "
                               "locally without Premium.")
            return out
        return {"error": "upstream_error", "message": str(e)}

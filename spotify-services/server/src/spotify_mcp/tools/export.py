"""export_all_playlists composite tool — the tutor's specific need.

Produces a JSON file matching tutor master spec §7.1:
  {user_id, fetched_at, playlists: [{...full Spotify shape, with tracks: [...]}]}

Atomic write: writes to <path>.tmp first, then os.replace() to target. On
any failure mid-stream, the existing target file is untouched."""
from __future__ import annotations
import json
import os
import time
from pathlib import Path
from typing import Any

from spotify_mcp.errors import StructuredError
from spotify_mcp.tools.webapi_tools import _client
from spotify_mcp.webapi.client import call


async def export_all_playlists(args: dict[str, Any]) -> dict[str, Any]:
    target = Path(args["path"]).expanduser()
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".tmp")

    try:
        sp = _client()
        user = call(sp.current_user)
        playlists: list[dict[str, Any]] = []
        track_count = 0

        # Page through all playlists.
        page = call(sp.current_user_playlists, limit=50)
        while page:
            for pl in page.get("items", []):
                pl_id = pl["id"]
                tracks: list[dict[str, Any]] = []
                # Page through all items for this playlist.
                items_page = call(sp.playlist_items, pl_id, limit=100)
                while items_page:
                    tracks.extend(items_page.get("items", []))
                    if not items_page.get("next"):
                        break
                    items_page = call(sp.next, items_page)
                pl_out = dict(pl)
                pl_out["tracks"] = tracks
                playlists.append(pl_out)
                track_count += len(tracks)

            if not page.get("next"):
                break
            page = call(sp.next, page)

        out = {
            "user_id": user["id"],
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "playlists": playlists,
        }

        tmp.write_text(json.dumps(out, indent=2, ensure_ascii=False))
        os.replace(tmp, target)
        return {
            "written": str(target),
            "playlist_count": len(playlists),
            "track_count": track_count,
            "user_id": user["id"],
        }
    except StructuredError as e:
        # Cleanup tmp and preserve existing target.
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
        return e.to_json()
    except Exception as e:
        if tmp.exists():
            try:
                tmp.unlink()
            except OSError:
                pass
        return {"error": "export_failed", "message": str(e)}

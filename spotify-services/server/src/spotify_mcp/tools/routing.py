"""Smart-routing decision rules.

Transport routing avoids the split-brain hazard the spec flagged:
local backend "running" doesn't imply local-as-active-Web-API-device.
We only route to local when (a) a local backend exists, (b) the
desktop app is running, AND (c) the Web API's active device is the
desktop (heuristic: device.type == 'Computer' or name matches host)."""
from __future__ import annotations
import socket
from typing import Awaitable, Callable

from spotify_mcp.local.base import LocalBackend


async def decide_transport_route(
    *,
    backend: LocalBackend | None,
    fetch_devices: Callable[[], dict],
) -> str:
    """Returns 'local' or 'webapi'.

    'local' only when: backend exists + desktop app running + active
    Web API device looks like the desktop (Computer type, or name
    contains hostname)."""
    if backend is None:
        return "webapi"
    if not await backend.is_running():
        return "webapi"

    # Web API active-device check.
    try:
        devices = (fetch_devices() or {}).get("devices", [])
    except Exception:
        # Web API call failed — fall through to local since it works
        # offline. If the local call subsequently fails, the caller's
        # safe wrapper translates the error.
        return "local"

    active = next((d for d in devices if d.get("is_active")), None)
    if active is None:
        # Nothing playing on Web API — local is fine.
        return "local"

    host = socket.gethostname().lower()
    name = (active.get("name") or "").lower()
    dtype = (active.get("type") or "").lower()
    if dtype == "computer" or host in name or name in host:
        return "local"
    return "webapi"

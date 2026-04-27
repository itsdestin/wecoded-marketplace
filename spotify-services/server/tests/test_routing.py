"""Tests for smart-routing decisions."""
from unittest.mock import AsyncMock, MagicMock
import pytest

from spotify_mcp.tools.routing import decide_transport_route


@pytest.mark.asyncio
async def test_route_local_when_desktop_is_active_smtc_session():
    backend = MagicMock()
    backend.is_running = AsyncMock(return_value=True)
    sp_devices = lambda: {"devices": [
        {"is_active": True, "name": "DESKTOP-XYZ", "type": "Computer"},
    ]}
    route = await decide_transport_route(backend=backend,
                                          fetch_devices=sp_devices)
    assert route == "local"


@pytest.mark.asyncio
async def test_route_webapi_when_active_device_is_phone():
    backend = MagicMock()
    backend.is_running = AsyncMock(return_value=True)
    sp_devices = lambda: {"devices": [
        {"is_active": True, "name": "iPhone", "type": "Smartphone"},
    ]}
    route = await decide_transport_route(backend=backend,
                                          fetch_devices=sp_devices)
    assert route == "webapi"


@pytest.mark.asyncio
async def test_route_webapi_when_desktop_app_not_running():
    backend = MagicMock()
    backend.is_running = AsyncMock(return_value=False)
    route = await decide_transport_route(
        backend=backend, fetch_devices=lambda: {"devices": []})
    assert route == "webapi"


@pytest.mark.asyncio
async def test_route_webapi_when_no_local_backend():
    """No local backend = unconditional webapi."""
    route = await decide_transport_route(
        backend=None, fetch_devices=lambda: {"devices": []})
    assert route == "webapi"


@pytest.mark.asyncio
async def test_route_local_when_no_active_webapi_device():
    """Desktop running, nothing playing on Web API → local is fine."""
    backend = MagicMock()
    backend.is_running = AsyncMock(return_value=True)
    sp_devices = lambda: {"devices": [
        {"is_active": False, "name": "iPhone", "type": "Smartphone"},
    ]}
    route = await decide_transport_route(backend=backend,
                                          fetch_devices=sp_devices)
    assert route == "local"


@pytest.mark.asyncio
async def test_route_local_when_devices_call_throws():
    """Web API call failed — fall through to local."""
    backend = MagicMock()
    backend.is_running = AsyncMock(return_value=True)
    def boom(): raise RuntimeError("network")
    route = await decide_transport_route(backend=backend, fetch_devices=boom)
    assert route == "local"

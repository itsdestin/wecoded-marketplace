"""Tests for the MCP server's tool registration table."""
import pytest

from spotify_mcp.server import build_server


def test_health_tool_is_registered():
    server = build_server()
    tool_names = {t.name for t in server.list_tools()}
    assert "server.health" in tool_names


@pytest.mark.asyncio
async def test_health_tool_returns_ok():
    server = build_server()
    result = await server.call_tool("server.health", {})
    assert result == {"status": "ok", "version": "0.1.0"}

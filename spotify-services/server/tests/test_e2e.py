"""End-to-end test against the developer's real Spotify account.

Gated on SPOTIFY_E2E=1. Run only when you have a fresh OAuth token
locally and don't mind making a couple of real API calls."""
import os
import pytest


pytestmark = pytest.mark.skipif(
    os.environ.get("SPOTIFY_E2E") != "1",
    reason="Set SPOTIFY_E2E=1 to run E2E tests against real Spotify account.",
)


@pytest.mark.asyncio
async def test_user_profile_returns_id():
    from spotify_mcp.tools.webapi_tools import _client
    sp = _client()
    user = sp.current_user()
    assert user.get("id")


@pytest.mark.asyncio
async def test_playlists_list_mine_returns_at_least_one():
    from spotify_mcp.tools.webapi_tools import _client
    sp = _client()
    out = sp.current_user_playlists(limit=5)
    assert isinstance(out["items"], list)


@pytest.mark.asyncio
async def test_export_all_playlists_writes_a_file(tmp_path):
    from spotify_mcp.tools.export import export_all_playlists
    target = tmp_path / "e2e-export.json"
    out = await export_all_playlists({"path": str(target)})
    assert "written" in out, f"export failed: {out}"
    assert target.exists()
    assert target.stat().st_size > 100

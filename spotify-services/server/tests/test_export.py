"""Tests for export_all_playlists composite tool."""
import json
from pathlib import Path
from unittest.mock import MagicMock
import pytest


@pytest.mark.asyncio
async def test_export_writes_json_with_master_spec_shape(tmp_path, monkeypatch):
    fake_sp = MagicMock()
    fake_sp.current_user.return_value = {"id": "destin"}
    fake_sp.current_user_playlists.return_value = {
        "items": [{"id": "p1", "name": "Mix 1"}], "next": None
    }
    fake_sp.playlist_items.return_value = {
        "items": [{"track": {"id": "t1", "name": "Song"}}], "next": None
    }
    monkeypatch.setattr("spotify_mcp.tools.export._client", lambda: fake_sp)

    from spotify_mcp.tools.export import export_all_playlists
    target = tmp_path / "playlists.json"
    out = await export_all_playlists({"path": str(target)})

    assert out["written"] == str(target)
    assert out["playlist_count"] == 1
    assert out["track_count"] == 1

    data = json.loads(target.read_text())
    assert "user_id" in data
    assert data["user_id"] == "destin"
    assert "fetched_at" in data
    assert isinstance(data["playlists"], list)
    assert data["playlists"][0]["name"] == "Mix 1"
    assert data["playlists"][0]["tracks"][0]["track"]["name"] == "Song"


@pytest.mark.asyncio
async def test_export_atomic_replace_on_failure(tmp_path, monkeypatch):
    """If the write fails mid-stream, the existing file is preserved."""
    target = tmp_path / "playlists.json"
    target.write_text('{"existing": true}')

    fake_sp = MagicMock()
    fake_sp.current_user.return_value = {"id": "destin"}
    fake_sp.current_user_playlists.side_effect = RuntimeError("net fail")
    monkeypatch.setattr("spotify_mcp.tools.export._client", lambda: fake_sp)

    from spotify_mcp.tools.export import export_all_playlists
    target_path = str(target)
    out = await export_all_playlists({"path": target_path})

    assert "error" in out
    # Existing file is preserved
    assert json.loads(target.read_text()) == {"existing": True}


@pytest.mark.asyncio
async def test_export_paginates_playlists_and_tracks(tmp_path, monkeypatch):
    """Multi-page playlists AND multi-page tracks both get followed."""
    fake_sp = MagicMock()
    fake_sp.current_user.return_value = {"id": "u"}
    # Two pages of playlists
    fake_sp.current_user_playlists.return_value = {
        "items": [{"id": "p1", "name": "A"}], "next": "url1"
    }
    # Page 2 of playlists fetched via sp.next()
    page2_pl = {"items": [{"id": "p2", "name": "B"}], "next": None}
    # Two pages of items per playlist
    fake_sp.playlist_items.return_value = {
        "items": [{"track": {"id": "t1"}}], "next": "url2"
    }
    page2_items = {"items": [{"track": {"id": "t2"}}], "next": None}

    # sp.next() should be called twice (once for pl page 2, once for items page 2)
    # ...actually three times: once per playlist's items, plus the playlists pagination.
    # The function calls sp.next on whatever has a "next" link.
    next_calls = []
    def fake_next(prev):
        next_calls.append(prev)
        if prev.get("next") == "url1":
            return page2_pl
        if prev.get("next") == "url2":
            return page2_items
        return None
    fake_sp.next = fake_next
    monkeypatch.setattr("spotify_mcp.tools.export._client", lambda: fake_sp)

    from spotify_mcp.tools.export import export_all_playlists
    target = tmp_path / "out.json"
    out = await export_all_playlists({"path": str(target)})

    assert out["playlist_count"] == 2
    # 1 track per playlist on page 1, 1 track per playlist on page 2 = 2 per pl × 2 pls = 4
    assert out["track_count"] == 4

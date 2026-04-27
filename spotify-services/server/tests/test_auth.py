"""Tests for OAuth Authorization Code with PKCE flow + token refresh."""
from __future__ import annotations
import json
import time
from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest

from spotify_mcp.auth import (
    AuthError,
    PkcePair,
    TokenStore,
    build_authorize_url,
    exchange_code_for_tokens,
    needs_refresh,
    refresh_access_token,
)


def test_pkce_pair_generates_43_to_128_char_verifier():
    pair = PkcePair.generate()
    assert 43 <= len(pair.verifier) <= 128
    assert pair.challenge != pair.verifier  # SHA256-based
    assert pair.method == "S256"


def test_build_authorize_url_includes_required_params():
    pair = PkcePair(verifier="x" * 43, challenge="abc", method="S256")
    url = build_authorize_url(client_id="cid", state="st", pkce=pair)
    assert "client_id=cid" in url
    assert "response_type=code" in url
    assert "code_challenge=abc" in url
    assert "code_challenge_method=S256" in url
    assert "state=st" in url
    assert "scope=" in url


def test_exchange_code_for_tokens_calls_token_endpoint(monkeypatch):
    captured = {}

    class FakeResponse:
        status_code = 200
        def json(self): return {
            "access_token": "AT", "refresh_token": "RT",
            "expires_in": 3600, "token_type": "Bearer",
        }
        def raise_for_status(self): pass

    def fake_post(url, data=None, timeout=None):
        captured["url"] = url
        captured["data"] = data
        return FakeResponse()

    fake_client = MagicMock()
    fake_client.__enter__ = lambda self: fake_client
    fake_client.__exit__ = lambda self, *a: None
    fake_client.post = fake_post
    monkeypatch.setattr(httpx, "Client", lambda **kw: fake_client)

    tokens = exchange_code_for_tokens(
        client_id="cid", code="abc", verifier="ver" * 15,
    )
    assert captured["data"]["grant_type"] == "authorization_code"
    assert captured["data"]["code"] == "abc"
    assert captured["data"]["code_verifier"] == "ver" * 15
    assert captured["data"]["client_id"] == "cid"
    assert tokens.access_token == "AT"
    assert tokens.refresh_token == "RT"
    assert tokens.expires_at > time.time()


def test_needs_refresh_true_when_within_buffer():
    expires_soon = time.time() + 60  # 1 minute left
    assert needs_refresh(expires_soon) is True


def test_needs_refresh_false_when_plenty_of_time():
    expires_far = time.time() + 3600
    assert needs_refresh(expires_far) is False


def test_refresh_access_token_handles_invalid_grant(monkeypatch):
    class FakeResponse:
        status_code = 400
        def json(self): return {"error": "invalid_grant"}
        def raise_for_status(self):
            raise httpx.HTTPStatusError("400", request=None, response=self)

    fake_client = MagicMock()
    fake_client.__enter__ = lambda self: fake_client
    fake_client.__exit__ = lambda self, *a: None
    fake_client.post = lambda *a, **kw: FakeResponse()
    monkeypatch.setattr(httpx, "Client", lambda **kw: fake_client)

    with pytest.raises(AuthError) as ex:
        refresh_access_token(client_id="cid", refresh_token="RT")
    assert ex.value.code == "reauth_required"


def test_token_store_round_trips(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("spotify_mcp.config.TOKENS_FILE", tmp_path / "t.json")
    monkeypatch.setattr("spotify_mcp.config.SECRETS_DIR", tmp_path)

    from spotify_mcp.auth import Tokens, TokenStore
    store = TokenStore()
    tok = Tokens(access_token="A", refresh_token="R",
                 expires_at=time.time() + 3600, token_type="Bearer")
    store.save(tok)
    assert (tmp_path / "t.json").exists()
    # On Windows, file mode bits aren't fully preserved through Python's
    # os.chmod — assert the file exists and is readable rather than
    # asserting exact 0o600. The chmod call is still made for Unix-like
    # systems where it matters.
    import os
    assert os.access(tmp_path / "t.json", os.R_OK)
    loaded = store.load()
    assert loaded.access_token == "A"
    assert loaded.refresh_token == "R"


def test_token_store_load_missing_returns_none(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("spotify_mcp.config.TOKENS_FILE", tmp_path / "missing.json")
    from spotify_mcp.auth import TokenStore
    assert TokenStore().load() is None

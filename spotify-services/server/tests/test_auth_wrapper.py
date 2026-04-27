"""Tests for `with_access_token`, the helper every Web API tool uses."""
import time
from unittest.mock import MagicMock
import pytest

from spotify_mcp.auth import AuthError, Tokens, with_access_token


def test_with_access_token_returns_token_when_fresh(monkeypatch):
    fresh = Tokens(access_token="A", refresh_token="R",
                   expires_at=time.time() + 3600, token_type="Bearer")
    store = MagicMock()
    store.load.return_value = fresh
    refresh = MagicMock()
    token = with_access_token(client_id="cid", store=store, refresh_fn=refresh)
    assert token == "A"
    refresh.assert_not_called()


def test_with_access_token_refreshes_when_near_expiry(monkeypatch):
    near_expiry = Tokens(access_token="OLD", refresh_token="R",
                         expires_at=time.time() + 60, token_type="Bearer")
    refreshed = Tokens(access_token="NEW", refresh_token="R",
                       expires_at=time.time() + 3600, token_type="Bearer")
    store = MagicMock()
    store.load.return_value = near_expiry
    refresh_fn = MagicMock(return_value=refreshed)
    token = with_access_token(client_id="cid", store=store, refresh_fn=refresh_fn)
    assert token == "NEW"
    store.save.assert_called_once_with(refreshed)


def test_with_access_token_raises_when_no_tokens(monkeypatch):
    store = MagicMock()
    store.load.return_value = None
    with pytest.raises(AuthError) as ex:
        with_access_token(client_id="cid", store=store, refresh_fn=lambda **kw: None)
    assert ex.value.code == "reauth_required"

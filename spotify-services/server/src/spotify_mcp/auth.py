"""OAuth Authorization Code with PKCE + token persistence + refresh.

PKCE flow chosen because Spotify mandates it for new apps post-Nov-2025
and because it requires no Client Secret — the app's only credential
on the user's machine is the Client ID, which is not a secret."""
from __future__ import annotations
import base64
import hashlib
import json
import os
import secrets
import time
import urllib.parse
from dataclasses import dataclass
from typing import Optional

import httpx

from spotify_mcp.config import (
    REFRESH_BUFFER_SECONDS,
    SCOPE_STRING,
    SECRETS_DIR,
    SPOTIFY_AUTH_URL,
    SPOTIFY_TOKEN_URL,
    TOKENS_FILE,
    REDIRECT_URI,
)


class AuthError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(f"{code}: {message}")


@dataclass(frozen=True)
class PkcePair:
    verifier: str
    challenge: str
    method: str

    @classmethod
    def generate(cls) -> "PkcePair":
        # 64 bytes → 86-char base64url verifier (within 43-128 spec range).
        verifier = secrets.token_urlsafe(64)[:128]
        digest = hashlib.sha256(verifier.encode("ascii")).digest()
        challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
        return cls(verifier=verifier, challenge=challenge, method="S256")


@dataclass
class Tokens:
    access_token: str
    refresh_token: str
    expires_at: float  # unix epoch
    token_type: str = "Bearer"

    def to_json(self) -> dict:
        return {
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "expires_at": self.expires_at,
            "token_type": self.token_type,
        }

    @classmethod
    def from_json(cls, data: dict) -> "Tokens":
        return cls(**data)


def build_authorize_url(client_id: str, state: str, pkce: PkcePair) -> str:
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPE_STRING,
        "state": state,
        "code_challenge_method": pkce.method,
        "code_challenge": pkce.challenge,
    }
    return f"{SPOTIFY_AUTH_URL}?{urllib.parse.urlencode(params)}"


def exchange_code_for_tokens(client_id: str, code: str, verifier: str) -> Tokens:
    """Exchange the authorization code for an access+refresh token pair."""
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            SPOTIFY_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": REDIRECT_URI,
                "client_id": client_id,
                "code_verifier": verifier,
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        body = resp.json()
    return Tokens(
        access_token=body["access_token"],
        refresh_token=body["refresh_token"],
        expires_at=time.time() + int(body["expires_in"]),
        token_type=body.get("token_type", "Bearer"),
    )


def refresh_access_token(client_id: str, refresh_token: str) -> Tokens:
    """Refresh the access token. Raises AuthError(code='reauth_required')
    if the refresh token itself has been revoked."""
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            SPOTIFY_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": client_id,
            },
            timeout=30.0,
        )
        if resp.status_code >= 400:
            try:
                body = resp.json()
            except Exception:
                body = {"error": "unknown"}
            if body.get("error") == "invalid_grant":
                raise AuthError("reauth_required",
                                "Refresh token rejected — run /spotify-services-reauth.")
            raise AuthError("token_endpoint_error", json.dumps(body))
        body = resp.json()
    return Tokens(
        access_token=body["access_token"],
        # Spotify may or may not rotate the refresh token. If absent, keep old.
        refresh_token=body.get("refresh_token", refresh_token),
        expires_at=time.time() + int(body["expires_in"]),
        token_type=body.get("token_type", "Bearer"),
    )


def needs_refresh(expires_at: float) -> bool:
    return (expires_at - time.time()) < REFRESH_BUFFER_SECONDS


class TokenStore:
    """Reads/writes tokens.json with mode-600 enforcement."""

    def save(self, tokens: Tokens) -> None:
        # Re-import to honor monkeypatched paths in tests.
        from spotify_mcp import config as _cfg
        _cfg.SECRETS_DIR.mkdir(parents=True, exist_ok=True)
        # Write+chmod atomically by setting the mode at create time.
        fd = os.open(_cfg.TOKENS_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as f:
            json.dump(tokens.to_json(), f, indent=2)
        # On Windows os.open ignores the mode; chmod separately to be safe.
        try:
            os.chmod(_cfg.TOKENS_FILE, 0o600)
        except OSError:
            pass

    def load(self) -> Optional[Tokens]:
        from spotify_mcp import config as _cfg
        if not _cfg.TOKENS_FILE.exists():
            return None
        with open(_cfg.TOKENS_FILE) as f:
            return Tokens.from_json(json.load(f))


def with_access_token(*, client_id: str, store: TokenStore, refresh_fn=refresh_access_token) -> str:
    """Returns a fresh access token. Refreshes if within the buffer.
    Raises AuthError(code='reauth_required') if no tokens exist or the
    refresh token has been revoked."""
    tokens = store.load()
    if tokens is None:
        raise AuthError("reauth_required",
                        "No tokens on disk — run /spotify-services-setup.")
    if needs_refresh(tokens.expires_at):
        tokens = refresh_fn(client_id=client_id, refresh_token=tokens.refresh_token)
        store.save(tokens)
    return tokens.access_token

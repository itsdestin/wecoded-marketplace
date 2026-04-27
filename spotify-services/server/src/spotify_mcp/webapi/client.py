"""spotipy wrapper with single-retry-on-429 and structured-error translation."""
from __future__ import annotations
import time
from typing import Any, Callable

import spotipy

from spotify_mcp.errors import StructuredError


def retry_after_seconds(err: spotipy.SpotifyException) -> int:
    """Read Retry-After header from a 429. Falls back to 1s if absent or
    non-integer."""
    raw = (err.headers or {}).get("Retry-After", "1")
    try:
        return max(1, int(raw))
    except (TypeError, ValueError):
        return 1


def call(fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    """Invoke a spotipy method, translating exceptions into StructuredError.

    Single-retry-on-429: on the first 429, sleep `Retry-After` seconds and
    retry once. On the second 429, surface a structured `rate_limited`
    error so the caller can decide what to do next."""
    try:
        return fn(*args, **kwargs)
    except spotipy.SpotifyException as e:
        if e.http_status == 429:
            wait = retry_after_seconds(e)
            time.sleep(wait)
            try:
                return fn(*args, **kwargs)
            except spotipy.SpotifyException as e2:
                if e2.http_status == 429:
                    raise StructuredError(
                        "rate_limited", "Spotify rate limit hit.",
                        {"retry_after_s": retry_after_seconds(e2)},
                    )
                raise _translate(e2)
        raise _translate(e)


def _translate(e: spotipy.SpotifyException) -> StructuredError:
    msg = (e.msg or "").lower()
    if e.http_status == 401:
        return StructuredError("reauth_required", e.msg or "")
    if e.http_status == 403:
        if "premium" in msg or "restricted" in msg:
            return StructuredError("premium_required", e.msg or "")
        if "scope" in msg:
            return StructuredError("scope_missing", e.msg or "")
        return StructuredError("forbidden", e.msg or "")
    if e.http_status == 404:
        return StructuredError("not_found", e.msg or "")
    if e.http_status == 400:
        return StructuredError("bad_request", e.msg or "")
    return StructuredError("upstream_error",
                            f"HTTP {e.http_status}: {e.msg or ''}")

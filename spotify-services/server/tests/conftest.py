"""Shared pytest fixtures for spotify_mcp tests."""
import pytest


@pytest.fixture
def fake_now() -> float:
    """Frozen unix timestamp for tests that touch token expiry."""
    return 1_745_000_000.0  # ~April 18, 2025

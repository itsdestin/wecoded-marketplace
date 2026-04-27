"""Tests for webapi.playback — Premium-gated transport controls.

Critical test: test_pause_premium_403_translates_to_premium_required guards
the 403→premium_required translation path in webapi/client.py._translate."""
from unittest.mock import MagicMock
import pytest
import spotipy

from spotify_mcp.errors import StructuredError


def _import():
    """Deferred import so test collection succeeds before the module exists."""
    from spotify_mcp.webapi.playback import (
        devices,
        transfer_to_device,
        play,
        pause,
        next_track,
        previous_track,
        seek,
        set_volume,
        set_repeat,
        set_shuffle,
    )
    return (devices, transfer_to_device, play, pause, next_track,
            previous_track, seek, set_volume, set_repeat, set_shuffle)


# ---------------------------------------------------------------------------
# devices
# ---------------------------------------------------------------------------

def test_devices_routes_to_spotipy():
    (devices, *_) = _import()
    sp = MagicMock()
    expected = {"devices": [{"id": "dev1", "name": "Phone"}]}
    sp.devices.return_value = expected
    result = devices(sp)
    sp.devices.assert_called_once()
    assert result == expected


# ---------------------------------------------------------------------------
# play
# ---------------------------------------------------------------------------

def test_play_passes_uris_and_position():
    (_, _, play, *_) = _import()
    sp = MagicMock()
    sp.start_playback.return_value = None
    uris = ["spotify:track:abc", "spotify:track:def"]
    play(sp, uris=uris, position_ms=30000)
    kwargs = sp.start_playback.call_args.kwargs
    assert kwargs["uris"] == uris
    assert kwargs["position_ms"] == 30000


# ---------------------------------------------------------------------------
# pause — Premium-error path (CRITICAL)
# ---------------------------------------------------------------------------

def test_pause_premium_403_translates_to_premium_required():
    """CRITICAL: When Spotify returns 403 'Restriction violated: Premium
    required', webapi/client._translate must map it to StructuredError
    with code 'premium_required'. This test explicitly raises the spotipy
    exception and asserts the translated error code."""
    (_, _, _, pause, *_) = _import()
    sp = MagicMock()
    # Explicitly raise what Spotify returns for non-Premium accounts
    sp.pause_playback.side_effect = spotipy.SpotifyException(
        403, -1, "Restriction violated: Premium required", headers={}
    )
    with pytest.raises(StructuredError) as exc_info:
        pause(sp)
    assert exc_info.value.code == "premium_required"


# ---------------------------------------------------------------------------
# seek
# ---------------------------------------------------------------------------

def test_seek_passes_position_ms_and_device_id():
    (_, _, _, _, _, _, seek, *_) = _import()
    sp = MagicMock()
    sp.seek_track.return_value = None
    seek(sp, position_ms=45000, device_id="dev42")
    kwargs = sp.seek_track.call_args.kwargs
    assert kwargs["position_ms"] == 45000
    assert kwargs["device_id"] == "dev42"


# ---------------------------------------------------------------------------
# set_volume
# ---------------------------------------------------------------------------

def test_set_volume_passes_percent():
    (_, _, _, _, _, _, _, set_volume, *_) = _import()
    sp = MagicMock()
    sp.volume.return_value = None
    set_volume(sp, volume_percent=75)
    kwargs = sp.volume.call_args.kwargs
    assert kwargs["volume_percent"] == 75


# ---------------------------------------------------------------------------
# set_repeat
# ---------------------------------------------------------------------------

def test_set_repeat_validates_state():
    (_, _, _, _, _, _, _, _, set_repeat, _) = _import()
    sp = MagicMock()
    sp.repeat.return_value = None

    for state in ("track", "context", "off"):
        sp.reset_mock()
        set_repeat(sp, state=state)
        kwargs = sp.repeat.call_args.kwargs
        assert kwargs["state"] == state


# ---------------------------------------------------------------------------
# set_shuffle
# ---------------------------------------------------------------------------

def test_set_shuffle_passes_bool():
    (_, _, _, _, _, _, _, _, _, set_shuffle) = _import()
    sp = MagicMock()
    sp.shuffle.return_value = None

    set_shuffle(sp, state=True)
    assert sp.shuffle.call_args.kwargs["state"] is True

    sp.reset_mock()
    set_shuffle(sp, state=False)
    assert sp.shuffle.call_args.kwargs["state"] is False


# ---------------------------------------------------------------------------
# transfer_to_device
# ---------------------------------------------------------------------------

def test_transfer_to_device_passes_force_play():
    (_, transfer_to_device, *_) = _import()
    sp = MagicMock()
    sp.transfer_playback.return_value = None
    transfer_to_device(sp, device_id="devXYZ", force_play=True)
    kwargs = sp.transfer_playback.call_args.kwargs
    assert kwargs["device_id"] == "devXYZ"
    assert kwargs["force_play"] is True

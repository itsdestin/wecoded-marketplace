"""File paths, scope set, OAuth endpoints. Single source of truth.

Token storage path lives under ~/.youcoded/ to match the rest of the
YouCoded ecosystem and to inherit existing sync-exclude rules. The
server install lives at ~/.spotify-services/ because the launcher
script needs a stable, well-known venv path that doesn't move when
~/.youcoded/ is restored from backup."""
from __future__ import annotations
from pathlib import Path

HOME = Path.home()

# Server install location — referenced by launcher.sh.
SERVER_HOME = HOME / ".spotify-services" / "server"

# Token storage — mode 600. Lives under ~/.youcoded/ so it inherits
# the YouCoded sync-exclude rules for secrets.
SECRETS_DIR = HOME / ".youcoded" / "spotify-services"
TOKENS_FILE = SECRETS_DIR / "tokens.json"

# Spotify OAuth endpoints (PKCE flow).
SPOTIFY_AUTH_URL = "https://accounts.spotify.com/authorize"
SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token"
REDIRECT_URI = "http://127.0.0.1:8080/callback"

# Pre-emptive refresh: refresh access tokens with at least this many
# seconds remaining to avoid mid-call expiry.
REFRESH_BUFFER_SECONDS = 300

# Scope set requested at first auth (see spec §6.1).
SCOPES = [
    "user-read-private",
    "user-read-email",
    "playlist-read-private",
    "playlist-read-collaborative",
    "playlist-modify-public",
    "playlist-modify-private",
    "user-library-read",
    "user-library-modify",
    "user-top-read",
    "user-read-recently-played",
    "user-read-playback-state",
    "user-read-currently-playing",
    "user-modify-playback-state",
]
SCOPE_STRING = " ".join(SCOPES)

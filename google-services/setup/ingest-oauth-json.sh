#!/usr/bin/env bash
# ingest-oauth-json.sh
# Consumes the Google OAuth client JSON that the user downloads from Cloud
# Console → Credentials → OAuth client ID → Download JSON. Validates it has
# the fields we need and normalizes it into
# $YOUCODED_OUTPUT_DIR/oauth-credentials.json for downstream steps.
#
# This replaces the paste-two-strings flow in the old consent-walkthrough.sh —
# downloading the JSON avoids truncation, whitespace, and copy-wrong-tab bugs.
#
# Usage:
#   ingest-oauth-json.sh              # auto-find newest client_secret*.json in ~/Downloads
#   ingest-oauth-json.sh <path>       # use explicit path (supports Windows-style paths)
#
# Exit codes:
#   0 — validated and saved
#   1 — file not found / not readable / not valid JSON
#   2 — file is JSON but not a Google OAuth credentials file

set -euo pipefail

: "${YOUCODED_OUTPUT_DIR:?must be set}"

# Python 3 locator. Bare `python` is not reliable: modern macOS ships only
# `python3`, Debian/Ubuntu default to `python3`, and Windows installs may
# expose `py` instead. Try all three in that order.
PYTHON=$(command -v python3 || command -v python || command -v py) || {
  echo "Python 3 is required but was not found." >&2
  echo "Install it from https://www.python.org/downloads/ then re-run setup." >&2
  exit 1
}

TARGET_PATH="${1:-}"

# Strip surrounding quotes (user may paste a path with quotes around it).
TARGET_PATH="${TARGET_PATH#\"}"; TARGET_PATH="${TARGET_PATH%\"}"
TARGET_PATH="${TARGET_PATH#\'}"; TARGET_PATH="${TARGET_PATH%\'}"

# Convert Windows-style paths to MSYS form on Git Bash (C:\foo\bar → /c/foo/bar).
# cygpath is present on MINGW/MSYS/Cygwin; absent on macOS/Linux (skip there).
if [ -n "$TARGET_PATH" ] && command -v cygpath >/dev/null 2>&1; then
  TARGET_PATH=$(cygpath -u "$TARGET_PATH" 2>/dev/null || printf '%s' "$TARGET_PATH")
fi

if [ -z "$TARGET_PATH" ]; then
  # Auto-scan mode: look for the newest client_secret*.json in ~/Downloads.
  DOWNLOADS="$HOME/Downloads"
  if [ ! -d "$DOWNLOADS" ]; then
    echo "I couldn't find your Downloads folder at $DOWNLOADS." >&2
    echo "If you saved the file somewhere else, paste the full path." >&2
    exit 1
  fi

  # Glob for Google's default filename pattern. If nothing matches, the glob
  # stays literal and -f filters it out.
  for f in "$DOWNLOADS"/client_secret*.json; do
    [ -f "$f" ] || continue
    if [ -z "$TARGET_PATH" ] || [ "$f" -nt "$TARGET_PATH" ]; then
      TARGET_PATH="$f"
    fi
  done

  if [ -z "$TARGET_PATH" ]; then
    echo "I couldn't find the credentials file in your Downloads folder." >&2
    echo "If you saved it somewhere else, paste the full path and I'll use that." >&2
    exit 1
  fi
fi

if [ ! -f "$TARGET_PATH" ]; then
  echo "File not found: $TARGET_PATH" >&2
  exit 1
fi

# Validate shape + normalize to {"installed": {...}} so downstream steps can
# parse it uniformly regardless of whether Google's raw file used "installed"
# (desktop app) or "web" (web app) as the outer key.
DST="$YOUCODED_OUTPUT_DIR/oauth-credentials.json"
ENV_DST="$YOUCODED_OUTPUT_DIR/client.env"
# gws 0.22.5 reads its OAuth client from a fixed path and pulls the project_id
# from that on-disk file (even when GOOGLE_WORKSPACE_CLI_CLIENT_ID env vars
# override the client identity). So we also write the normalized credentials
# to gws's expected location — env-var-only auth leaks a stale project_id
# into API calls and breaks quota routing.
GWS_DST="$HOME/.config/gws/client_secret.json"
"$PYTHON" - "$TARGET_PATH" "$DST" "$ENV_DST" "$GWS_DST" <<'PY'
import json, os, sys
src, dst, env_dst, gws_dst = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
try:
    with open(src, "rb") as f:
        data = json.load(f)
except Exception as e:
    print(f"That file isn't valid JSON ({e}).", file=sys.stderr)
    sys.exit(1)

# Google's download may wrap in {"installed": {...}} (desktop app type) or
# {"web": {...}} (web app type). Accept either but normalize to "installed".
inner = data.get("installed") or data.get("web")
if not isinstance(inner, dict):
    print("That doesn't look like a Google credentials file.", file=sys.stderr)
    print("Go back to the Credentials page, open your OAuth client,", file=sys.stderr)
    print("and click 'Download JSON' at the top of the details popup.", file=sys.stderr)
    sys.exit(2)

required = ("client_id", "client_secret", "project_id")
missing = [k for k in required if not inner.get(k)]
if missing:
    print(f"Credentials file is missing fields: {', '.join(missing)}.", file=sys.stderr)
    print("Make sure you chose 'Desktop app' as the OAuth client type.", file=sys.stderr)
    sys.exit(2)

normalized = {"installed": dict(inner)}
os.makedirs(os.path.dirname(dst), exist_ok=True)
with open(dst, "w") as f:
    json.dump(normalized, f, indent=2)

# Clear stale gws state from any prior setup attempt at the standard path.
# A leftover encrypted token cache pins gws's project_id to the previous
# client's project (even after we write a fresh client_secret.json below),
# which causes subsequent API calls to 403 with "Project X has been
# deleted" — we hit this live during testing. Must happen before we write
# the new client_secret.json so gws starts cleanly on next `auth login`.
import shutil
gws_dir = os.path.dirname(gws_dst)
if os.path.isdir(gws_dir):
    for stale in ("credentials.enc", "credentials.json", "token_cache.json"):
        try:
            os.unlink(os.path.join(gws_dir, stale))
        except FileNotFoundError:
            pass
    try:
        shutil.rmtree(os.path.join(gws_dir, "cache"))
    except FileNotFoundError:
        pass

# Also emit a shell-sourceable env file so downstream bash steps can read
# CLIENT_ID / CLIENT_SECRET without invoking Python again. Single-quoting
# defends against any future special characters in the secret.
with open(env_dst, "w") as f:
    f.write(f"CLIENT_ID='{inner['client_id']}'\n")
    f.write(f"CLIENT_SECRET='{inner['client_secret']}'\n")

# Write the same normalized credentials to gws's expected path. Overwrites
# any prior content — intentional, because a pre-existing credentials file
# from an earlier install attempt can leak a stale project_id into gws's
# API calls (we hit this live during testing).
os.makedirs(os.path.dirname(gws_dst), exist_ok=True)
with open(gws_dst, "w") as f:
    json.dump(normalized, f, indent=2)

# Best-effort: restrict to owner-only on Unix. Silently skipped on Windows.
for p in (dst, env_dst, gws_dst):
    try:
        os.chmod(p, 0o600)
    except Exception:
        pass
PY

echo "  ✓ Saved your Google connection"

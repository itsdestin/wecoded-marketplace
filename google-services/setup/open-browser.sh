#!/usr/bin/env bash
# open-browser.sh <url>
# Cross-platform URL opener used by the /google-services-setup command.
# Replaces `python -m webbrowser` so the command does not depend on Python
# being available (bare `python` is not reliable on modern macOS or Debian
# derivatives).

set -u

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "open-browser.sh: URL argument required" >&2
  exit 1
fi

URL="$1"

case "$(uname -s)" in
  Darwin)
    open "$URL"
    ;;
  Linux)
    if command -v xdg-open >/dev/null 2>&1; then
      # Background + silence: xdg-open can chatter to stderr about missing
      # associations even when it succeeds.
      xdg-open "$URL" >/dev/null 2>&1 &
    else
      echo "No browser opener found. Open this URL manually: $URL" >&2
      exit 1
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    # Use PowerShell's Start-Process. Two Windows openers we tried first
    # both corrupt URLs containing `&` (very common in OAuth query strings):
    #   - `cmd //c start "" "$URL"` — cmd interprets `&` as command separator
    #     even through nested quotes in the MSYS→cmd.exe translation.
    #   - `explorer.exe "$URL"` — truncates long URLs somewhere in the
    #     ShellExecute pipeline, dropping params past the first ~200 chars.
    # PowerShell single-quotes are literal, so the URL passes through intact.
    powershell.exe -NoProfile -Command "Start-Process '$URL'"
    ;;
  *)
    echo "Unsupported platform: $(uname -s)" >&2
    echo "Open this URL manually: $URL" >&2
    exit 1
    ;;
esac

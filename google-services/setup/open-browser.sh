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
    # Under Git Bash, `start` is a cmd.exe builtin — invoke through cmd.
    # The `//c` (double slash) avoids MSYS auto-converting `/c` into a path.
    # Empty "" is the window-title placeholder `start` wants when the next
    # arg is quoted.
    cmd //c start "" "$URL"
    ;;
  *)
    echo "Unsupported platform: $(uname -s)" >&2
    echo "Open this URL manually: $URL" >&2
    exit 1
    ;;
esac

#!/usr/bin/env bash
# smoke-test.sh
# Runs a read-only probe against each of the six Google services after setup
# completes. Each probe is a minimal gws call that verifies the OAuth scope
# for that service was granted. No writes. Output is parsed by the slash
# command to show ✓ / ✗ per service.

set -u  # not -e: we want to test all six and report outcomes, not abort on first fail

# Multi-account: each gws call routes via the active config dir + file keyring.
# Single-account fallback: defaults to ~/.config/gws/, identical to pre-multi-account behavior.
CONFIG_DIR="${GWS_CONFIG_DIR:-$HOME/.config/gws}"
export GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$CONFIG_DIR"
export GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file

declare -A RESULTS

probe() {
  local label="$1"; shift
  local hint="$1"; shift
  if "$@" >/dev/null 2>&1; then
    RESULTS[$label]="PASS"
    echo "  ✓ $label"
  else
    RESULTS[$label]="FAIL:$hint"
    echo "  ✗ $label — $hint"
  fi
}

# gws 0.22.5 uses service-resource-method paths + JSON --params, not simple
# `gws gmail list` shortcuts. Each probe below hits a minimal read-only
# endpoint that exercises the OAuth scope for that service.
#
# Docs/Sheets/Slides have no top-level "list" in the Google API surface —
# those services are document-scoped (you operate on a specific file ID).
# We verify their scope indirectly by asking Drive to list files of the
# relevant mimeType: if Drive scope + the document scope were both granted,
# the filtered list succeeds.

probe "Gmail"    "may need to re-approve the Gmail permission"    \
  gws gmail users messages list --params '{"userId":"me","maxResults":1}'
probe "Drive"    "may need to re-approve the Drive permission"    \
  gws drive files list --params '{"pageSize":1}'
probe "Docs"     "may need to re-approve the Docs permission"     \
  gws drive files list --params '{"pageSize":1,"q":"mimeType=\"application/vnd.google-apps.document\""}'
probe "Sheets"   "may need to re-approve the Sheets permission"   \
  gws drive files list --params '{"pageSize":1,"q":"mimeType=\"application/vnd.google-apps.spreadsheet\""}'
probe "Slides"   "may need to re-approve the Slides permission"   \
  gws drive files list --params '{"pageSize":1,"q":"mimeType=\"application/vnd.google-apps.presentation\""}'
probe "Calendar" "may need to re-approve the Calendar permission" \
  gws calendar events list --params '{"calendarId":"primary","maxResults":1}'

# Exit nonzero if any probe failed
for label in "${!RESULTS[@]}"; do
  case "${RESULTS[$label]}" in
    PASS) ;;
    *) exit 1 ;;
  esac
done

exit 0

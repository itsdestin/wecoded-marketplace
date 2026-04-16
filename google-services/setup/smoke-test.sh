#!/usr/bin/env bash
# smoke-test.sh
# Runs a read-only probe against each of the six Google services after setup
# completes. Each probe is a minimal gws call that verifies the OAuth scope
# for that service was granted. No writes. Output is parsed by the slash
# command to show ✓ / ✗ per service.

set -u  # not -e: we want to test all six and report outcomes, not abort on first fail

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

probe "Gmail"    "may need to re-approve the Gmail permission"    gws gmail list --max 5
probe "Drive"    "may need to re-approve the Drive permission"    gws drive list --max 5
probe "Docs"     "may need to re-approve the Docs permission"     gws docs list --max 1  # gws drive list --mime-type doc is alt
probe "Sheets"   "may need to re-approve the Sheets permission"   gws sheets list --max 1
probe "Slides"   "may need to re-approve the Slides permission"   gws slides list --max 1
probe "Calendar" "may need to re-approve the Calendar permission" gws calendar events list --max 5

# Exit nonzero if any probe failed
for label in "${!RESULTS[@]}"; do
  case "${RESULTS[$label]}" in
    PASS) ;;
    *) exit 1 ;;
  esac
done

exit 0

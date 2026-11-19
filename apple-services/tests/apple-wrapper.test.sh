#!/usr/bin/env bash
# Tests for lib/apple-wrapper.sh. Run: bash apple-services/tests/apple-wrapper.test.sh
#
# Runs on Linux or macOS with fake helper/osascript programs, so no Apple apps
# are touched. Fake `timeout` and `flock` programs that always fail are put
# first on PATH: if the wrapper ever calls them again (they are missing on
# stock macOS), the tests below fail.
set -u

WRAPPER="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../lib" && pwd)/apple-wrapper.sh"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
export HOME="$T/home" TMPDIR="$T/tmp"
mkdir -p "$HOME" "$TMPDIR" "$T/bin"
ROOT="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
mkdir -p "$ROOT"

for banned in timeout flock; do
  printf '#!/bin/sh\necho "banned command %s used" >&2\nexit 99\n' "$banned" > "$T/bin/$banned"
  chmod +x "$T/bin/$banned"
done
export PATH="$T/bin:$PATH"

pass=0; fail=0
check() { # check <name> <condition-exit-status>
  if [ "$2" -eq 0 ]; then pass=$((pass + 1)); echo "ok   - $1"; else fail=$((fail + 1)); echo "FAIL - $1"; fi
}
run() { out="$("$WRAPPER" "$@" 2>"$T/err")"; rc=$?; err="$(cat "$T/err")"; }

# ── iCloud: folders that don't exist yet ──
run icloud write --path "New/Deep/a.txt" --content hi
[ "$rc" -eq 0 ] && [ "$(cat "$ROOT/New/Deep/a.txt" 2>/dev/null)" = "hi" ]
check "write into not-yet-existing folders succeeds" $?

run icloud create_folder --path "A/B/C"
[ "$rc" -eq 0 ] && [ -d "$ROOT/A/B/C" ]
check "create_folder creates nested folders" $?

run icloud write --path "../escape.txt" --content x
[ "$rc" -ne 0 ] && [ ! -e "$HOME/Library/Mobile Documents/escape.txt" ] && echo "$err" | grep -q "escapes iCloud"
check "a path climbing out of the root is still rejected, nothing written" $?

run icloud write --path "A/../../escape2.txt" --content x
[ "$rc" -ne 0 ] && [ ! -e "$HOME/Library/Mobile Documents/escape2.txt" ]
check "sneaky A/../.. escape is rejected" $?

run icloud write --path "A/../Z/b.txt" --content ok
[ "$rc" -eq 0 ] && [ -f "$ROOT/Z/b.txt" ]
check "harmless .. that stays inside the root is allowed" $?

# the iCloud root itself must never be deleted/moved/overwritten
mkdir -p "$ROOT/Keep"; echo keep > "$ROOT/Keep/k.txt"
for p in "" "." "A/.." "./"; do
  run icloud delete --path "$p"
  [ "$rc" -ne 0 ] && [ -f "$ROOT/Keep/k.txt" ] && [ -d "$ROOT/Z" ]
  check "delete of root-equivalent path '$p' is refused, files kept" $?
done
run icloud move --src "." --dst "Moved"
[ "$rc" -ne 0 ] && [ -f "$ROOT/Keep/k.txt" ] && [ ! -e "$ROOT/Moved" ]
check "move of the root itself is refused" $?
run icloud list --path ""
[ "$rc" -eq 0 ] && echo "$out" | grep -q Keep
check "listing the root is still allowed" $?

# ── helper route: exit status and timeout ──
printf '#!/bin/sh\necho boom >&2\nexit 7\n' > "$T/helper-fail"
printf '#!/bin/sh\necho "{\\"ok\\":true}"\n' > "$T/helper-ok"
printf '#!/bin/sh\nexec sleep 30\n' > "$T/helper-hang"
chmod +x "$T/helper-fail" "$T/helper-ok" "$T/helper-hang"

APPLE_HELPER_BIN="$T/helper-ok" run calendar list_events
[ "$rc" -eq 0 ] && echo "$out" | grep -q '"ok":true'
check "helper success passes output through with status 0" $?

APPLE_HELPER_BIN="$T/helper-fail" run calendar list_events
[ "$rc" -eq 7 ]
check "helper failure status is passed on (was always 0)" $?

start=$SECONDS
APPLE_SERVICES_TIMEOUT_OVERRIDE=1 APPLE_HELPER_BIN="$T/helper-hang" run calendar list_events
[ "$rc" -ne 0 ] && echo "$err" | grep -q "timed out after 1s" && [ $((SECONDS - start)) -lt 10 ]
check "hung helper is stopped and reported as timed out" $?

# ── AppleScript route: lock + exit status ──
printf '#!/bin/sh\necho "{\\"ok\\":true}"\n' > "$T/bin/osascript"
chmod +x "$T/bin/osascript"
run notes list_folders
[ "$rc" -eq 0 ] && echo "$out" | grep -q '"ok":true' && [ ! -e "$TMPDIR/apple-services.notes.lock.d" ]
check "applescript op works without flock and releases its lock" $?

printf '#!/bin/sh\necho "weird failure" >&2\nexit 5\n' > "$T/bin/osascript"
run notes list_folders
[ "$rc" -ne 0 ] && echo "$err" | grep -q "weird failure"
check "applescript failure is reported as an error, not success" $?

printf '#!/bin/sh\nexec sleep 30\n' > "$T/bin/osascript"
APPLE_SERVICES_TIMEOUT_OVERRIDE=1 run notes list_folders
[ "$rc" -ne 0 ] && echo "$err" | grep -q "timed out after 1s"
check "hung osascript is reported as timed out" $?

# stale lock from a dead process must not block
mkdir "$TMPDIR/apple-services.notes.lock.d"; echo 999999 > "$TMPDIR/apple-services.notes.lock.d/pid"
printf '#!/bin/sh\necho "{\\"ok\\":true}"\n' > "$T/bin/osascript"
run notes list_folders
[ "$rc" -eq 0 ]
check "stale lock left by a dead process is reclaimed" $?

# lock with no pid file (caller killed mid-acquire) must not block forever
mkdir "$TMPDIR/apple-services.notes.lock.d"
start=$SECONDS
run notes list_folders
[ "$rc" -eq 0 ] && [ $((SECONDS - start)) -lt 15 ]
check "owner-less lock is reclaimed after a few seconds" $?

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]

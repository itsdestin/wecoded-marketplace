#!/usr/bin/env bash
# apple-wrapper.sh — single entry point dispatching apple-services ops to
# the Swift helper binary, AppleScript, or pure bash (iCloud).
#
# WHY single wrapper: keeps error envelope + TCC_DENIED handling in one place
# instead of duplicated across helper/osascript wrappers.
#
# Usage:   apple-wrapper.sh <integration> <op> [--arg value ...]
# Example: apple-wrapper.sh calendar list_events --from 2026-04-17 --to 2026-04-24

set -u

PLUGIN_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER_BIN="${APPLE_HELPER_BIN:-$HOME/.apple-services/bin/apple-helper}"
ICLOUD_ROOT="$HOME/Library/Mobile Documents/com~apple~CloudDocs"
LOCK_DIR="${TMPDIR:-/tmp}"

# ─── Error envelope + exit helpers (defined first so input checks can use) ──

err_out() {
  # err_out <code> <service> <message> <recovery>
  local code="$1" service="$2" msg="$3" recovery="$4"
  jq -cn \
    --arg c "$code" --arg s "$service" --arg m "$msg" --arg r "$recovery" \
    '{error: {code: $c, service: $s, message: $m, recovery: $r}}' >&2
  [ "$code" = "TCC_DENIED" ] && { echo "TCC_DENIED:$service" >&2; exit 2; }
  exit 1
}

# ─── Dependency check ───────────────────────────────────────────────────────

command -v jq >/dev/null 2>&1 || {
  echo '{"error":{"code":"UNAVAILABLE","service":"wrapper","message":"jq is not installed. Apple Services needs jq to format output.","recovery":"Install jq (brew install jq), then retry."}}' >&2
  exit 1
}

# ─── Args ───────────────────────────────────────────────────────────────────

integration="${1:-}"
op="${2:-}"
shift 2 2>/dev/null || true

if [ -z "$integration" ] || [ -z "$op" ]; then
  err_out INVALID_ARG wrapper "Usage: apple-wrapper.sh <integration> <op> [args]" "See skills/<integration>/SKILL.md"
fi

# ─── Portable timeout ───────────────────────────────────────────────────────

# WHY: stock macOS ships neither GNU `timeout` nor `flock`, so every helper /
# AppleScript call failed with "command not found" there. This uses only
# bash 3.2 builtins plus kill/sleep.
# Usage: run_with_timeout <seconds> <cmd> [args...]
# Returns the command's own status, or 124 if the watchdog had to kill it
# (same convention as GNU timeout, so callers' "= 124" checks keep working).
run_with_timeout() {
  local secs="$1"; shift
  local flag; flag="$(mktemp)"; rm -f "$flag"

  "$@" &
  local cmd_pid=$!

  # Watchdog: sleeps, then drops a marker file and kills the command (TERM,
  # then KILL after 2s). Its stdio goes to /dev/null so a leftover process can
  # never hold open the pipe our caller is reading from.
  (
    sleep "$secs" &
    local sleeper=$!
    # If the command finishes first we get TERM: stop the sleeper and leave.
    trap 'kill "$sleeper" 2>/dev/null; exit 0' TERM
    wait "$sleeper"
    # Timer fired: stop special-casing TERM so the caller can end us at once.
    trap - TERM
    : > "$flag"
    kill -TERM "$cmd_pid" 2>/dev/null
    sleep 2
    kill -KILL "$cmd_pid" 2>/dev/null
  ) >/dev/null 2>&1 &
  local watchdog_pid=$!

  local rc=0
  wait "$cmd_pid" || rc=$?
  kill -TERM "$watchdog_pid" 2>/dev/null
  wait "$watchdog_pid" 2>/dev/null || true

  if [ -e "$flag" ]; then
    rm -f "$flag"
    return 124
  fi
  return "$rc"
}

# ─── Per-op timeout selection ───────────────────────────────────────────────

op_timeout() {
  # APPLE_SERVICES_TIMEOUT_OVERRIDE exists so tests can exercise the timeout
  # path in a second instead of 15-60s; not documented for users.
  if [ -n "${APPLE_SERVICES_TIMEOUT_OVERRIDE:-}" ]; then
    echo "$APPLE_SERVICES_TIMEOUT_OVERRIDE"; return
  fi
  case "$op" in
    search|search_*) echo 60 ;;
    list_*|get_*|list) echo 15 ;;
    create_*|update_*|delete_*|send|mark_*|add_to_*|remove_from_*|complete_*) echo 20 ;;
    *) echo 15 ;;
  esac
}

# ─── Helper-binary routing (calendar, reminders, contacts) ──────────────────

route_helper() {
  [ -x "$HELPER_BIN" ] || err_out UNAVAILABLE "$integration" \
    "The Apple Services helper isn't installed at $HELPER_BIN." \
    "Run /apple-services-setup."

  local timeout; timeout=$(op_timeout)
  local stderr_file; stderr_file="$(mktemp)"

  # WHY `|| exit_code=$?`: the old `if cmd; then ...; fi` followed by
  # `exit_code=$?` always read 0 (an `if` with no branch taken succeeds), so
  # failures were reported as success and the timeout branch never fired.
  local exit_code=0
  run_with_timeout "$timeout" "$HELPER_BIN" "$integration" "$op" "$@" 2> "$stderr_file" || exit_code=$?
  if [ "$exit_code" -eq 0 ]; then
    rm -f "$stderr_file"
    return 0
  fi

  if grep -q "^TCC_DENIED:" "$stderr_file"; then
    cat "$stderr_file" >&2
    rm -f "$stderr_file"
    exit 2
  fi

  if [ "$exit_code" = 124 ]; then
    err_out UNAVAILABLE "$integration" "Helper call timed out after ${timeout}s." "Retry; if persistent, re-run /apple-services-setup."
  fi

  cat "$stderr_file" >&2
  rm -f "$stderr_file"
  exit "$exit_code"
}

# ─── AppleScript routing (notes, mail) ──────────────────────────────────────

route_applescript() {
  # Dispatch by file extension: .jxa for JavaScript (for list-returning ops
  # where AppleScript record-list parsing is broken upstream — see Phase 0
  # R4), .applescript for everything else.
  local script osascript_lang
  if [ -f "$PLUGIN_DIR/applescript/$integration/$op.jxa" ]; then
    script="$PLUGIN_DIR/applescript/$integration/$op.jxa"
    osascript_lang=(-l JavaScript)
  elif [ -f "$PLUGIN_DIR/applescript/$integration/$op.applescript" ]; then
    script="$PLUGIN_DIR/applescript/$integration/$op.applescript"
    osascript_lang=()
  else
    err_out INVALID_ARG "$integration" "Unknown op: $op" "See skills/$integration/SKILL.md for op list."
  fi

  # Serialize concurrent calls to the same target app — AppleScript talks to
  # the live app process and two parallel osascripts fighting over Mail.app
  # will occasionally error out.
  # WHY mkdir lock (not flock): flock is absent on stock macOS; mkdir is atomic
  # everywhere. The owner's pid is stored so a lock left by a crashed call
  # (dead pid) is reclaimed instead of blocking for 30s every time.
  local lock="$LOCK_DIR/apple-services.$integration.lock.d"
  local tries=0
  until mkdir "$lock" 2>/dev/null; do
    local owner; owner="$(cat "$lock/pid" 2>/dev/null || true)"
    if [ -n "$owner" ] && ! kill -0 "$owner" 2>/dev/null; then
      rm -rf "$lock"   # owner is gone: stale lock
      continue
    fi
    tries=$((tries + 1))
    [ "$tries" -gt 150 ] && err_out UNAVAILABLE "$integration" "$integration lock busy for 30s." "Retry; another skill call may be running."
    sleep 0.2
  done
  echo "$$" > "$lock/pid"
  # shellcheck disable=SC2064  # expand $lock now, deliberately
  trap "rm -rf '$lock'" EXIT

  local timeout; timeout=$(op_timeout)
  local stderr_file; stderr_file="$(mktemp)"
  local stdout_file; stdout_file="$(mktemp)"

  # WHY ${arr[@]+...}: on bash 3.2 (macOS) an empty array under `set -u` is an
  # "unbound variable" error, which broke every .applescript (non-JXA) op.
  local exit_code=0
  run_with_timeout "$timeout" osascript ${osascript_lang[@]+"${osascript_lang[@]}"} "$script" "$@" > "$stdout_file" 2> "$stderr_file" || exit_code=$?
  if [ "$exit_code" -eq 0 ]; then
    # Post-process TSV-emitting AppleScript ops (notes/get_note, mail/read_message)
    # into JSON. These scripts return tab-separated fields because JSON-escaping
    # HTML bodies from AppleScript is painful.
    post_process_applescript_output < "$stdout_file"
    rm -f "$stderr_file" "$stdout_file"
    return 0
  fi

  # AppleScript Automation denial surfaces as error -1743
  if grep -qE '\(-1743\)' "$stderr_file"; then
    err_out TCC_DENIED "$integration" "Automation access to $integration was denied." "Open System Settings → Privacy & Security → Automation, find your Claude host app, turn on $integration. Then re-run."
  fi

  # Application isn't running / not installed
  if grep -qE "Application isn.t running|not allowed to send Apple events|Can.t get application" "$stderr_file"; then
    err_out UNAVAILABLE "$integration" "$integration isn't ready." "Open $integration.app, finish any first-run setup, then retry."
  fi

  if [ "$exit_code" = 124 ]; then
    err_out UNAVAILABLE "$integration" "$integration op timed out after ${timeout}s." "The app may be stuck; quit it and retry."
  fi

  local msg; msg=$(head -c 500 < "$stderr_file" | tr '\n' ' ')
  rm -f "$stderr_file" "$stdout_file"
  err_out INTERNAL "$integration" "$msg" "Check Console.app logs for $integration.app errors."
}

# Convert TSV-shaped AppleScript output for specific ops into JSON.
# Ops that return TSV (from Tasks 13/14): notes/get_note, mail/read_message.
# All other ops return JSON already and pass through unchanged.
post_process_applescript_output() {
  local raw; raw=$(cat)
  case "$integration/$op" in
    notes/get_note)
      # Format: id\tname\tISO-modified\tHTML-body
      jq -cn --arg raw "$raw" '
        ($raw | split("\t")) as $parts
        | {id: $parts[0], name: $parts[1], modified: $parts[2], body_markdown: ($parts[3:] | join("\t"))}
      '
      # Note: real HTML→markdown conversion would need pandoc or similar.
      # v1 returns the raw HTML as body_markdown; skill's SKILL.md documents this.
      ;;
    mail/read_message)
      # Format: id\tfrom\tsubject\tISO-date\tbody
      jq -cn --arg raw "$raw" '
        ($raw | split("\t")) as $parts
        | {id: $parts[0], from: $parts[1], subject: $parts[2], date: $parts[3], body_text: ($parts[4:] | join("\t")), to: [], cc: [], attachments: []}
      '
      ;;
    *)
      printf '%s' "$raw"
      ;;
  esac
}

# ─── iCloud filesystem routing ──────────────────────────────────────────────

route_icloud() {
  # All iCloud ops take --path relative to ICLOUD_ROOT.
  local path="" content="" src="" dst=""
  local recursive=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --path) path="$2"; shift 2 ;;
      --content) content="$2"; shift 2 ;;
      --src) src="$2"; shift 2 ;;
      --dst) dst="$2"; shift 2 ;;
      --recursive) recursive=1; shift ;;
      *) shift ;;
    esac
  done

  resolve() {
    # Map a path relative to ICLOUD_ROOT onto an absolute path, rejecting any
    # that climb out of the root.
    # WHY lexical (not `cd`): the old version cd'd into the parent folder, which
    # fails for folders that don't exist yet, so writing "Projects/new/a.txt"
    # (or create_folder A/B) was wrongly rejected as "escapes iCloud root".
    local rest="$1" seg out=""
    while [ -n "$rest" ]; do
      case "$rest" in
        */*) seg="${rest%%/*}"; rest="${rest#*/}" ;;
        *) seg="$rest"; rest="" ;;
      esac
      case "$seg" in
        ""|".") ;;
        "..")
          case "$out" in
            "") err_out INVALID_ARG icloud "Path escapes iCloud Drive root: $1" "Pass paths relative to iCloud Drive root." ;;
            */*) out="${out%/*}" ;;
            *) out="" ;;
          esac ;;
        *) out="${out:+$out/}$seg" ;;
      esac
    done
    if [ -z "$out" ]; then echo "$ICLOUD_ROOT"; else echo "$ICLOUD_ROOT/$out"; fi
  }

  case "$op" in
    list)
      local full; full=$(resolve "$path") || exit 1
      [ -d "$full" ] || err_out NOT_FOUND icloud "Not a directory: $path" "Check the path."
      local find_args=(-mindepth 1)
      [ "$recursive" = 0 ] && find_args+=(-maxdepth 1)
      find "$full" "${find_args[@]}" -print0 2>/dev/null | while IFS= read -r -d '' entry; do
        local base; base="$(basename "$entry")"
        # Two iCloud placeholder representations (Phase 0 R8):
        # 1. Legacy dot-prefixed .icloud stubs (pre-Sonoma filesystems):
        if [[ "$base" == .*.icloud ]]; then
          local real_name="${base#.}"; real_name="${real_name%.icloud}"
          jq -cn --arg n "$real_name" --arg t "placeholder" '{name: $n, type: $t, size: 0, modified: null}'
          continue
        fi
        # 2. APFS dataless files (Sonoma+ default): SF_DATALESS flag (0x40000000)
        #    set in st_flags. stat -f%Xf gives flags in hex.
        if [ -f "$entry" ]; then
          local flags; flags=$(stat -f%Xf "$entry" 2>/dev/null || echo 0)
          # Bash doesn't do hex bitwise AND easily; use printf + shell arithmetic.
          local flags_dec; flags_dec=$(printf '%d' "0x$flags" 2>/dev/null || echo 0)
          if (( (flags_dec & 0x40000000) != 0 )); then
            local size; size=$(stat -f%z "$entry")
            local modified; modified=$(date -u -r "$(stat -f%m "$entry")" +%Y-%m-%dT%H:%M:%SZ)
            jq -cn --arg n "$base" --arg t "placeholder" --argjson s "$size" --arg m "$modified" '{name: $n, type: $t, size: $s, modified: $m}'
            continue
          fi
        fi
        # Normal entry
        local type size modified
        # Quoted: bare `type=file` trips shellcheck SC2209 (file/dir are command names)
        if [ -d "$entry" ]; then type="dir"; size=0;
        else type="file"; size=$(stat -f%z "$entry"); fi
        modified=$(date -u -r "$(stat -f%m "$entry")" +%Y-%m-%dT%H:%M:%SZ)
        jq -cn --arg n "$base" --arg t "$type" --argjson s "$size" --arg m "$modified" '{name: $n, type: $t, size: $s, modified: $m}'
      done | jq -cs .
      ;;
    read)
      local full; full=$(resolve "$path") || exit 1
      local base; base="$(basename "$full")"
      # Reject legacy .icloud stub (file wouldn't even exist at the cleaned name)
      if [ -e "$(dirname "$full")/.${base}.icloud" ]; then
        err_out UNAVAILABLE icloud "This file is in iCloud but not downloaded." "Open Finder, right-click the file, Download Now, then retry."
      fi
      [ -f "$full" ] || err_out NOT_FOUND icloud "Not a file: $path" "Check the path."
      # Reject SF_DATALESS dataless file — reading it would trigger a sync
      # download that can stall for many seconds on slow networks.
      local flags; flags=$(stat -f%Xf "$full" 2>/dev/null || echo 0)
      local flags_dec; flags_dec=$(printf '%d' "0x$flags" 2>/dev/null || echo 0)
      if (( (flags_dec & 0x40000000) != 0 )); then
        err_out UNAVAILABLE icloud "This file is in iCloud but not downloaded locally yet." "Open Finder, right-click the file, Download Now, then retry."
      fi
      if file --mime-encoding "$full" | grep -q 'binary'; then
        local size; size=$(stat -f%z "$full")
        local type; type=$(file --mime-type -b "$full")
        jq -cn --argjson b true --arg t "$type" --argjson s "$size" '{binary: $b, type: $t, size: $s}'
      else
        jq -Rs . < "$full"
      fi
      ;;
    write)
      local full; full=$(resolve "$path") || exit 1
      mkdir -p "$(dirname "$full")"
      printf '%s' "$content" > "$full"
      echo '{"ok":true}'
      ;;
    delete)
      local full; full=$(resolve "$path") || exit 1
      [ -e "$full" ] || err_out NOT_FOUND icloud "Not found: $path" "Check the path."
      rm -rf -- "$full"
      echo '{"ok":true}'
      ;;
    move)
      local srcFull; srcFull=$(resolve "$src") || exit 1
      local dstFull; dstFull=$(resolve "$dst") || exit 1
      mkdir -p "$(dirname "$dstFull")"
      mv "$srcFull" "$dstFull"
      echo '{"ok":true}'
      ;;
    create_folder)
      local full; full=$(resolve "$path") || exit 1
      mkdir -p "$full"
      echo '{"ok":true}'
      ;;
    stat)
      local full; full=$(resolve "$path") || exit 1
      [ -e "$full" ] || err_out NOT_FOUND icloud "Not found: $path" "Check the path."
      local name type size modified
      name=$(basename "$full")
      # Quoted: bare `type=file` trips shellcheck SC2209 (file/dir are command names)
      if [ -d "$full" ]; then type="dir"; size=0; else type="file"; size=$(stat -f%z "$full"); fi
      modified=$(date -u -r "$(stat -f%m "$full")" +%Y-%m-%dT%H:%M:%SZ)
      jq -cn --arg n "$name" --arg t "$type" --argjson s "$size" --arg m "$modified" '{name: $n, type: $t, size: $s, modified: $m}'
      ;;
    *)
      err_out INVALID_ARG icloud "Unknown op: $op" "See skills/icloud-drive/SKILL.md."
      ;;
  esac
}

# ─── Dispatch ────────────────────────────────────────────────────────────────

case "$integration" in
  calendar|reminders|contacts) route_helper "$@" ;;
  notes|mail) route_applescript "$@" ;;
  icloud) route_icloud "$@" ;;
  *) err_out INVALID_ARG wrapper "Unknown integration: $integration" "One of: calendar, reminders, contacts, notes, mail, icloud" ;;
esac

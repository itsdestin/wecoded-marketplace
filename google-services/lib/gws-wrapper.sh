#!/usr/bin/env bash
# gws-wrapper.sh
# Exposes gws_run — the single function every skill uses to invoke gws.
# Sourced (not exec'd) via: source "$CLAUDE_PLUGIN_ROOT/lib/gws-wrapper.sh"
#
# Exit code contract (consumed by skills):
#   0 — gws command succeeded; stdout contains gws output
#   2 — auth expired; stderr contains exactly one line "AUTH_EXPIRED:<service>"
#   other — any other gws error; stderr forwarded verbatim

# Ensure the managed install dir is on PATH. Covers fresh shells that haven't
# sourced the user's profile, non-interactive shell spawns, and any Claude Code
# tool invocations that start from a clean environment. Belt-and-suspenders
# complement to install-gws.sh, which writes the same path into the profile.
case ":$PATH:" in
  *":$HOME/.youcoded/bin:"*) ;;
  *) PATH="$HOME/.youcoded/bin:$PATH" ;;
esac

gws_auth_status() {
  # 0 if gws has a valid token for the current account, nonzero otherwise.
  gws auth status --json 2>/dev/null | grep -q '"authenticated": true'
}

gws_run() {
  # First positional arg is the service (gmail, drive, docs, sheets, slides,
  # calendar). Rest are passed through to gws.
  local service="$1"

  local out rc
  out=$(gws "$@" 2>&1)
  rc=$?

  if [ "$rc" -eq 0 ]; then
    printf '%s\n' "$out"
    return 0
  fi

  # Auth-error signature detection. Patterns pinned to gws v0.22.5 error surface.
  # Re-verify on every gws version bump (see Research Item 1 notes in spec).
  case "$out" in
    *"invalid_grant"*|*"token has been expired or revoked"*|\
    *"unauthorized_client"*|*"AuthenticationError"*|\
    *"authorization is required"*)
      printf 'AUTH_EXPIRED:%s\n' "$service" >&2
      return 2
      ;;
    *)
      printf '%s\n' "$out" >&2
      return "$rc"
      ;;
  esac
}

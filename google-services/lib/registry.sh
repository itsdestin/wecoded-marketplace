#!/usr/bin/env bash
# registry.sh — read/write helpers for ~/.config/gws-profiles.json
#
# This file is sourced by other setup scripts (add-account.sh, remove-account.sh,
# the slash command's bash blocks, etc). It does NOT have a shebang-driven entry
# point; everything is a function.
#
# All functions assume `jq` is on PATH. jq ships with Git Bash on Windows and
# is in the apt/brew core on Linux/macOS — already a transitive setup dep.
#
# NOTE: On Git Bash (Windows), MSYS2 translates POSIX paths passed as --arg
# values to jq into Windows paths (e.g. /tmp/foo → C:/Users/...), which corrupts
# the configDir strings stored in the registry. We prevent this by setting
# MSYS_NO_PATHCONV=1 for the specific --arg that carries a directory path.
# jq itself is a Windows binary and still needs Windows-format paths for the
# file operand — so we pass file content via stdin using "< file" redirection,
# which bypasses path translation entirely for the file read, and write via a
# tmp-then-mv pattern that also uses redirection.
#
# _jq_file: run jq with stdin from a file (avoids passing file path as arg).
# Usage: _jq_file FILTER FILE [jq-args...]
# Writes result to stdout; caller handles redirection to tmp/mv for writes.
_jq_file() {
  local filter="$1" file="$2"
  shift 2
  MSYS_NO_PATHCONV=1 jq "$@" "$filter" < "$file"
}

# _jq_write: apply filter+args to FILE and atomically replace it.
# Usage: _jq_write FILTER FILE [jq-args...]
_jq_write() {
  local filter="$1" file="$2"
  shift 2
  MSYS_NO_PATHCONV=1 jq "$@" "$filter" < "$file" > "$file.tmp" && mv "$file.tmp" "$file"
}

# Path to the registry. Override REGISTRY env var for tests.
registry_path() {
  echo "${REGISTRY:-$HOME/.config/gws-profiles.json}"
}

# Exit 0 if registry exists, 1 otherwise.
registry_exists() {
  [ -f "$(registry_path)" ]
}

# Create an empty registry if one doesn't exist. No-op if it does.
registry_init() {
  local path
  path="$(registry_path)"
  [ -f "$path" ] && return 0
  mkdir -p "$(dirname "$path")"
  echo '{"default":null,"accounts":[],"knownTestUsers":[]}' > "$path"
  chmod 600 "$path" 2>/dev/null || true
}

# Append an account to the registry.
# Args: name email configDir ownsGcpProject gcpProjectId
# ownsGcpProject must be "true" or "false" (lowercase, JSON-bool-safe).
# gcpProjectId may be empty for fast-path accounts.
registry_add_account() {
  local name="$1" email="$2" config_dir="$3" owns="$4" project="$5"
  local path
  path="$(registry_path)"
  registry_init
  local entry
  if [ -n "$project" ]; then
    entry=$(MSYS_NO_PATHCONV=1 jq -n \
      --arg name "$name" --arg email "$email" --arg dir "$config_dir" \
      --argjson owns "$owns" --arg proj "$project" \
      '{name:$name,email:$email,configDir:$dir,ownsGcpProject:$owns,gcpProjectId:$proj}')
  else
    entry=$(MSYS_NO_PATHCONV=1 jq -n \
      --arg name "$name" --arg email "$email" --arg dir "$config_dir" \
      --argjson owns "$owns" \
      '{name:$name,email:$email,configDir:$dir,ownsGcpProject:$owns}')
  fi
  _jq_write ".accounts += [$entry]" "$path"
}

# Remove an account by name. No-op if the account doesn't exist.
registry_remove_account() {
  local name="$1"
  local path
  path="$(registry_path)"
  [ -f "$path" ] || return 0
  _jq_write '.accounts |= map(select(.name != $name))' "$path" --arg name "$name"
}

# Set the default account.
# The caller is responsible for making sure the name exists.
registry_set_default() {
  local name="$1"
  local path
  path="$(registry_path)"
  _jq_write '.default = $name' "$path" --arg name "$name"
}

# Print the configDir of the default account, or empty string if no default.
registry_get_default_config_dir() {
  local path default_name
  path="$(registry_path)"
  [ -f "$path" ] || return 0
  default_name="$(_jq_file '.default // ""' "$path" -r)"
  [ -z "$default_name" ] && return 0
  _jq_file '.accounts[] | select(.name == $name) | .configDir' "$path" -r --arg name "$default_name"
}

# Print one line per account, tab-separated: name<TAB>email<TAB>configDir
registry_list_accounts() {
  local path
  path="$(registry_path)"
  [ -f "$path" ] || return 0
  _jq_file '.accounts[] | "\(.name)\t\(.email)\t\(.configDir)"' "$path" -r
}

# Number of accounts.
registry_account_count() {
  local path
  path="$(registry_path)"
  [ -f "$path" ] || { echo 0; return 0; }
  _jq_file '.accounts | length' "$path"
}

# Append an email to knownTestUsers (deduplicated).
registry_add_known_test_user() {
  local email="$1"
  local path
  path="$(registry_path)"
  registry_init
  _jq_write '.knownTestUsers = (.knownTestUsers + [$email] | unique)' "$path" --arg email "$email"
}

# Print the email list (one per line).
registry_list_known_test_users() {
  local path
  path="$(registry_path)"
  [ -f "$path" ] || return 0
  _jq_file '.knownTestUsers[]' "$path" -r
}

# Delete the registry file. Used by remove-account when last account is removed.
registry_destroy() {
  local path
  path="$(registry_path)"
  rm -f "$path"
}

# Return the configDir for a named account.
registry_get_config_dir() {
  local name="$1"
  local path
  path="$(registry_path)"
  [ -f "$path" ] || return 0
  _jq_file '.accounts[] | select(.name == $name) | .configDir' "$path" -r --arg name "$name"
}

# Return the email for a named account.
registry_get_email() {
  local name="$1"
  local path
  path="$(registry_path)"
  [ -f "$path" ] || return 0
  _jq_file '.accounts[] | select(.name == $name) | .email' "$path" -r --arg name "$name"
}

# Return ownsGcpProject for a named account ("true" or "false").
registry_get_owns_gcp() {
  local name="$1"
  local path
  path="$(registry_path)"
  [ -f "$path" ] || return 0
  _jq_file '.accounts[] | select(.name == $name) | .ownsGcpProject' "$path" -r --arg name "$name"
}

# Return gcpProjectId for a named account, or empty if unset.
registry_get_gcp_project() {
  local name="$1"
  local path
  path="$(registry_path)"
  [ -f "$path" ] || return 0
  _jq_file '.accounts[] | select(.name == $name) | .gcpProjectId // ""' "$path" -r --arg name "$name"
}

# Print the name of the default account, or empty if none.
registry_get_default_name() {
  local path
  path="$(registry_path)"
  [ -f "$path" ] || return 0
  _jq_file '.default // ""' "$path" -r
}

#!/usr/bin/env bats

# Tests for lib/registry.sh — read/write helpers for ~/.config/gws-profiles.json

setup() {
  export TMP_HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$TMP_HOME/.config"
  export HOME="$TMP_HOME"
  export REGISTRY="$HOME/.config/gws-profiles.json"
  source "$BATS_TEST_DIRNAME/../lib/registry.sh"
}

@test "registry_path returns the expected path" {
  result="$(registry_path)"
  [ "$result" = "$HOME/.config/gws-profiles.json" ]
}

@test "registry_exists returns 1 when file does not exist" {
  run registry_exists
  [ "$status" -eq 1 ]
}

@test "registry_exists returns 0 when file exists" {
  echo '{}' > "$REGISTRY"
  run registry_exists
  [ "$status" -eq 0 ]
}

@test "registry_init creates file with empty accounts when called fresh" {
  registry_init
  [ -f "$REGISTRY" ]
  default="$(jq -r '.default' "$REGISTRY")"
  [ "$default" = "null" ]
  count="$(jq '.accounts | length' "$REGISTRY")"
  [ "$count" -eq 0 ]
}

@test "registry_init is a no-op when file already exists" {
  echo '{"default":"personal","accounts":[{"name":"personal","email":"a@b.com","configDir":"~/.config/gws","ownsGcpProject":true,"gcpProjectId":"p"}],"knownTestUsers":[]}' > "$REGISTRY"
  registry_init
  default="$(jq -r '.default' "$REGISTRY")"
  [ "$default" = "personal" ]
}

@test "registry_add_account appends an account" {
  registry_init
  registry_add_account "work" "work@acme.com" "$HOME/.config/gws-work" false ""
  count="$(jq '.accounts | length' "$REGISTRY")"
  [ "$count" -eq 1 ]
  email="$(jq -r '.accounts[0].email' "$REGISTRY")"
  [ "$email" = "work@acme.com" ]
}

@test "registry_remove_account removes an account by name" {
  registry_init
  registry_add_account "work" "work@acme.com" "$HOME/.config/gws-work" false ""
  registry_add_account "personal" "p@gmail.com" "$HOME/.config/gws" true "youcoded-personal-abc"
  registry_remove_account "work"
  count="$(jq '.accounts | length' "$REGISTRY")"
  [ "$count" -eq 1 ]
  remaining="$(jq -r '.accounts[0].name' "$REGISTRY")"
  [ "$remaining" = "personal" ]
}

@test "registry_set_default updates the default field" {
  registry_init
  registry_add_account "work" "work@acme.com" "$HOME/.config/gws-work" false ""
  registry_set_default "work"
  default="$(jq -r '.default' "$REGISTRY")"
  [ "$default" = "work" ]
}

@test "registry_get_default_config_dir returns the configDir of the default account" {
  registry_init
  registry_add_account "personal" "p@gmail.com" "$HOME/.config/gws" true ""
  registry_set_default "personal"
  result="$(registry_get_default_config_dir)"
  [ "$result" = "$HOME/.config/gws" ]
}

@test "registry_list_accounts emits one line per account: name<TAB>email<TAB>configDir" {
  registry_init
  registry_add_account "personal" "p@gmail.com" "$HOME/.config/gws" true ""
  registry_add_account "work" "work@acme.com" "$HOME/.config/gws-work" false ""
  result="$(registry_list_accounts)"
  echo "$result" | grep -q "^personal	p@gmail.com	$HOME/.config/gws$"
  echo "$result" | grep -q "^work	work@acme.com	$HOME/.config/gws-work$"
}

@test "registry_add_known_test_user appends an email and dedupes" {
  registry_init
  registry_add_known_test_user "x@y.com"
  registry_add_known_test_user "x@y.com"
  registry_add_known_test_user "z@w.com"
  count="$(jq '.knownTestUsers | length' "$REGISTRY")"
  [ "$count" -eq 2 ]
}

@test "registry_account_count returns the number of accounts" {
  registry_init
  result="$(registry_account_count)"
  [ "$result" -eq 0 ]
  registry_add_account "personal" "p@gmail.com" "$HOME/.config/gws" true ""
  result="$(registry_account_count)"
  [ "$result" -eq 1 ]
}

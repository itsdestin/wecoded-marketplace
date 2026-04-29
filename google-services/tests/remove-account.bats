#!/usr/bin/env bats

# Tests for remove-account.sh. Real `gws auth logout` invocation is mocked
# via PATH redirection so tests don't require an actual Google account.

setup() {
  export TMP_HOME="$BATS_TEST_TMPDIR/home"
  mkdir -p "$TMP_HOME/.config/gws-work" "$TMP_HOME/.config/gws"
  export HOME="$TMP_HOME"
  export REGISTRY="$HOME/.config/gws-profiles.json"
  source "$BATS_TEST_DIRNAME/../lib/registry.sh"

  # Stub `gws` so `gws auth logout` doesn't try to talk to Google.
  export STUB_DIR="$BATS_TEST_TMPDIR/stub"
  mkdir -p "$STUB_DIR"
  cat > "$STUB_DIR/gws" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
  chmod +x "$STUB_DIR/gws"
  export PATH="$STUB_DIR:$PATH"

  # Seed the registry with two accounts.
  registry_init
  registry_add_account "personal" "p@gmail.com" "$HOME/.config/gws" true "youcoded-personal-abc"
  registry_add_account "work" "work@acme.com" "$HOME/.config/gws-work" false ""
  registry_set_default "personal"
}

@test "remove-account.sh removes a non-default account" {
  run bash "$BATS_TEST_DIRNAME/../setup/remove-account.sh" --name work
  [ "$status" -eq 0 ]
  [ ! -d "$HOME/.config/gws-work" ]
  count="$(registry_account_count)"
  [ "$count" -eq 1 ]
  default="$(registry_get_default_name)"
  [ "$default" = "personal" ]
}

@test "remove-account.sh deletes the registry when removing the last account" {
  registry_remove_account "work"  # remove work directly so only personal remains
  run bash "$BATS_TEST_DIRNAME/../setup/remove-account.sh" --name personal
  [ "$status" -eq 0 ]
  [ ! -f "$REGISTRY" ]
}

@test "remove-account.sh exits nonzero for unknown account name" {
  run bash "$BATS_TEST_DIRNAME/../setup/remove-account.sh" --name nonexistent
  [ "$status" -ne 0 ]
}

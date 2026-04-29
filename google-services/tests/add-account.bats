#!/usr/bin/env bats

# Tests for add-account.sh argument validation only. Real fast-path and
# slow-path flows are smoke-tested manually (Phase 9) because they invoke
# real `gws auth login` and require browser interaction.

@test "add-account.sh exits nonzero with no args" {
  run bash "$BATS_TEST_DIRNAME/../setup/add-account.sh"
  [ "$status" -ne 0 ]
}

@test "add-account.sh exits nonzero on unknown flag" {
  run bash "$BATS_TEST_DIRNAME/../setup/add-account.sh" --bogus
  [ "$status" -ne 0 ]
}

@test "add-account.sh requires --name --email --fast-path|--slow-path" {
  run bash "$BATS_TEST_DIRNAME/../setup/add-account.sh" --name work
  [ "$status" -ne 0 ]
}

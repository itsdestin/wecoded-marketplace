#!/usr/bin/env bash
# install-gws.sh
# Installs the pinned version of gws (Google Workspace CLI) from the upstream
# GitHub release. Automates PATH setup so the user never sees that word.

set -euo pipefail

# Pinned without leading 'v'; prepended only when building the release URL.
# `gws --version` prints the number without 'v', so comparison is direct.
GWS_PINNED_VERSION="0.22.5"  # Update quarterly; last bumped 2026-04-16.
INSTALL_DIR="$HOME/.youcoded/bin"

# If an existing `gws` is on PATH, check its version.
# `gws --version` prints TWO lines ("gws X.Y.Z" + a disclaimer) so the pipeline
# must take only the first line, then field 2. awk '{print $NF}' on its own
# returns garbage because $NF runs per-line and concatenates fields.
if command -v gws >/dev/null 2>&1; then
  installed_version=$(gws --version 2>/dev/null | head -n1 | awk '{print $2}')
  if [ "$installed_version" = "$GWS_PINNED_VERSION" ]; then
    echo "Google Workspace helper already installed."
    exit 0
  fi

  # If an older/unmanaged gws shadows ours on PATH, installing to $INSTALL_DIR
  # alone won't help — the old one still wins. Require the user to remove it
  # first so we don't "succeed" while still invoking the old binary.
  existing_path=$(command -v gws)
  case "$existing_path" in
    "$INSTALL_DIR"/*)
      : # Our managed location — proceed to overwrite with the pinned version.
      ;;
    *)
      echo ""
      echo "An older Google Services helper is installed at a location"
      echo "YouCoded doesn't manage. Please remove it first:"
      case "$existing_path" in
        *AppData/Roaming/npm/*|*node_modules/.bin/*) echo "  npm uninstall -g @googleworkspace/cli" ;;
        */homebrew/*|*/.linuxbrew/*)                 echo "  brew uninstall gws" ;;
        */.cargo/bin/*)                              echo "  cargo uninstall gws" ;;
        *)                                           echo "  remove $existing_path manually" ;;
      esac
      echo "Then run /google-services-setup again."
      exit 1
      ;;
  esac
fi

# Upstream ships Rust-triple-named assets; pick the right one for this platform.
OS=$(uname -s)
ARCH=$(uname -m)
case "$OS-$ARCH" in
  Darwin-x86_64)                             ASSET="google-workspace-cli-x86_64-apple-darwin.tar.gz";       EXTRACT="tar" ;;
  Darwin-arm64|Darwin-aarch64)               ASSET="google-workspace-cli-aarch64-apple-darwin.tar.gz";      EXTRACT="tar" ;;
  Linux-x86_64)                              ASSET="google-workspace-cli-x86_64-unknown-linux-gnu.tar.gz";  EXTRACT="tar" ;;
  Linux-aarch64)                             ASSET="google-workspace-cli-aarch64-unknown-linux-gnu.tar.gz"; EXTRACT="tar" ;;
  MINGW*-x86_64|MSYS*-x86_64|CYGWIN*-x86_64) ASSET="google-workspace-cli-x86_64-pc-windows-msvc.zip";       EXTRACT="zip" ;;
  *)
    echo "Unsupported platform: $OS-$ARCH"
    exit 1
    ;;
esac

URL="https://github.com/googleworkspace/cli/releases/download/v${GWS_PINNED_VERSION}/${ASSET}"
mkdir -p "$INSTALL_DIR"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -fsSL "$URL" -o "$TMP/$ASSET"
mkdir -p "$TMP/extracted"
if [ "$EXTRACT" = "zip" ]; then
  unzip -o "$TMP/$ASSET" -d "$TMP/extracted" >/dev/null
else
  tar -xzf "$TMP/$ASSET" -C "$TMP/extracted"
fi

# All three archives put the binary (gws / gws.exe) at the archive root.
BIN_SRC=""
for candidate in "$TMP/extracted/gws.exe" "$TMP/extracted/gws"; do
  if [ -f "$candidate" ]; then
    BIN_SRC="$candidate"
    break
  fi
done
if [ -z "$BIN_SRC" ]; then
  echo "Expected binary (gws or gws.exe) not found at archive root."
  echo "Archive contents:"
  ls -la "$TMP/extracted"
  exit 1
fi

BIN_DST="$INSTALL_DIR/$(basename "$BIN_SRC")"
cp "$BIN_SRC" "$BIN_DST"
chmod +x "$BIN_DST"

# Automatically add the install dir to PATH for this session AND persist it to
# the user's shell profile for future sessions. No user-facing "add to PATH"
# message — that flow is unfit for non-developer users.
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) export PATH="$INSTALL_DIR:$PATH" ;;
esac

# Persist: append an `export PATH` line to the user's shell profile, guarded by
# a marker so re-runs don't duplicate. If the profile write fails for any
# reason (permissions, unknown shell), silently continue — the in-process
# export above still covers this invocation, and lib/gws-wrapper.sh prepends
# the same dir at every skill invocation as a belt-and-suspenders.
persist_path_in_profile() {
  local profile shell_name marker line
  shell_name=$(basename "${SHELL:-/bin/bash}")
  case "$shell_name" in
    zsh)   profile="$HOME/.zshrc" ;;
    bash)
      if [ "$(uname -s)" = "Darwin" ]; then
        profile="$HOME/.bash_profile"
      else
        profile="$HOME/.bashrc"
      fi
      ;;
    *) profile="$HOME/.profile" ;;
  esac

  marker='# YouCoded Google Services — gws helper'
  line='export PATH="$HOME/.youcoded/bin:$PATH"'

  touch "$profile" 2>/dev/null || return 0
  if ! grep -Fq "$marker" "$profile" 2>/dev/null; then
    { printf '\n%s\n%s\n' "$marker" "$line" >> "$profile"; } 2>/dev/null || return 0
  fi
}
persist_path_in_profile || true

# Belt-and-suspenders: confirm the new binary is resolvable in this shell.
# Since we export PATH above, this should always succeed. A failure here means
# something unexpected (e.g., filesystem mount quirk) — surface a real error.
if ! command -v gws >/dev/null 2>&1; then
  echo "Install verification failed — the helper tool could not be found"
  echo "after installation. Please contact YouCoded support and include"
  echo "this message plus: $BIN_DST"
  exit 1
fi

echo "Google Workspace helper installed."

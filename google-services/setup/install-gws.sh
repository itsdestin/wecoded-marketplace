#!/usr/bin/env bash
# install-gws.sh
# Detects whether the pinned version of gws is installed; if not, installs it
# via brew/cargo/prebuilt binary depending on the platform.

set -euo pipefail

GWS_PINNED_VERSION="v0.22.5"  # Update quarterly; last bumped 2026-04-16

if command -v gws >/dev/null 2>&1; then
  installed_version=$(gws --version 2>/dev/null | awk '{print $NF}')
  if [ "$installed_version" = "$GWS_PINNED_VERSION" ]; then
    echo "Google Workspace helper already installed."
    exit 0
  fi
  echo "Found gws $installed_version; updating to pinned $GWS_PINNED_VERSION..."
fi

OS=$(uname -s)
case "$OS" in
  Darwin)
    if command -v brew >/dev/null 2>&1; then
      brew install googleworkspace/tap/gws
    else
      echo "Homebrew is required on macOS. Install from https://brew.sh and re-run setup."
      exit 1
    fi
    ;;
  Linux)
    if command -v cargo >/dev/null 2>&1; then
      cargo install --locked --version "${GWS_PINNED_VERSION#v}" gws
    else
      echo "Rust's cargo is required for the Linux install path of this tool."
      echo "Install Rust from https://rustup.rs and re-run /google-services-setup."
      exit 1
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    # Use the prebuilt Windows binary from the GitHub release
    ARCH=$(uname -m)
    case "$ARCH" in
      x86_64) GWS_ASSET="gws-windows-x86_64.zip" ;;
      *) echo "Unsupported Windows architecture: $ARCH"; exit 1 ;;
    esac
    URL="https://github.com/googleworkspace/cli/releases/download/${GWS_PINNED_VERSION}/${GWS_ASSET}"
    INSTALL_DIR="$HOME/.youcoded/bin"
    mkdir -p "$INSTALL_DIR"
    curl -fsSL "$URL" -o /tmp/gws.zip
    unzip -o /tmp/gws.zip -d "$INSTALL_DIR"
    chmod +x "$INSTALL_DIR/gws.exe"
    # Note: $INSTALL_DIR should be on PATH; prompt user if not
    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
      echo ""
      echo "Add $INSTALL_DIR to your PATH to complete the install,"
      echo "then re-run /google-services-setup."
      exit 2
    fi
    ;;
  *)
    echo "Unsupported operating system: $OS"
    exit 1
    ;;
esac

# Verify
if ! command -v gws >/dev/null 2>&1; then
  echo ""
  echo "Installation complete, but you may need to restart your terminal."
  echo "After restarting, run /google-services-setup again."
  exit 2
fi

echo "Google Workspace helper installed."

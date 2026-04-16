#!/usr/bin/env bash
# install-gcloud.sh
# Detects whether gcloud is installed; if not, prompts the user and installs
# it via the platform's package manager.
# User-facing text follows the non-technical-language policy — no "CLI," "SDK,"
# or other jargon in user-visible strings.

set -euo pipefail

if command -v gcloud >/dev/null 2>&1; then
  echo "Google helper tool already installed."
  exit 0
fi

echo ""
echo "YouCoded needs to install a small helper tool from Google"
echo "to connect to your account safely. This takes about 2 minutes"
echo "and about 500 MB of disk space."
echo ""
read -r -p "Install it now? [y/N] " reply
case "$reply" in
  [Yy]*) ;;
  *)
    echo ""
    echo "Setup cancelled. You can install the tool manually by visiting"
    echo "https://cloud.google.com/sdk/docs/install then run /google-services-setup again."
    exit 1
    ;;
esac

OS=$(uname -s)
case "$OS" in
  Darwin)
    if ! command -v brew >/dev/null 2>&1; then
      echo "Homebrew is required on macOS. Install from https://brew.sh and re-run setup."
      exit 1
    fi
    brew install --cask google-cloud-sdk
    ;;
  Linux)
    if command -v apt-get >/dev/null 2>&1; then
      # Follow Google's official apt instructions
      echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | sudo tee -a /etc/apt/sources.list.d/google-cloud-sdk.list
      curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | sudo apt-key --keyring /usr/share/keyrings/cloud.google.gpg add -
      sudo apt-get update && sudo apt-get install -y google-cloud-cli
    else
      echo "Your Linux distribution isn't supported by this installer."
      echo "Install the Google helper tool manually from https://cloud.google.com/sdk/docs/install"
      echo "then re-run /google-services-setup."
      exit 1
    fi
    ;;
  MINGW*|MSYS*|CYGWIN*)
    if ! command -v winget >/dev/null 2>&1; then
      echo "winget (Windows Package Manager) is required. Install from the Microsoft Store,"
      echo "then re-run /google-services-setup."
      exit 1
    fi
    winget install --id Google.CloudSDK --accept-package-agreements --accept-source-agreements
    ;;
  *)
    echo "Unsupported operating system: $OS"
    exit 1
    ;;
esac

# Verify the install
if ! command -v gcloud >/dev/null 2>&1; then
  # On some platforms gcloud is installed but not yet on PATH in this shell
  echo ""
  echo "Installation complete, but you may need to restart your terminal"
  echo "to use the tool. After restarting, run /google-services-setup again."
  exit 2
fi

echo "Google helper tool installed."

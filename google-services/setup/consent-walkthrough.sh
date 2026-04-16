#!/usr/bin/env bash
# consent-walkthrough.sh
# Guides the user through the ~3 minutes of Cloud Console clicks that Google
# does not permit to be automated for External OAuth apps. Idempotent: if
# oauth-credentials.json already exists, skips and reports "already configured."

set -euo pipefail

: "${YOUCODED_OUTPUT_DIR:?must be set}"

# shellcheck source=/dev/null
source "$YOUCODED_OUTPUT_DIR/project.env"  # provides PROJECT_ID
: "${PROJECT_ID:?project.env missing PROJECT_ID}"

CREDS_FILE="$YOUCODED_OUTPUT_DIR/oauth-credentials.json"

if [ -f "$CREDS_FILE" ]; then
  echo "  ✓ Permissions screen already configured"
  exit 0
fi

# ------- Open cross-platform -------
open_url() {
  local url="$1"
  case "$(uname -s)" in
    Darwin)                     open "$url" ;;
    Linux)                      xdg-open "$url" 2>/dev/null || echo "Open this URL in your browser: $url" ;;
    MINGW*|MSYS*|CYGWIN*)       start "" "$url" ;;
    *)                          echo "Open this URL in your browser: $url" ;;
  esac
}

# ------- Step 3B: Consent screen configuration -------
cat <<EOF

One quick thing I can't do for you automatically.

Google needs you to set up the permissions screen yourself. I've
opened the page in your browser — follow along:

  1. Click "Get Started"
  2. Choose audience: "External"   (important — not "Internal")
  3. App name: "YouCoded Personal"
  4. Support email: your own email
  5. Click Save and Continue through the next screens
  6. On the "Test users" screen, add your own email as a test user
  7. Click Back to Dashboard

EOF

open_url "https://console.cloud.google.com/auth/branding?project=$PROJECT_ID"

read -r -p "Press Enter when you're done..." _

# ------- Step 3C: OAuth client ID creation -------
cat <<EOF

One more page. Opening your browser now.

  1. Click "Create Credentials" → "OAuth client ID"
  2. Application type: "Desktop app"
  3. Name: "YouCoded Personal"
  4. Click Create
  5. Copy the Client ID and Client Secret from the box that appears
  6. Paste them below when prompted

EOF

open_url "https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"

read -r -p "Client ID: " CLIENT_ID
read -r -s -p "Client Secret: " CLIENT_SECRET
echo

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  echo ""
  echo "Couldn't read the credentials. Re-run /google-services-setup to try again."
  exit 1
fi

# ------- Write credentials -------
umask 077  # file readable only by current user
cat > "$CREDS_FILE" <<EOF
{
  "client_id": "$CLIENT_ID",
  "client_secret": "$CLIENT_SECRET",
  "project_id": "$PROJECT_ID"
}
EOF

echo "  ✓ Saved your permissions setup"

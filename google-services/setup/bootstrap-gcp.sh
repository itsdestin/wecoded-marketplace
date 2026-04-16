#!/usr/bin/env bash
# bootstrap-gcp.sh
# Drives gcloud to create the user's personal YouCoded GCP project and enable
# the six Google APIs. Idempotent: on re-run, detects existing project and
# resumes (covers "project exists but N of 6 APIs enabled").
#
# Writes the created/found project_id to $YOUCODED_OUTPUT_DIR/project.env for
# later scripts to consume. Does NOT handle OAuth consent/client creation —
# that moved to consent-walkthrough.sh (per IAP OAuth Admin API shutdown).
#
# Emits plain-language progress as lines prefixed with "  ✓" for the slash
# command to echo directly.

set -euo pipefail

APIS=(gmail.googleapis.com drive.googleapis.com docs.googleapis.com
      sheets.googleapis.com slides.googleapis.com calendar-json.googleapis.com)

: "${YOUCODED_OUTPUT_DIR:?must be set}"

# ------- Idempotency: detect existing YouCoded project -------
EXISTING_PROJECT=$(gcloud projects list --filter="name:YouCoded Personal" --format="value(projectId)" 2>/dev/null | head -n1)

if [ -n "$EXISTING_PROJECT" ]; then
  PROJECT_ID="$EXISTING_PROJECT"
  echo "  ✓ Found existing YouCoded connection ($PROJECT_ID)"
else
  SUFFIX=$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c 6)
  PROJECT_ID="youcoded-personal-$SUFFIX"
  gcloud projects create "$PROJECT_ID" --name="YouCoded Personal" --quiet >/dev/null
  echo "  ✓ Created your private YouCoded connection"
fi

gcloud config set project "$PROJECT_ID" --quiet >/dev/null

# ------- Enable the six APIs (idempotent per-API) -------
for api in "${APIS[@]}"; do
  case "$api" in
    gmail.googleapis.com)          label="Gmail" ;;
    drive.googleapis.com)          label="Drive" ;;
    docs.googleapis.com)           label="Docs" ;;
    sheets.googleapis.com)         label="Sheets" ;;
    slides.googleapis.com)         label="Slides" ;;
    calendar-json.googleapis.com)  label="Calendar" ;;
  esac
  if gcloud services list --enabled --filter="name:$api" --format="value(name)" | grep -q "$api"; then
    echo "  ✓ $label already unlocked"
  else
    gcloud services enable "$api" --quiet >/dev/null
    echo "  ✓ Unlocked $label"
  fi
done

# ------- Emit project_id for downstream scripts -------
mkdir -p "$YOUCODED_OUTPUT_DIR"
printf 'PROJECT_ID=%s\n' "$PROJECT_ID" > "$YOUCODED_OUTPUT_DIR/project.env"

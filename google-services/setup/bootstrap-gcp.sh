#!/usr/bin/env bash
# bootstrap-gcp.sh
# Drives gcloud to create the user's personal YouCoded GCP project and enable
# the six Google APIs. Idempotent: on re-run, detects existing project and
# resumes (covers "project exists but N of 6 APIs enabled").
#
# Writes the created/found project_id to $YOUCODED_OUTPUT_DIR/project.env for
# later scripts to consume. Does NOT handle OAuth consent/client creation —
# those three Cloud Console pages are driven by the /google-services-setup
# slash command (Steps 3B/3C/3D) and the user's downloaded credentials JSON
# is ingested by ingest-oauth-json.sh.
#
# Emits plain-language progress as lines prefixed with "  ✓" for the slash
# command to echo directly.

set -euo pipefail

APIS=(gmail.googleapis.com drive.googleapis.com docs.googleapis.com
      sheets.googleapis.com slides.googleapis.com calendar-json.googleapis.com)

: "${YOUCODED_OUTPUT_DIR:?must be set}"

# ------- Idempotency: detect existing YouCoded project -------
# MSYS/Git-Bash note: avoid `| head` and `| grep -q` pipelines here. Under
# `set -o pipefail`, when the downstream tool closes its stdin after reading
# enough, the upstream gcloud/tr writer receives SIGPIPE and the pipeline
# reports exit 141 — which `set -e` then turns into a silent abort before
# any `  ✓` line prints. Use command substitution + bash string ops instead.
_projects=$(gcloud projects list --filter="name:YouCoded Personal" --format="value(projectId)" 2>/dev/null || true)
EXISTING_PROJECT="${_projects%%$'\n'*}"  # first line, if any, via pure-bash splitting

if [ -n "$EXISTING_PROJECT" ]; then
  PROJECT_ID="$EXISTING_PROJECT"
  echo "  ✓ Found existing YouCoded connection ($PROJECT_ID)"
else
  # 6-char [a-z0-9] suffix via pure-bash string slicing — no subprocess, no
  # pipe, no SIGPIPE. $RANDOM is 15-bit but that's plenty of entropy for a
  # collision-avoidance suffix on a project ID.
  SUFFIX=""
  _CHARS="abcdefghijklmnopqrstuvwxyz0123456789"
  for _ in 1 2 3 4 5 6; do
    SUFFIX="${SUFFIX}${_CHARS:$((RANDOM % 36)):1}"
  done
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
  # See MSYS pipefail note above — use command substitution, not `| grep -q`.
  _enabled=$(gcloud services list --enabled --filter="name:$api" --format="value(name)" 2>/dev/null || true)
  if [ "$_enabled" = "$api" ]; then
    echo "  ✓ $label already unlocked"
  else
    gcloud services enable "$api" --quiet >/dev/null
    echo "  ✓ Unlocked $label"
  fi
done

# ------- Emit project_id for downstream scripts -------
mkdir -p "$YOUCODED_OUTPUT_DIR"
printf 'PROJECT_ID=%s\n' "$PROJECT_ID" > "$YOUCODED_OUTPUT_DIR/project.env"

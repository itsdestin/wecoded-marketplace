#!/usr/bin/env bash
# Manual end-to-end verification after first deploy.
# Usage: smoke-test.sh https://destincode-marketplace-api.<subdomain>.workers.dev
set -euo pipefail

HOST="${1:?usage: smoke-test.sh <worker-host>}"

echo "== /health =="
curl -sf "$HOST/health" | tee /dev/stderr | grep -q '"ok":true'

echo
echo "== /auth/github/start =="
START=$(curl -sf -X POST "$HOST/auth/github/start")
echo "$START" | python -m json.tool
DEVICE_CODE=$(echo "$START" | python -c 'import sys,json;print(json.load(sys.stdin)["device_code"])')
USER_CODE=$(echo "$START" | python -c 'import sys,json;print(json.load(sys.stdin)["user_code"])')

echo
echo "1) Open this URL in a browser:"
echo "   $HOST/auth/github/start-redirect?user_code=$USER_CODE"
echo "2) Complete GitHub OAuth."
echo "3) Press ENTER to continue."
read -r _

echo "== /auth/github/poll =="
POLL=$(curl -sf -X POST "$HOST/auth/github/poll" -H 'Content-Type: application/json' -d "{\"device_code\":\"$DEVICE_CODE\"}")
echo "$POLL" | python -m json.tool
TOKEN=$(echo "$POLL" | python -c 'import sys,json;print(json.load(sys.stdin)["token"])')

echo
echo "== POST /installs =="
curl -sf -X POST "$HOST/installs" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"plugin_id":"smoke-test:hello"}' | python -m json.tool

echo
echo "== POST /ratings =="
curl -sf -X POST "$HOST/ratings" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"plugin_id":"smoke-test:hello","stars":4,"review_text":"works"}' | python -m json.tool

echo
echo "== GET /stats =="
curl -sf "$HOST/stats" | python -m json.tool | head -40

echo
echo "== DELETE /ratings/smoke-test:hello =="
curl -sf -X DELETE "$HOST/ratings/smoke-test:hello" \
  -H "Authorization: Bearer $TOKEN" | python -m json.tool

echo
echo "SMOKE TEST PASSED"

#!/usr/bin/env bash
# migrate-legacy.sh
# Run at end of /google-services-setup. Detects artifacts from the predecessor
# integrations on the user's machine and cleans them up silently.

set -u

any_cleaned=0

# rclone gdrive: remote (from youcoded-drive)
if command -v rclone >/dev/null 2>&1; then
  if rclone listremotes 2>/dev/null | grep -q "^gdrive:$"; then
    rclone config delete gdrive >/dev/null 2>&1 || true
    any_cleaned=1
  fi
fi

# Disable deprecated google-workspace plugin if enabled
SETTINGS="$HOME/.claude/settings.json"
if [ -f "$SETTINGS" ] && grep -q "\"google-workspace@" "$SETTINGS"; then
  # Remove the entry via python (preserves JSON formatting)
  python - <<'PY' "$SETTINGS"
import json, sys
p = sys.argv[1]
with open(p) as f: s = json.load(f)
ep = s.get("enabledPlugins", {})
for k in list(ep.keys()):
    if k.startswith("google-workspace@"):
        del ep[k]
with open(p, "w") as f: json.dump(s, f, indent=2)
PY
  any_cleaned=1
fi

# Emit a single line only if something was cleaned
if [ "$any_cleaned" = "1" ]; then
  echo "  ✓ Cleaning up old Google connections"
fi

exit 0

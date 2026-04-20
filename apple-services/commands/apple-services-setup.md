---
description: "Set up Apple Services (Calendar, Reminders, Contacts, Notes, Mail, iCloud Drive) with one command. Installs helper, grants macOS permissions, and verifies each service."
---

Run the Apple Services setup. Follow the steps below in order.

## How to talk to the user

Behind the scenes, this setup runs small helpers that do technical work. The user should never see that work — only what's happening in plain, everyday words.

**When things are going well:** one short, human sentence, or nothing at all. "Apple apps are connected." "You're all set."

**When something doesn't work:** give the user a brief, plain-language sense of what kind of problem it was, then offer a choice using `AskUserQuestion` — you look into it, or they retry later.

Pick the line that best matches where things fell apart:

- macOS version too old: "Apple Services needs a newer version of macOS."
- iCloud Drive off: "iCloud Drive isn't turned on."
- Helper not installed: "The setup helper didn't install properly."
- Permissions denied: "Apple apps access wasn't granted."
- Smoke test failure: "One or more Apple apps didn't respond."

Then ask:

- **question:** "Want me to look into it, or try again later?"
- **header:** "Setup hit a snag"
- **options:**
  - label: "Look into it" — description: "I'll investigate and try to fix it."
  - label: "Try again later" — description: "Run /apple-services-setup again whenever you're ready."

### Words to never say to the user

Any helper's name, CLI, API, framework, TCC, AppleScript, osascript, xattr, codesign, terminal, shell, binary, Mach-O, file, folder, directory, path, exit code, SHA, JSON, Press Enter.

### Words that are fine

Calendar, Reminders, Contacts, Notes, Mail, iCloud Drive, "Apple apps," "your Mac," "permission," "allow," "all set," "let's try that again."

### Gates between steps

Every gate between steps uses `AskUserQuestion`. YouCoded is a chat — the user can't press Enter at a terminal. If a step tells you to "run this script" or "show the dialog," just do it — no extra "Ready?" confirmation.

---

## Step 0 — Acknowledge start

Send in chat:

> Getting Apple apps ready for YouCoded...

Silently set up the session:

```bash
export PLUGIN_DIR="$HOME/.claude/plugins/marketplaces/youcoded/plugins/apple-services"
# Dev fallback: if not installed via marketplace, fall back to the sibling checkout
if [ ! -d "$PLUGIN_DIR" ]; then
  for candidate in "$HOME/youcoded-dev/wecoded-marketplace/apple-services" "$HOME/youcoded-dev/.worktrees/apple-services/apple-services"; do
    [ -d "$candidate" ] && { export PLUGIN_DIR="$candidate"; break; }
  done
fi
```

## Step 1 — Platform + version + dependency check

Run:

```bash
if [ "$(uname)" != "Darwin" ]; then
  echo "PLATFORM_NOT_MAC"; exit 1
fi
macos_major=$(sw_vers -productVersion | cut -d. -f1)
if [ "$macos_major" -lt 14 ]; then
  echo "MACOS_TOO_OLD $(sw_vers -productVersion)"; exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "JQ_MISSING"; exit 1
fi
echo "OK"
```

Handle the output:
- `OK` → continue to Step 2.
- `PLATFORM_NOT_MAC` → send "Apple Services only runs on a Mac — you can install it when you're on one." and stop.
- `MACOS_TOO_OLD X.Y` → send "Apple Services needs macOS 14 (Sonoma) or newer — you're on X.Y. Update macOS from System Settings → General → Software Update, then run this again." and stop.
- `JQ_MISSING` → send "Apple Services needs a small tool called **jq** to format results. Open Terminal and run: `brew install jq` — then come back and run `/apple-services-setup` again. If you don't have Homebrew, install it from https://brew.sh first." and stop.

## Step 2 — Install the helper to a stable path

Run:

```bash
install_dir="$HOME/.apple-services/bin"
mkdir -p "$install_dir"

if [ ! -f "$PLUGIN_DIR/bin/apple-helper" ]; then
  echo "HELPER_MISSING"; exit 1
fi

expected_sha=$(cat "$PLUGIN_DIR/bin/apple-helper.sha256")

# Idempotent: if installed binary matches, skip the copy (preserves TCC grants).
if [ -f "$install_dir/apple-helper" ]; then
  actual_sha=$(shasum -a 256 "$install_dir/apple-helper" | cut -d' ' -f1)
  if [ "$actual_sha" = "$expected_sha" ]; then
    echo "OK_ALREADY"
    exit 0
  fi
fi

cp "$PLUGIN_DIR/bin/apple-helper" "$install_dir/apple-helper"
xattr -d com.apple.quarantine "$install_dir/apple-helper" 2>/dev/null || true
chmod +x "$install_dir/apple-helper"

actual_sha=$(shasum -a 256 "$install_dir/apple-helper" | cut -d' ' -f1)
[ "$expected_sha" = "$actual_sha" ] || { echo "SHA_MISMATCH $expected_sha $actual_sha"; exit 1; }

echo "OK_INSTALLED"
```

Handle:
- `OK_ALREADY` or `OK_INSTALLED` → continue.
- `HELPER_MISSING` → send "The setup helper isn't in your plugin install — try reinstalling Apple Services from the marketplace." and stop.
- `SHA_MISMATCH ...` → send "The setup helper didn't match its expected fingerprint — your plugin install may be damaged. Reinstall Apple Services from the marketplace." and stop.

Before continuing, if `OK_INSTALLED`, send: "Setting up a small tool that lets Claude talk to your Apple apps. One-time, happens locally on your Mac."

## Step 3 — iCloud Drive availability check

Run:

```bash
if [ -d "$HOME/Library/Mobile Documents/com~apple~CloudDocs" ]; then
  echo "OK"
else
  echo "MISSING"
fi
```

Handle:
- `OK` → continue.
- `MISSING` → send "iCloud Drive isn't turned on. Open System Settings → your name at the top → iCloud → iCloud Drive, turn it on, then run this again." and stop.

## Step 4 — Calendar, Reminders, Contacts permissions

Before running the helper, detect which app macOS will attribute Automation prompts to:

```bash
# Walk up from our PID; take the first ancestor that isn't bash/zsh/sh.
host_pid=$PPID
while true; do
  comm=$(ps -o comm= -p "$host_pid" 2>/dev/null | xargs basename 2>/dev/null || echo "")
  case "$comm" in
    bash|zsh|sh|-bash|-zsh) host_pid=$(ps -o ppid= -p "$host_pid" | xargs); [ "$host_pid" = 1 ] && break ;;
    *) break ;;
  esac
done
host_app=$(ps -o comm= -p "$host_pid" 2>/dev/null | xargs basename 2>/dev/null || echo "Terminal")
# Friendly name
case "$host_app" in
  YouCoded|youcoded) host_friendly="YouCoded" ;;
  iTerm2|iTerm) host_friendly="iTerm" ;;
  Terminal) host_friendly="Terminal" ;;
  *) host_friendly="$host_app" ;;
esac
echo "$host_friendly"
```

Remember `host_friendly` — you'll reuse it in Step 5.

Send this pre-frame (substituting — don't show the variable to the user):

> macOS is about to show three permission dialogs, in this order: Calendar, then Reminders, then Contacts. Each will ask whether a tool called **apple-helper** can access that data. Click **Allow** on all three.

Then run:

```bash
~/.apple-services/bin/apple-helper request-permissions 2>&1
```

Handle the output:
- Contains `{"ok":true,"granted":["calendar","reminders","contacts"]}` → send "Calendar, Reminders, and Contacts are connected." and continue to Step 5.
- Contains `TCC_DENIED:calendar` → send "Calendar access was denied. Open System Settings → Privacy & Security → Calendars, find **apple-helper** in the list, turn it on. Then run `/apple-services-setup` again." and stop.
- Same for `TCC_DENIED:reminders` and `TCC_DENIED:contacts` (substitute the right app pane).

## Step 5 — Notes and Mail automation permissions

Send:

> macOS is about to ask if **{{host_friendly}}** can control Notes, then the same for Mail. Click **OK** on both prompts.

Run (with 10s timeout as belt-and-suspenders for indexing edge cases):

```bash
timeout 10 osascript -e 'tell application "Notes" to count notes' 2>&1
notes_exit=$?

# Per Phase 0 R7: use 'count every account' as the Mail pre-flight. Returns 0
# instantly when Mail has no accounts configured, avoiding the hanging
# inbox-construction path that 'count messages of inbox' hits.
mail_acct_out=$(timeout 10 osascript -e 'tell application "Mail" to count every account' 2>&1)
mail_acct_exit=$?
if [ "$mail_acct_exit" = 0 ] && [ "$mail_acct_out" = "0" ]; then
  mail_result=NO_ACCOUNTS
elif [ "$mail_acct_exit" != 0 ]; then
  mail_result="FAIL:$mail_acct_out"
else
  # Mail has accounts — confirm mailboxes are queryable.
  timeout 10 osascript -e 'tell application "Mail" to count messages of inbox' 2>&1
  mail_msgs_exit=$?
  if [ "$mail_msgs_exit" = 0 ]; then
    mail_result=OK
  elif [ "$mail_msgs_exit" = 124 ]; then
    mail_result=MAIL_SLOW
  else
    mail_result=FAIL
  fi
fi
echo "notes=$notes_exit mail=$mail_result"
```

Handle:
- `notes=0` and `mail=OK` → send "Notes and Mail are connected." and continue to Step 6.
- `notes != 0` with `(-1743)` in stderr → send "Notes access was denied. Open System Settings → Privacy & Security → Automation, find **{{host_friendly}}**, turn on Notes underneath it. Then run `/apple-services-setup` again." and stop.
- `mail=NO_ACCOUNTS` → send "Mail isn't set up yet — it has no accounts configured. Open Mail.app, add at least one account, then run `/apple-services-setup` again." and stop.
- `mail=MAIL_SLOW` → send "Mail is still indexing — give it a few minutes, then run `/apple-services-setup` again." and stop.
- `mail=FAIL:...` with `(-1743)` in the message → Automation was denied; emit the automation-recovery message substituting `{{host_friendly}}`.
- `mail=FAIL` → send the generic "Mail didn't respond" error and stop.

## Step 6 — Smoke test each integration

Run all six probes. Each either succeeds (counts something ≥0) or fails independently:

```bash
WRAPPER="$PLUGIN_DIR/lib/apple-wrapper.sh"

probe() {
  local label="$1"; shift
  local result
  if result=$("$WRAPPER" "$@" 2>&1); then
    local count; count=$(echo "$result" | jq 'length' 2>/dev/null || echo 0)
    printf '%s\tPASS\t%s\n' "$label" "$count"
  else
    printf '%s\tFAIL\t%s\n' "$label" "$(echo "$result" | head -c 200)"
  fi
}

probe calendar     calendar     list_calendars
probe reminders    reminders    list_lists
probe contacts     contacts     list_groups
probe notes        notes        list_folders
probe mail         mail         list_mailboxes
probe icloud       icloud       list        --path ""
```

(All op names are snake_case, matching the AppleScript/JXA file basenames and the spec ops tables.)

Parse the output. If all six report `PASS`, continue to Step 7.

If any report `FAIL`, still run Step 7 but flag that integration in the summary with a "couldn't verify" note pointing the user to run `/apple-services-setup` again.

## Step 7 — Success summary

Build a summary like this (substituting the PASS counts from Step 6):

```
All set — Apple apps are connected.

  Calendar      {{count}} calendars
  Reminders     {{count}} lists
  Contacts      ready
  Notes         {{count}} folders
  Mail          {{count}} mailboxes
  iCloud Drive  {{count}} items at the top level

Try asking me:
  • "What's on my calendar this week?"
  • "Remind me at 5pm to call mom"
  • "Find Jenny's phone number"
  • "What's in my Notes folder 'Tahoe'?"
  • "Search my email for the lease renewal"
  • "Save this to my iCloud Drive in Claude/drops"
```

If any integration failed in Step 6, substitute "couldn't verify — try `/apple-services-setup` again" for that row and note it above the "Try asking me" block.

## Idempotency contract

Re-running `/apple-services-setup` is always safe:
- Step 1: pure check.
- Step 2: skipped if binary hash matches.
- Step 3: pure check.
- Step 4: no prompt if already granted.
- Step 5: no prompt if already granted.
- Steps 6-7: always run.

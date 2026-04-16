---
description: "Set up Google Services (Gmail, Drive, Docs, Sheets, Slides, Calendar) with one command. Installs helper tools, connects your Google account, and verifies each service works."
---

Run the Google Services bundle setup. Follow these steps in order. Show the user each line exactly as specified — all user-visible text below is final copy, do NOT paraphrase.

## Step 0 — System check

Echo:

```
Getting Google apps ready for YouCoded...
```

Detect the OS with `uname -s`. If the OS is not one of Darwin / Linux / MINGW*/MSYS*/CYGWIN*, abort with:

```
Sorry — Google Services setup doesn't support your system yet.
```

## Step 1 — Helper tools

Run `bash $PLUGIN_DIR/setup/install-gcloud.sh` and `bash $PLUGIN_DIR/setup/install-gws.sh` in that order. Each may prompt the user for install consent; honor their response. If either exits with code 2 (install complete but PATH not updated), stop and tell the user to restart their terminal and re-run `/google-services-setup`.

## Step 2 — First sign-in

Echo the framing text:

```
Next, YouCoded will open your browser twice to connect to Google:

  1. First, to create a private connection in your Google account
  2. Then, to ask your permission to use Gmail, Drive, Calendar,
     and your Google documents

The private connection is yours — it belongs to your Google
account, not to YouCoded or anyone else.

Press Enter to open your browser...
```

Wait for Enter, then run `gcloud auth login`. If it exits nonzero, abort with:

```
Sign-in didn't complete. Run /google-services-setup again when you're ready.
```

## Step 3 — Setting it up (4-phase hybrid)

Per the spec, this splits into (A) scripted scaffolding, (B) guided consent screen, (C) paste OAuth client credentials, (D) automated OAuth. Set the output dir once and run the scripts in order.

### Step 3A — Scripted scaffold

Echo "Setting up..." then run:

```bash
export YOUCODED_OUTPUT_DIR="$HOME/.youcoded/google-services"
bash $PLUGIN_DIR/setup/bootstrap-gcp.sh
```

`bootstrap-gcp.sh` emits each `  ✓` line itself — do not add extras. If it exits nonzero, abort with the error it printed.

### Step 3B + 3C — Guided console walkthrough

Run:

```bash
bash $PLUGIN_DIR/setup/consent-walkthrough.sh
```

The script:
- Prints the Step 3B block ("One quick thing I can't do for you automatically...") and opens Cloud Console's OAuth Consent Screen page. Waits for user to press Enter.
- Prints the Step 3C block ("One more page...") and opens Cloud Console's Credentials page. Prompts for client ID and client secret paste-in.
- Writes `$YOUCODED_OUTPUT_DIR/oauth-credentials.json`.

If it exits nonzero, abort with the error it printed.

## Step 4 — Unverified-app warning

Read the generated client_id to show the exact project ID:

```bash
PROJECT_ID=$(python -c "import json; print(json.load(open('$YOUCODED_OUTPUT_DIR/oauth-credentials.json'))['project_id'])")
```

Then echo (substituting `$PROJECT_ID`):

```
⚠ Heads up: on the next screen, Google will show you a warning
that says "Google hasn't verified this app."

This is expected and safe. The "app" is you — YouCoded just set
up a private connection inside your own Google account, and now
you're giving yourself permission to use it.

To continue through Google's warning:
  • Click "Advanced"
  • Click "Go to $PROJECT_ID (unsafe)"

Press Enter to continue...
```

Wait for Enter.

## Step 5 — Grant permissions

Echo:

```
Opening Google's permission page...

Google will ask whether YouCoded can read your email, access
your Drive files, and so on. Please check every box — leaving
any unchecked will cause some features to not work.
```

Run `gws auth setup --client-id <id> --client-secret <secret>` sourcing the credentials from `$YOUCODED_OUTPUT_DIR/oauth-credentials.json` (parse via `python -c "import json; ..."`). If `gws auth setup` exits nonzero, abort with:

```
Looks like you didn't finish approving the permissions. When
you're ready, run /google-services-setup again — this time click
"Advanced" then "Continue" on Google's warning screen.
```

## Step 6 — Make sure it actually works

Echo "Testing your connection..." then run `bash $PLUGIN_DIR/setup/smoke-test.sh`.

If exit 0: echo the "All set!" block:

```
All set! Try asking YouCoded something like:
  "Send an email to Mom"
  "Find my budget spreadsheet from last week"
  "What's on my calendar tomorrow?"
```

If exit nonzero: the smoke-test script already printed which service failed. Add:

```
Setup not yet complete. Run /google-services-setup again to retry the failing service.
```

Do NOT report success when any probe failed.

## Step 7 — Migration cleanup

Run `bash $PLUGIN_DIR/setup/migrate-legacy.sh` (exists only if legacy artifacts detected; script echoes its own `  ✓` line or nothing). The migrate script is added in Phase 6 of implementation; if not present yet, skip this step silently.

---

Throughout all steps: user-facing language only. Never surface "API," "gws," "gcloud," "OAuth scope," etc. in strings the user reads. Internal log lines for debugging are fine.

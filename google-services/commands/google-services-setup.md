---
description: "Set up Google Services (Gmail, Drive, Docs, Sheets, Slides, Calendar) with one command. Installs helper tools, connects your Google account, and verifies each service works."
---

Run the Google Services bundle setup. Follow the steps below in order.

All user-visible copy in this command is **final** — do not paraphrase. It must also be sent as **regular chat prose**, never wrapped in a ``` fence or surfaced as tool output. Fenced code blocks in this command are for bash you run, not for text the user reads.

**Gates between steps use the `AskUserQuestion` tool, never "Press Enter."** "Press Enter" is a terminal concept that doesn't exist in the YouCoded chat UI — saying it confuses the user. Whenever this command tells you to wait for confirmation, invoke `AskUserQuestion` with the specified question + options. Free-text user input (such as "paste a file path") is the only exception — those use a regular chat prompt.

## Step 0 — System check

Send this in chat:

> Getting Google apps ready for YouCoded...

Detect OS with `uname -s`. If not Darwin / Linux / MINGW*/MSYS*/CYGWIN*, send this in chat and abort:

> Sorry — Google Services setup doesn't support your system yet.

Silently prepend `$HOME/.youcoded/bin` to PATH for this session (emit nothing in chat):

```bash
export PATH="$HOME/.youcoded/bin:$PATH"
export YOUCODED_OUTPUT_DIR="$HOME/.youcoded/google-services"
```

## Step 1 — Helper tools

Run `bash $PLUGIN_DIR/setup/install-gcloud.sh` then `bash $PLUGIN_DIR/setup/install-gws.sh` in that order. Each may prompt for install consent — honor the user's response. Echo only what each script prints; do not add narration.

If either exits with code 2, echo the script's message verbatim and abort.

## Step 2 — First sign-in

Send this in chat:

> Next, I'll open your browser so you can sign in to Google. Pick your personal Google account when the page loads. I'll take it from there once you finish on Google's side.

Then ask with `AskUserQuestion`:

- **question:** "Ready to sign in to Google?"
- **header:** "Sign in"
- **options:**
  - label: "Yes, open Google" — description: "Opens your browser so you can sign in to your Google account."
  - label: "Cancel setup" — description: "Stops here. You can run /google-services-setup again whenever you're ready."

If the user picks "Cancel setup" (or an "Other" answer that amounts to cancellation), send this in chat and abort:

> No problem — run /google-services-setup again whenever you're ready.

Otherwise run `gcloud auth login`. If it exits nonzero, send this in chat and abort:

> Sign-in didn't complete. Run /google-services-setup again when you're ready.

## Step 3 — Setting it up

### Step 3A — Scaffold your Google project

Send this in chat:

> Setting things up on your Google account — this takes about a minute.

Run:

```bash
bash $PLUGIN_DIR/setup/bootstrap-gcp.sh
```

`bootstrap-gcp.sh` emits `  ✓` lines itself as each piece lands — echo those in chat as they appear. If it exits nonzero, echo the error verbatim and abort.

Source the project id so the next sub-steps can use it:

```bash
source "$YOUCODED_OUTPUT_DIR/project.env"
```

Send this in chat:

> Now I need you to set up three short pages inside Google's control panel. Each opens in your browser, takes a minute, and then you come back here and let me know.

Then ask with `AskUserQuestion`:

- **question:** "Ready to set up the three Google pages?"
- **header:** "Continue"
- **options:**
  - label: "Yes, let's go" — description: "I'll walk you through each page one at a time."
  - label: "Pause for now" — description: "Stops here. Progress is saved; running /google-services-setup again will pick up where we left off."

If the user picks "Pause for now", abort silently — no chat message needed beyond the pause confirmation. Otherwise proceed to 3B.

### Step 3B — Configure the consent screen

Send this in chat:

> **Page 1 of 3 — the consent screen.** This is a short form Google requires so your account knows you're connecting it to YouCoded.
>
> I'll open the page in your browser. Once it's loaded:
>
> 1. If the page asks you to "Get started," click that first.
> 2. App name: type **YouCoded**
> 3. User support email: pick your email from the dropdown
> 4. Audience: pick **External**
> 5. Developer contact email: type your email again
> 6. Click **Save and continue** through any remaining pages until you're back at the overview.
>
> When you see the overview page, come back here and let me know.

Open the page:

```bash
python -m webbrowser "https://console.cloud.google.com/auth/overview?project=$PROJECT_ID"
```

Then ask with `AskUserQuestion`:

- **question:** "Did the consent screen save successfully?"
- **header:** "Consent screen"
- **options:**
  - label: "Done, continue" — description: "I'll open the next page."
  - label: "I hit a problem" — description: "Tell me what happened and I'll help sort it out."

If the user picks "I hit a problem" (or provides an "Other" answer describing an issue), ask them in chat what went wrong, help them troubleshoot, then re-ask the question. If they abandon, abort politely.

Otherwise proceed to 3C.

### Step 3C — Add yourself as a test user

Send this in chat:

> **Page 2 of 3 — add yourself as a test user.** Google requires everyone using a new app to be on a test-users list while the app is in its warmup period. You're adding yourself.
>
> I'll open the test-users page:
>
> 1. Find the section titled **Test users**
> 2. Click **+ Add users**
> 3. Type your own Gmail address (the same one you signed in with earlier)
> 4. Click **Save**
>
> When you see your email in the test-users list, come back here and let me know.

Open the page:

```bash
python -m webbrowser "https://console.cloud.google.com/auth/audience?project=$PROJECT_ID"
```

Then ask with `AskUserQuestion`:

- **question:** "Did you add yourself as a test user?"
- **header:** "Test user"
- **options:**
  - label: "Done, continue" — description: "I'll open the last page."
  - label: "I hit a problem" — description: "Tell me what happened and I'll help sort it out."

Handle "I hit a problem" same as Step 3B. Otherwise proceed to 3D.

### Step 3D — Create the connection key

Send this in chat:

> **Page 3 of 3 — create the connection key.** This is the actual key YouCoded uses to talk to your Google account. You'll download it as a small file.
>
> I'll open the Credentials page:
>
> 1. Click **+ Create Credentials** at the top, then choose **OAuth client ID**
> 2. Application type: pick **Desktop app**
> 3. Name: type **YouCoded**
> 4. Click **Create** — a popup appears with your new key
> 5. Click **Download JSON** (top of the popup, or the button at the bottom). The file saves to your Downloads folder — you don't need to open it.
>
> Once the file has downloaded, come back here and let me know. I'll find it automatically.

Open the page:

```bash
python -m webbrowser "https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"
```

Then ask with `AskUserQuestion`:

- **question:** "Did the file download?"
- **header:** "Downloaded"
- **options:**
  - label: "Yes, it downloaded" — description: "I'll find it in your Downloads folder and use it automatically."
  - label: "I hit a problem" — description: "Tell me what happened and I'll help sort it out."

Handle "I hit a problem" same as Step 3B. Otherwise proceed to 3E.

### Step 3E — Read the downloaded file

Run:

```bash
bash $PLUGIN_DIR/setup/ingest-oauth-json.sh
```

If it exits 0, echo the `  ✓` line the script printed and proceed to Step 4.

If it exits nonzero (no file found, or file malformed), echo whatever the script printed to stderr, then send this in chat:

> If you saved the file somewhere other than Downloads, paste the full path here and I'll use that instead.

Wait for the user's next chat reply (free-text path). Take their reply as the path and re-run:

```bash
bash $PLUGIN_DIR/setup/ingest-oauth-json.sh "<the path the user pasted>"
```

Loop up to 3 times. If all 3 attempts fail, abort with the last error the script printed.

## Step 4 — Before the last browser step

Make sure `$PROJECT_ID` is set (re-source if needed):

```bash
source "$YOUCODED_OUTPUT_DIR/project.env"
```

Send this in chat (substituting `$PROJECT_ID` into the bolded button label):

> Heads up: in a moment Google will show you a screen that says "Google hasn't verified this app."
>
> This is expected and safe. The "app" is you — YouCoded just set up a private connection inside your own Google account, and now you're giving yourself permission to use it.
>
> When you see the warning page:
>
> • Click **Advanced**
> • Click **Go to $PROJECT_ID (unsafe)**
>
> After that, Google will show one more page asking which permissions to grant. **Please check every box** — any unchecked permission means some features won't work.
>
> When you finish approving the permissions, come back here — I'll verify everything works.

Then ask with `AskUserQuestion`:

- **question:** "Ready for the last browser step?"
- **header:** "Permissions"
- **options:**
  - label: "Yes, open it" — description: "Opens Google's permissions page so you can approve what YouCoded can access."
  - label: "Cancel setup" — description: "Stops here. You can run /google-services-setup again whenever you're ready."

If the user picks "Cancel setup", abort with the same copy as Step 2. Otherwise proceed to Step 5.

## Step 5 — Grant permissions

Parse the client id and secret from the normalized credentials file, then run `gws auth setup`:

```bash
CLIENT_ID=$(python -c "import json; print(json.load(open('$YOUCODED_OUTPUT_DIR/oauth-credentials.json'))['installed']['client_id'])")
CLIENT_SECRET=$(python -c "import json; print(json.load(open('$YOUCODED_OUTPUT_DIR/oauth-credentials.json'))['installed']['client_secret'])")
gws auth setup --client-id "$CLIENT_ID" --client-secret "$CLIENT_SECRET"
```

If `gws auth setup` exits nonzero, send this in chat and abort:

> Looks like the permissions weren't fully approved. When you're ready, run /google-services-setup again — this time click **Advanced** then **Continue** on Google's warning screen, and check every permission box.

## Step 6 — Make sure it actually works

Send this in chat:

> Testing your connection...

Run `bash $PLUGIN_DIR/setup/smoke-test.sh`. If it exits 0, send this in chat:

> All set! Try asking YouCoded something like:
> • "Send an email to Mom"
> • "Find my budget spreadsheet from last week"
> • "What's on my calendar tomorrow?"

If it exits nonzero, echo the per-service error the smoke-test script printed, then send this in chat:

> Setup not yet complete. Run /google-services-setup again to retry the failing service.

Do NOT say the setup succeeded when any probe failed.

## Step 7 — Migration cleanup

Run `bash $PLUGIN_DIR/setup/migrate-legacy.sh`. Echo any `  ✓` line it emits. If it emits nothing, say nothing.

---

## Throughout all steps

**User-facing language only.** Never surface "API," "gws," "gcloud," "OAuth," "scope," "PATH," "terminal," "shell," "directory," "credentials," "JSON" (when referring to the file — "connection key" is fine), "Press Enter," or similar technical terms in messages to the user. The scripts themselves may use these terms in debug output; that's fine — just don't surface that debug output as chat.

**Everything the user reads is regular chat.** Fenced code blocks (```) in this command are exclusively for bash commands that you run. Never wrap user-visible copy in a fence. Never let script output be shown as a tool-output pane if you can echo it as chat — when a script prints a `  ✓` line or a user-facing error, echo that line as chat prose.

**Confirmations go through `AskUserQuestion`, not "Press Enter."** YouCoded is a chat UI, not a terminal — there is no stdin for the user to hit Enter against. Every explicit user-gate in this command specifies an `AskUserQuestion` invocation; use it exactly as written. Only free-text inputs (like an unknown filesystem path) are collected via a normal chat prompt.

**Do not narrate between steps.** Do not emit any chat text that is not either:
- specified as user-facing copy in this command, or
- printed by a script you just invoked.

No status updates ("OS check passed," "Now moving to Step 3," "Finding the plugin directory"), no tool-call summaries, no step introductions beyond what is specified. If a script succeeds silently, say nothing — just proceed to the next step.

**If a script exits nonzero**, echo exactly what the script printed (no paraphrase, no additions) plus any abort copy specified for that step. Do not invent replacement guidance — if something isn't handled here, that's a bug to report back.

---
description: "Set up Google Services (Gmail, Drive, Docs, Sheets, Slides, Calendar) with one command. Installs helper tools, connects your Google account, and verifies each service works."
---

Run the Google Services setup. Follow the steps below in order.

## How to talk to the user

Behind the scenes, this setup runs small helpers that do technical work. The user should never see that work — only what's happening in plain, everyday words.

**When things are going well:** one short, human sentence, or nothing at all. "Google apps are connected." "Your account is set up." Don't list what you did, don't name tools, don't show anything a helper printed.

**When something doesn't work:** give the user a brief, plain-language sense of what kind of problem it was, then offer a choice — you look into it, or they retry later. Use `AskUserQuestion`.

Pick the line that best matches where things fell apart. Never be more specific than this:

- Something about the setup itself: "The setup ran into a bug on my end."
- Installing the helpers: "The setup helpers didn't install properly."
- Signing in to Google: "I couldn't finish signing in to your Google account."
- Scaffolding the Google account: "Your Google account setup didn't finish."
- Finding the connection key: "I couldn't find the connection key you downloaded."
- Granting permissions: "Your account verification isn't working."
- Verifying the services work: "One or more Google apps didn't respond."

Then ask with `AskUserQuestion`:

- **question:** "Want me to look into it, or try again later?"
- **header:** "Setup hit a snag"
- **options:**
  - label: "Look into it" — description: "I'll investigate and try to fix it."
  - label: "Try again later" — description: "You can run /google-services-setup again whenever you're ready."

If the user picks **Look into it**: drop out of these scripted instructions and debug the problem as you normally would. You have the helpers' full output from the last run.

If the user picks **Try again later**: send "Okay — just run /google-services-setup when you're ready," and stop.

### Words to never say to the user

Any helper's name, API, Google Cloud, OAuth, scope, permission scope, helper, library, file, folder, command, script, code, error, output, exit, path, terminal, shell, directory, credentials, JSON, Press Enter.

### Words that are fine

"Google apps," "your account," "your connection," "your setup," Gmail, Drive, Docs, Sheets, Slides, Calendar, "sign in," "permission," "all set," "let's try that again."

### Gates between steps

Every gate between steps uses `AskUserQuestion`, never a "Press Enter" prompt. YouCoded is a chat — the user can't press Enter at a terminal. Free-text input (pasting a file path) is the only exception; those use a regular chat prompt.

### Ask-Claude, don't narrate

Between steps, don't narrate what you're about to do or what just finished ("OS check passed," "moving to Step 3," etc.). The user sees only what's specified as user-facing copy in this command.

---

## Step 0 — System check

Send this in chat:

> Getting Google apps ready for YouCoded...

Detect the user's system with `uname -s`. If it isn't Darwin, Linux, or one of MINGW*/MSYS*/CYGWIN*, send this and stop:

> Sorry — Google Services setup doesn't support your system yet.

Silently set up the session (emit nothing in chat):

```bash
export PATH="$HOME/.youcoded/bin:$PATH"
export YOUCODED_OUTPUT_DIR="$HOME/.youcoded/google-services"
```

## Step 1 — Get the helpers ready

Run:

```bash
bash $CLAUDE_PLUGIN_ROOT/setup/install-gcloud.sh
bash $CLAUDE_PLUGIN_ROOT/setup/install-gws.sh
```

Each helper may ask the user a yes/no install question. When it does, relay the question through `AskUserQuestion` in plain words.

On success, continue to Step 2 without sending anything to the user.

If either doesn't finish, use the failure flow: say "The setup helpers didn't install properly," then offer the retry/investigate choice.

## Step 2 — First sign-in

Send this in chat:

> Next, I'll open your browser so you can sign in to Google. Pick your personal Google account when the page loads. I'll take it from there once you finish on Google's side.

Ask with `AskUserQuestion`:

- **question:** "Ready to sign in to Google?"
- **header:** "Sign in"
- **options:**
  - label: "Yes, open Google" — description: "Opens your browser so you can sign in to your Google account."
  - label: "Cancel setup" — description: "Stops here. You can run /google-services-setup again whenever you're ready."

If the user picks "Cancel setup," send this and stop:

> No problem — run /google-services-setup again whenever you're ready.

Otherwise run `gcloud auth login`. On success, continue to Step 3.

If sign-in doesn't finish, use the failure flow: say "I couldn't finish signing in to your Google account."

## Step 3 — Setting it up

### Step 3A — Scaffold your Google account

Send this in chat:

> Setting things up on your Google account — this takes about a minute.

Run:

```bash
bash $CLAUDE_PLUGIN_ROOT/setup/bootstrap-gcp.sh
```

This helper unlocks the six Google apps one at a time. As each one lands, tell the user in one short sentence — for example, "Gmail is ready," "Drive is ready." Keep it calm and paced; don't dump them all at once.

On success, source the result silently so later steps can use it:

```bash
source "$YOUCODED_OUTPUT_DIR/project.env"
```

If this helper doesn't finish, use the failure flow: say "Your Google account setup didn't finish."

Then send this in chat:

> Now I need you to set up three short pages inside Google's control panel. Each opens in your browser, takes a minute, and then you come back here and let me know.

Ask with `AskUserQuestion`:

- **question:** "Ready to set up the three Google pages?"
- **header:** "Continue"
- **options:**
  - label: "Yes, let's go" — description: "I'll walk you through each page one at a time."
  - label: "Pause for now" — description: "Stops here. Progress is saved; running /google-services-setup again will pick up where we left off."

If the user picks "Pause for now," stop silently. Otherwise continue to 3B.

### Step 3B — Configure the consent screen

Send this in chat:

> **Page 1 of 3 — the consent screen.** This is a short form Google requires so your account knows you're connecting it to YouCoded.
>
> I'll open the page in your browser. If it asks you to **Get started**, click that first. Then walk through these pages in order:
>
> 1. **App Information** — App name: type **YouCoded**. User support email: pick your email from the dropdown. Click **Next**.
> 2. **Audience** — pick **External**. Click **Next**.
> 3. **Contact Information** — in the "Email addresses" box, type the same email you're signing in with. Click **Next**.
> 4. **Finish** — check the box next to "I agree to the Google API Services: User Data Policy," then click **Continue**.
> 5. Click **Create**.
>
> When you're back at the overview page, come back here and let me know.

Open the page:

```bash
bash $CLAUDE_PLUGIN_ROOT/setup/open-browser.sh "https://console.cloud.google.com/auth/overview?project=$PROJECT_ID"
```

Ask with `AskUserQuestion`:

- **question:** "Did the consent screen save successfully?"
- **header:** "Consent screen"
- **options:**
  - label: "Done, continue" — description: "I'll open the next page."
  - label: "I hit a problem" — description: "Tell me what happened and I'll help sort it out."

If the user picks "I hit a problem" or otherwise describes trouble, ask what went wrong in plain language, help them through it, then re-ask the question. If they abandon, use the failure flow with "Your Google account setup didn't finish."

Otherwise continue to 3C.

### Step 3C — Add yourself as a test user

Send this in chat:

> **Page 2 of 3 — add yourself as a test user.** Google requires everyone using a new app to be on a test-users list while the app is in its warmup period. You're adding yourself.
>
> I'll open the test-users page. You might see some warnings near the top about "Testing" status or user caps — those are normal, just ignore them.
>
> 1. **Scroll all the way to the bottom of the page.**
> 2. Find the section titled **Test users** and click the blue **+ Add users** button.
> 3. Type your own Gmail address (the same one you signed in with earlier) in the box that appears.
> 4. Click **Save**.
> 5. You might see a popup titled **"Ineligible accounts not added"** — this is a Google bug; **ignore it**. As long as your email appears in the list below (with a small trash-can icon next to it), you're added. Click **Close** on the popup.
>
> When you see your email in the list, come back here and let me know.

Open the page:

```bash
bash $CLAUDE_PLUGIN_ROOT/setup/open-browser.sh "https://console.cloud.google.com/auth/audience?project=$PROJECT_ID"
```

Ask with `AskUserQuestion`:

- **question:** "Did you add yourself as a test user?"
- **header:** "Test user"
- **options:**
  - label: "Done, continue" — description: "I'll open the last page."
  - label: "I hit a problem" — description: "Tell me what happened and I'll help sort it out."

Handle "I hit a problem" the same way as 3B. Otherwise continue to 3D.

### Step 3D — Create the connection key

Send this in chat:

> **Page 3 of 3 — create the connection key.** This is the actual key YouCoded uses to talk to your Google account. You'll download it as a small file.
>
> I'll open the Credentials page.
>
> 1. Click **+ Create Credentials** at the top, then choose **OAuth client ID**.
> 2. **Application type:** pick **Desktop app**.
> 3. **Name:** the field is pre-filled with something like "Desktop client 1." This is just a label for your own reference — nobody else ever sees it. Change it to **YouCoded** so it's easy to recognize later.
> 4. Click **Create**.
> 5. A popup titled **"OAuth client created"** appears with some long codes and a yellow warning — don't worry about any of that. Just click the **Download JSON** button at the bottom-left of the popup. The file saves to your Downloads folder.
> 6. Click **OK** to close the popup.
>
> Once the file has downloaded, come back here and let me know. I'll find it automatically.

Open the page:

```bash
bash $CLAUDE_PLUGIN_ROOT/setup/open-browser.sh "https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID"
```

Ask with `AskUserQuestion`:

- **question:** "Did the file download?"
- **header:** "Downloaded"
- **options:**
  - label: "Yes, it downloaded" — description: "I'll find it in your Downloads folder and use it automatically."
  - label: "I hit a problem" — description: "Tell me what happened and I'll help sort it out."

Handle "I hit a problem" the same way as 3B. Otherwise continue to 3E.

### Step 3E — Read the downloaded file

Run:

```bash
bash $CLAUDE_PLUGIN_ROOT/setup/ingest-oauth-json.sh
```

On success, send this and continue to Step 4:

> Got your connection key.

If the helper can't find the file, send this in chat:

> If you saved the file somewhere other than Downloads, paste the full path here and I'll use that instead.

Wait for the user's next chat reply, take it as the path, and re-run:

```bash
bash $CLAUDE_PLUGIN_ROOT/setup/ingest-oauth-json.sh "<the path the user pasted>"
```

Try up to 3 times. If all 3 tries fail, use the failure flow: say "I couldn't find the connection key you downloaded."

## Step 4 — Before the last browser step

Send this in chat:

> Heads up: in a moment Google will show you a screen that says "Google hasn't verified this app."
>
> This is expected and safe. The "app" is you — YouCoded just set up a private connection inside your own Google account, and now you're giving yourself permission to use it.
>
> When you see the warning page, click **Continue**.
>
> After that, Google will show one more page asking which permissions to grant. **Please check every box** — any unchecked permission means some features won't work.
>
> When you finish approving the permissions, come back here — I'll verify everything works.

Ask with `AskUserQuestion`:

- **question:** "Ready for the last browser step?"
- **header:** "Permissions"
- **options:**
  - label: "Yes, open it" — description: "Opens Google's permissions page so you can approve what YouCoded can access."
  - label: "Cancel setup" — description: "Stops here. You can run /google-services-setup again whenever you're ready."

If the user picks "Cancel setup," send the same stop copy as Step 2. Otherwise continue to Step 5.

## Step 5 — Grant permissions

Run `gws auth login`. It prints the consent URL to stdout on a line starting with two spaces, then waits for the browser callback. Grab the URL, open it for the user, and let gws finish.

```bash
gws auth login > "$YOUCODED_OUTPUT_DIR/gws-auth.log" 2>&1 &
GWS_PID=$!
# Wait up to 10s for the URL to appear, then open it in the user's browser.
for _ in $(seq 1 100); do
  URL=$(grep -m1 "^  https://accounts.google.com" "$YOUCODED_OUTPUT_DIR/gws-auth.log" 2>/dev/null | sed 's/^  //')
  [ -n "$URL" ] && break
  sleep 0.1
done
if [ -z "$URL" ]; then
  kill "$GWS_PID" 2>/dev/null
  exit 1
fi
bash "$CLAUDE_PLUGIN_ROOT/setup/open-browser.sh" "$URL"
wait "$GWS_PID"
```

On success, continue to Step 6.

If `gws auth login` doesn't finish (nonzero exit or never prints a URL), use the failure flow: say "Your account verification isn't working."

## Step 6 — Make sure it actually works

Send this in chat:

> Testing your connection...

Run:

```bash
bash $CLAUDE_PLUGIN_ROOT/setup/smoke-test.sh
```

This helper checks each of the six Google apps. Watch the results.

If every app responds, send this in chat:

> All set! Try asking YouCoded something like:
> • "Send an email to Mom"
> • "Find my budget spreadsheet from last week"
> • "What's on my calendar tomorrow?"

If one or more apps don't respond, use the failure flow: say "One or more Google apps didn't respond." **Do not** tell the user setup succeeded when any app failed.

## Step 7 — Clean up old connections

This step runs only after Step 6 reports every app responding.

Run:

```bash
bash $CLAUDE_PLUGIN_ROOT/setup/migrate-legacy.sh
```

If it finds anything to clean up, say so in one plain sentence: "Cleared out the old Google connection." If it finds nothing, say nothing.

If this helper has trouble, use the failure flow: say "The setup ran into a bug on my end." Setup itself is already done at this point, so the failure is cosmetic — but still let the user decide how to handle it.

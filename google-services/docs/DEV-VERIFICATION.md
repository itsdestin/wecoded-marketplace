# Dev-time Verification

This checklist runs on a clean test machine before `google-services` is allowed to ship. NOT shipped to users — lives here only for our pre-ship gate.

- [ ] `/google-services-setup` completes end-to-end on macOS, Windows, Linux with no pre-existing `gcloud` or `gws` installed.
- [ ] Idempotent re-run with existing valid auth reports "already set up" and skips to probes.
- [ ] Partial-state re-run (re-run after bootstrap-gcp.sh but before Steps 3B–3E complete) detects existing project, skips project creation, resumes at the consent screen page.
- [ ] Copy fidelity: every user-visible message in /google-services-setup renders as chat prose (never a code block or tool-output pane). No "gws," "gcloud," "PATH," "terminal," "scope," "directory," "credentials file," or "Press Enter" surfaces to the user.
- [ ] Per-substep browser flow: each of Steps 3B/3C/3D opens exactly one Cloud Console page and gates progression on an `AskUserQuestion` call (not a chat-text "Press Enter" prompt). The question renders as a clickable prompt in the YouCoded UI; picking "Done, continue" advances, picking "I hit a problem" triggers the troubleshooting path.
- [ ] Cancel paths: picking "Cancel setup" at Step 2 or Step 4, or "Pause for now" at the 3A→3B handoff, aborts cleanly with the documented copy and no further browser-opens or script runs.
- [ ] Credentials ingest: saving client_secret_*.json to ~/Downloads and pressing Enter in Step 3E finds the file automatically; saving it elsewhere and pasting the path in response to the fallback prompt also works. Malformed files (non-JSON, wrong shape, missing fields) surface a clear error to the user.
- [ ] Gmail round-trip: send draft to self → fetch → delete. Leaves no residue.
- [ ] Drive round-trip: upload → list → download → trash.
- [ ] Docs round-trip: create → read → trash.
- [ ] Sheets round-trip: create → write A1 → read A1 → trash.
- [ ] Slides round-trip: create deck → batchUpdate to add a slide with text → get → `drive files export` to PDF → trash.
- [ ] Calendar round-trip: create event → list → delete.
- [ ] Migration: test machine with pre-installed `youcoded-drive` + `claudes-inbox` on hosted Gmail — setup cleans all artifacts.
- [ ] Skill discovery: compound prompts ("send an email with last week's budget sheet attached") route cleanly to one primary skill.
- [ ] Auto-reauth end-to-end: revoke the OAuth token manually (or wait for natural 7-day expiry), ask Claude a Google-related question, verify Claude detects AUTH_EXPIRED signal from the wrapper, runs reauth.sh, completes the user's request after the one-click browser consent — without any manual slash command from the user.

---

## Multi-account verification (2026-04-29)

Six smoke tests added with multi-account support. Run after any change to the registry library, add/remove/reauth scripts, or the gws-shared protocol.

### 1. Single-account regression smoke

Goal: verify the new env-var routing + `KEYRING_BACKEND=file` change doesn't break existing single-account installs.

```bash
# Pre: a working single-account setup at ~/.config/gws/.
GWS_CONFIG_DIR="$HOME/.config/gws" bash google-services/setup/smoke-test.sh
```

Expected: all 6 ✓ outputs, exit 0. Same as pre-multi-account behavior.

### 2. Two-account fast-path smoke

```bash
# 1. Pre: existing setup. Run /google-services-setup → pick "Add another account."
# 2. Use a second personal Gmail you've already added to Test Users.
# 3. After completion, verify:
test -d "$HOME/.config/gws-second"
test -f "$HOME/.config/gws-profiles.json"
jq '.accounts | length' "$HOME/.config/gws-profiles.json"  # → 2
GWS_CONFIG_DIR="$HOME/.config/gws-second" bash google-services/setup/smoke-test.sh  # → all ✓
```

### 3. Two-account slow-path smoke

Same as #2 but with a deliberately-locked-down Workspace account that rejects the existing OAuth client. add-account.sh should exit 2 on fast-path; the slash command falls back to slow-path. Verify the account ends up with `ownsGcpProject: true` in the registry, and that a separate GCP project was created.

### 4. First-action confirmation smoke

```bash
# Pre: registry has 2+ accounts, one default.
# In a fresh chat conversation, ask Claude: "send a quick test email to myself"
# Expected: Claude asks "Okay to send this from your <default> account, or use <other>?"
# Choose <other>. Claude sends the email from <other>'s account.
```

### 5. Drive-always-confirm smoke

```bash
# Same conversation as #4 — Claude has now established <other> as the active account.
# Ask: "Find my budget spreadsheet"
# Expected: Claude RE-confirms: "Did you want to search your <default> Drive or your <other> Drive?"
# Even though Gmail just used <other>.
```

### 6. Reauth + opportunistic top-up smoke

```bash
# Pre: 2 accounts, one of them has a stale token (wait 7 days, or revoke at https://myaccount.google.com/permissions).
# Trigger any gws-* skill against the stale account.
# Expected:
# - Claude says "Your <name> connection needs a quick refresh — opening your browser"
# - After successful refresh, IF other accounts also have stale tokens:
#   "Refreshed your <name>. Your <other> connection is also expired — refresh that too?"
# - On "Yes," reauth runs against <other> too.
# - Original failing call is retried successfully.
```

### Keyring migration outcome (record once, on the implementer's machine)

When KEYRING_BACKEND=file is first applied to an existing single-account install whose AES key is currently in Windows Credential Manager / macOS Keychain / Linux Secret Service, what happens on the first gws call?

- [ ] **Outcome A** (silent migration): `gws auth status` succeeds; gws transparently fell back to the OS keyring for the AES key, with the file getting written on the next `auth login`.
- [ ] **Outcome B** (forced reauth on upgrade): `gws auth status` reports a decryption failure or empty state; the user reauths once and the file is populated.

Date verified: ____________
Outcome: ______
Notes: ____________

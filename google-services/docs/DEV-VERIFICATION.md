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

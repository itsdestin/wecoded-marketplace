# DEV-VERIFICATION.md

Human round-trip checklist. Run before tagging each release. NOT shipped to users — this directory is gitignored.

Estimated time: 2-3 hours concentrated on a real Mac (14+) with real Apple accounts populated.

## Section A — Fresh install

- [ ] `tccutil reset All` to wipe TCC state
- [ ] Remove `~/.apple-services/bin/` to force re-copy
- [ ] Start the app where Claude runs (Terminal, iTerm, YouCoded desktop)
- [ ] Run `/apple-services-setup`
- [ ] Verify Step 1 passes platform + version checks
- [ ] Verify Step 2 copies binary, reports `OK_INSTALLED`
- [ ] Verify Step 3 finds iCloud Drive
- [ ] Verify Step 4 pops 3 dialogs in order (Calendar → Reminders → Contacts); click Allow on each
- [ ] Verify Step 5 pops 2 dialogs (Notes → Mail); click OK on each
- [ ] Verify Step 6 prints PASS for all 6 probes
- [ ] Verify Step 7 summary is coherent + example prompts make sense
- [ ] **Idempotency:** re-run `/apple-services-setup`. Expect zero dialogs, all PASS.

## Section B — Per-integration CRUD round-trip

For each of the six integrations, confirm CRUD via chat and verify in the respective Apple app:

- [ ] **Calendar:** ask "create a calendar event tomorrow at 2pm called 'Test'" → verify in Calendar.app → ask to delete → verify gone
- [ ] **Reminders:** ask "remind me in 1 hour to test reminders" → verify in Reminders.app → complete via chat → verify checked
- [ ] **Contacts:** ask "create a contact named Test Person with email test@example.com" → verify in Contacts.app → ask to delete → verify gone
- [ ] **Notes:** ask "create a note titled Test with body 'hello'" → verify in Notes.app → ask to append 'world' → verify body is "hello\nworld" → delete → verify gone
- [ ] **Mail:** ask "draft an email to myself with subject Test" → verify in Mail Drafts → send → verify received → delete
- [ ] **iCloud Drive:** ask "save 'hi' to a file called test.txt at iCloud root" → verify in Finder → ask to delete → verify gone

## Section C — Permission denial recovery

For each TCC grant:

- [ ] Revoke in System Settings
- [ ] Make a chat request that hits that integration
- [ ] Verify error surfaces with correct `TCC_DENIED:<service>` code
- [ ] Verify Claude's recovery copy matches what this plan specifies
- [ ] Re-grant via `/apple-services-setup` or directly in System Settings
- [ ] Verify operation resumes

## Section D — Binary-update behavior (addresses R3)

- [ ] Install v1 helper, grant all 5 TCC permissions
- [ ] Replace `~/.apple-services/bin/apple-helper` with a v0.1.0+1 build (same ad-hoc signing)
- [ ] Run any calendar op
- [ ] Record: did macOS re-prompt? If yes, this becomes documented friction in release notes.

## Section E — Edge cases

- [ ] iCloud `.icloud` placeholder: force-eject a file from a Mac (Finder → right-click → Remove Download), list the dir, verify `type: "placeholder"` appears
- [ ] Mail.app first-run: quit Mail, deactivate all accounts, re-run `/apple-services-setup` — verify helpful "Mail isn't fully set up yet" message
- [ ] Unicode names: create a contact "François" and search for "fran"
- [ ] Empty iCloud root: temporarily rename everything out of iCloud root, list, verify empty array returns cleanly
- [ ] Locked TCC: wrapper should surface `TCC_DENIED` clearly when a user has disabled a grant

## Section F — Coexistence with youcoded-inbox

- [ ] Install both youcoded-inbox and apple-services
- [ ] Run the inbox's daily check — verify it still works with its apple-notes/apple-reminders providers
- [ ] Use apple-services skills — verify they work independently
- [ ] Confirm neither corrupts the other's state

## Sign-off

- [ ] All sections passed, OR deviations documented in the release PR description
- [ ] `docs/knowledge-debt.md` updated with any drift found
- [ ] Ready to tag

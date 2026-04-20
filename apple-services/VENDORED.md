# VENDORED.md

Provenance for files pulled from third-party sources. Updated on every vendor refresh.

Per Phase 0 findings, most of this plugin is original code. The only meaningfully-vendored files are AppleScript extracts from `supermemoryai/apple-mcp` (MIT). The `bin/apple-helper` binary is original code in the sibling `itsdestin/apple-helper` repo — see that repo's `NOTICE.md` for references. iMCP informed the Swift helper but is not vendored byte-for-byte, so it doesn't appear below.

| File | Source | Upstream reference | SHA | License | Last pulled |
|---|---|---|---|---|---|
| `applescript/notes/create_note.applescript` | supermemoryai/apple-mcp | `utils/notes.ts` (createNote block) | 08e2c53 | MIT | 2026-04-17 |
| `applescript/notes/*` (all others) | mostly original; reference patterns | `utils/notes.ts` | 08e2c53 | MIT | 2026-04-17 |
| `applescript/mail/send.applescript` | supermemoryai/apple-mcp | `utils/mail.ts` (sendMail block) | 08e2c53 | MIT | 2026-04-17 |
| `applescript/mail/list_mailboxes.jxa` | supermemoryai/apple-mcp | `utils/mail.ts` (getMailboxesForAccount pattern) | 08e2c53 | MIT | 2026-04-17 |
| `applescript/mail/*` (all others) | mostly original; reference patterns | `utils/mail.ts` | 08e2c53 | MIT | 2026-04-17 |

**Re-pull procedure:** when updating from upstream, change the SHA column + `Last pulled` date. No automated drift-check yet. For now, review upstream manually when refreshing.

# Gmail Provider

**Platform:** all

Reads emails from a configured Gmail label. Intended for self-emails and forwarded items captured from mobile.

Uses the `gws` CLI from the `google-services` bundle. Auth is managed by `/google-services-setup`.

## Configuration

Reads `inbox_provider_config.gmail.label` from `~/.claude/toolkit-state/config.json`. Default label: `"Claude Inbox"`.

## Setup Requirements

The `google-services` plugin must be installed and `/google-services-setup` must have been completed so that `gws auth status` returns authenticated. Additionally, the user should create a Gmail filter that auto-labels self-sent emails (from yourself to yourself) with the configured label. The inbox setup wizard guides this configuration.

Before invoking any gws command, source the shared wrapper:

```bash
source "$CLAUDE_PLUGIN_ROOT/lib/gws-wrapper.sh"
```

(If `$CLAUDE_PLUGIN_ROOT` is not set in this context — e.g., the inbox skill is not being invoked from the google-services plugin — source it from its installed location: `~/.claude/plugins/marketplaces/youcoded/plugins/google-services/lib/gws-wrapper.sh`.)

All gws invocations below assume the wrapper is sourced and use `gws_run` (never `gws` directly). If `gws_run` exits 2, that signals `AUTH_EXPIRED`; skip this provider and report it as unavailable for this run.

## List

1. Call `gws_run gmail list` with a Gmail search query that filters to the configured label and excludes already-handled messages:

   ```bash
   gws_run gmail list --max 50 --query "label:<configured_label> -label:Claude-Processed -label:Claude-Presented"
   ```

   The `-label` exclusions filter out messages already handled in prior runs.

2. If the call fails (non-zero exit, `gws` unavailable, label not found, or exit 2 AUTH_EXPIRED), skip this provider and report it as unavailable.

3. Return messages sorted by `internalDate`, newest first.

## Read

For each message ID from the List step:

1. Call `gws_run gmail read <message-id>`.
2. Extract:
   - **Title:** subject line
   - **Content:** body text (prefer the plaintext body returned by `gws gmail read`; fall back to the HTML body with tags stripped)
   - **Timestamp:** `internalDate` field
   - **Attachments:** note any attachment names found in the message. Do not attempt to download attachments — binary downloads through the provider pipeline are unreliable. Note each as `"has Gmail attachment: <filename> (not downloaded)"`.

## Mark Processed

Apply the `"Claude-Processed"` label to the message:

```bash
gws_run gmail label add <message-id> Claude-Processed
```

If that label does not exist in the user's Gmail account (command fails with a label-not-found error), archive the message instead by removing the Inbox label:

```bash
gws_run gmail label remove <message-id> INBOX
```

The `List` query excludes `Claude-Processed` messages, so this acts as a permanent "done" marker.

## Mark Presented

Apply the `"Claude-Presented"` label to the message:

```bash
gws_run gmail label add <message-id> Claude-Presented
```

The `List` query excludes `Claude-Presented` messages, so this prevents re-presentation on subsequent same-day runs. When the item is later resolved, remove `Claude-Presented` and add `Claude-Processed`:

```bash
gws_run gmail label remove <message-id> Claude-Presented
gws_run gmail label add <message-id> Claude-Processed
```

## Notes

- The `Claude-Processed` and `Claude-Presented` labels must exist in the user's Gmail account for label-based marking to work. If they do not exist, the skill should note this and fall back to archiving for processed items and skipping the presentation guard for presented items.
- All Gmail operations route through `gws_run`, which emits `AUTH_EXPIRED:gmail` on stderr and exits 2 when the user's 7-day OAuth refresh has lapsed. The inbox skill treats this as "provider unavailable for this run" — the user will be prompted to re-auth via `google-services` the next time they invoke a Gmail-bundle skill directly.

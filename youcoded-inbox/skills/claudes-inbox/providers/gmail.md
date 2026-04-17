# Gmail Provider

**Platform:** all

Reads emails from a configured Gmail label. Intended for self-emails and forwarded items captured from mobile.

Uses the `gws` CLI from the `google-services` bundle. Auth is managed by `/google-services-setup`.

## Configuration

Reads `inbox_provider_config.gmail.label` from `~/.claude/toolkit-state/config.json`. Default label: `"Claude Inbox"`.

## Setup Requirements

The `google-services` plugin must be installed and `/google-services-setup` must have been completed so that `gws auth status` reports `"token_valid": true`. The user should also create a Gmail filter that auto-labels self-sent emails (from yourself to yourself) with the configured label. The inbox setup wizard guides this configuration.

## Auth errors

Every command below may fail with an auth error if the user's 7-day OAuth refresh has lapsed. When that happens (signals: `invalid_grant`, `invalid_token`, `token has been expired or revoked`, `"code": 401`), the `youcoded-gws-reauth` skill handles recovery automatically — run `$CLAUDE_PLUGIN_ROOT/setup/reauth.sh`, then retry the command. If reauth itself fails, treat this provider as unavailable for this run and note that the user should run `/google-services-setup`.

## List

Call `gws gmail users messages list` with a Gmail search query that filters to the configured label and excludes already-handled messages:

```bash
gws gmail users messages list --params '{
  "userId": "me",
  "q": "label:<configured_label> -label:Claude-Processed -label:Claude-Presented",
  "maxResults": 50
}'
```

The `-label` exclusions filter out messages already handled in prior runs. Returns messages sorted by `internalDate`, newest first.

If the call fails (non-zero exit, `gws` unavailable, label not found), skip this provider and report it as unavailable.

## Read

For each message ID from the List step, use the `+read` helper — it extracts body + headers cleanly without having to decode base64url payloads yourself:

```bash
gws gmail +read --id <message-id>
```

Extract:
- **Title:** subject line
- **Content:** body text (prefer plaintext; fall back to HTML body with tags stripped)
- **Timestamp:** `internalDate` field
- **Attachments:** note any attachment names found in the message. Do not attempt to download attachments — binary downloads through the provider pipeline are unreliable. Note each as `"has Gmail attachment: <filename> (not downloaded)"`.

## Mark Processed

Apply the `"Claude-Processed"` label to the message. Gmail's API takes label IDs, not names — resolve the name first if you haven't cached it:

```bash
LABEL_ID=$(gws gmail users labels list --params '{"userId":"me"}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); \
    print(next((l['id'] for l in d.get('labels',[]) if l['name']=='Claude-Processed'),''))")

gws gmail users messages modify \
  --params '{"userId":"me","id":"<message-id>"}' \
  --json "{\"addLabelIds\":[\"$LABEL_ID\"]}"
```

If the `Claude-Processed` label does not exist in the user's Gmail account (label lookup returns empty), archive the message instead by removing the `INBOX` label:

```bash
gws gmail users messages modify \
  --params '{"userId":"me","id":"<message-id>"}' \
  --json '{"removeLabelIds":["INBOX"]}'
```

The `List` query excludes `Claude-Processed` messages, so this acts as a permanent "done" marker.

## Mark Presented

Apply the `"Claude-Presented"` label the same way, resolving the name to an ID first. The `List` query excludes `Claude-Presented` messages, so this prevents re-presentation on subsequent same-day runs.

When the item is later resolved, remove `Claude-Presented` and add `Claude-Processed` in a single `modify` call:

```bash
gws gmail users messages modify \
  --params '{"userId":"me","id":"<message-id>"}' \
  --json "{\"addLabelIds\":[\"$PROCESSED_ID\"],\"removeLabelIds\":[\"$PRESENTED_ID\"]}"
```

## Notes

- The `Claude-Processed` and `Claude-Presented` labels must exist in the user's Gmail account for label-based marking to work. If they do not exist, the skill should note this and fall back to archiving for processed items and skipping the presentation guard for presented items.
- Auth errors are recovered transparently by the `youcoded-gws-reauth` skill — the inbox does not need to handle them itself.

---
name: gws-transfer
description: "Use when the user wants to copy or move content between two of their connected Google accounts — phrases like 'copy this work doc to my personal Drive', 'save this email to my personal account', 'duplicate this work calendar event to personal', 'move that file to my personal Drive'. Handles cross-account transfer of Drive files/folders, Gmail messages, and Calendar events. v1 is copy-only (no source-side delete)."
metadata:
  openclaw:
    category: "productivity"
    requires:
      bins:
        - gws
---

# Cross-account transfer

> **PREREQUISITE:** Read `../gws-shared/SKILL.md` for auth, global flags, and the **account selection** routing protocol. This skill diverges from the standard protocol — for transfers, both source and destination are explicit, not inferred from conversation memory.

Copy a Google resource from one of the user's connected Google accounts into another. v1 supports Drive files, Drive folders, Gmail messages/threads, and Calendar events.

## Universal confirmation pattern

ALWAYS confirm both source and destination explicitly before any transfer:

> "Copying [resource description] from your **[source-name]** [service] to your **[dest-name]** [service]. Confirm?"

Both account names are bolded for visual disambiguation. Do NOT assume the conversation's active account is the destination — for transfers, both ends are always explicit.

## Drive — file or folder copy

For a single Drive file:

```bash
SRC_DIR="<source account configDir from registry>"
DST_DIR="<dest account configDir from registry>"
FILE_ID="<source file ID>"
TEMP="$(mktemp)"

# 1. Read source file metadata to get name and mimeType
META="$(GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$SRC_DIR" \
        GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file \
        gws drive files get --params "{\"fileId\":\"$FILE_ID\",\"fields\":\"id,name,mimeType\"}")"
NAME="$(echo "$META" | jq -r '.name')"
MIME="$(echo "$META" | jq -r '.mimeType')"

# 2. Download. Native Google types (Docs/Sheets/Slides) need files.export.
case "$MIME" in
  application/vnd.google-apps.document)
    GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$SRC_DIR" GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file \
      gws drive files export -o "$TEMP" \
      --params "{\"fileId\":\"$FILE_ID\",\"mimeType\":\"application/vnd.openxmlformats-officedocument.wordprocessingml.document\"}"
    UPLOAD_MIME="application/vnd.google-apps.document"  # re-imports as Doc
    ;;
  application/vnd.google-apps.spreadsheet)
    GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$SRC_DIR" GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file \
      gws drive files export -o "$TEMP" \
      --params "{\"fileId\":\"$FILE_ID\",\"mimeType\":\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\"}"
    UPLOAD_MIME="application/vnd.google-apps.spreadsheet"
    ;;
  application/vnd.google-apps.presentation)
    GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$SRC_DIR" GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file \
      gws drive files export -o "$TEMP" \
      --params "{\"fileId\":\"$FILE_ID\",\"mimeType\":\"application/vnd.openxmlformats-officedocument.presentationml.presentation\"}"
    UPLOAD_MIME="application/vnd.google-apps.presentation"
    ;;
  *)
    GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$SRC_DIR" GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file \
      gws drive files get -o "$TEMP" --params "{\"fileId\":\"$FILE_ID\",\"alt\":\"media\"}"
    UPLOAD_MIME="$MIME"
    ;;
esac

# 3. Upload to destination
GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$DST_DIR" GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file \
  gws drive files create --upload "$TEMP" \
  --json "{\"name\":\"$NAME\"}" \
  --upload-content-type "$UPLOAD_MIME"

# 4. Cleanup
rm -f "$TEMP"
```

For a folder, recurse: list the folder's children with `gws drive files list --params '{"q":"\\"<FOLDER_ID>\\" in parents"}' --page-all`, create a new folder in destination with `mimeType=application/vnd.google-apps.folder`, then copy each child into it. Stream progress to the user: "Copied 12 of 47 files…"

## Gmail — save a message or thread to another account

```bash
SRC_DIR="<source account configDir>"
DST_DIR="<dest account configDir>"
MSG_ID="<source message ID>"

# Get the raw RFC 822 message bytes from source
RAW="$(GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$SRC_DIR" GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file \
  gws gmail users messages get --params "{\"userId\":\"me\",\"id\":\"$MSG_ID\",\"format\":\"raw\"}" \
  | jq -r '.raw')"

# Insert into destination's mailbox without going through SMTP delivery
GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$DST_DIR" GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file \
  gws gmail users messages insert --params "{\"userId\":\"me\"}" \
  --json "{\"raw\":\"$RAW\"}"
```

For a whole thread, get the thread first (`gws gmail users threads get`), iterate over `.messages[]`, and insert each one into the destination. The destination's Gmail will not group them as a single thread automatically (different RFC References / Message-IDs); this is a known limitation.

Tell the user upfront: "Labels won't carry over (different label IDs across accounts). Want me to apply a target label like 'from-work' on the imported message?" If yes, run `gws gmail users labels create` (idempotent) then `gws gmail users messages modify` to apply it.

## Calendar — copy an event

```bash
SRC_DIR="<source account configDir>"
DST_DIR="<dest account configDir>"
EVENT_ID="<source event ID>"
SRC_CAL="${SRC_CAL:-primary}"
DST_CAL="${DST_CAL:-primary}"

# Get source event
EVENT="$(GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$SRC_DIR" GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file \
  gws calendar events get --params "{\"calendarId\":\"$SRC_CAL\",\"eventId\":\"$EVENT_ID\"}")"

# Strip fields that don't transfer cleanly: id, organizer, attendees, conferenceData
PAYLOAD="$(echo "$EVENT" | jq 'del(.id, .iCalUID, .organizer, .attendees, .conferenceData, .htmlLink, .creator, .etag, .kind)')"

# Insert into destination
GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$DST_DIR" GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file \
  gws calendar events insert --params "{\"calendarId\":\"$DST_CAL\"}" \
  --json "$PAYLOAD"
```

Tell the user upfront: "Attendees, ACL, and the original organizer don't transfer. The event becomes a new event you own. Existing attendees won't be notified."

## Failure handling

If the source-read step fails: report and stop. No destination state changed.

If the source-read succeeds but the destination-write fails: report clearly:

> "Read from [source-name] succeeded, but writing to [dest-name] failed: [error]. Nothing was changed in your [source-name] account."

For Drive folder transfers (multi-step), report partial progress: "Copied 12 of 47 files before failing on file 13: [error]. The 12 already copied are in your [dest-name] Drive."

## Out of scope

- **Move** (copy + delete-from-source). v1 is copy-only.
- **Drive permission/share-link cloning.** Cross-account permission grants require the destination user to invite source-account collaborators by email — not a thing the skill can do silently.
- **Bulk transfer of an entire account.** Use Google Takeout instead.

## Do not

- **Do not** infer the destination from conversation memory. Both ends are always explicit, always confirmed.
- **Do not** delete from the source after successful copy. v1 is copy-only.
- **Do not** assume the user wants identical labels (Gmail) or attendees (Calendar) on the destination — surface the loss explicitly.

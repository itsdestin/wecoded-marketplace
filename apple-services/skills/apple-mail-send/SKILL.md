---
name: apple-mail-send
description: "Send an email via Apple Mail. Use when the user says 'email X', 'send a message to Y', 'reply to Z'."
---

# apple-mail-send

Compose and send email.

## Usage

```bash
apple-wrapper.sh mail send \
  --to "alice@example.com" \
  --subject "Tuesday call" \
  --body "Hi Alice, ..."
```

## Before sending

- **Always show the draft to the user and get confirmation** unless they've explicitly said to send without review.
- For replies, ask for the recipient email or use `mail search` + `mail read_message` to find the thread and quote.
- Attachments are passed as a comma-separated list of absolute paths.

## Draft instead of send

If the user says "draft X" instead of "send X", use `create_draft` — it writes to the Drafts mailbox and the user finishes sending from Mail.app.

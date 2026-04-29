---
name: gws-account-management
description: "Use when the user wants to add, remove, list, or change the default across their connected Google accounts in YouCoded. Triggers on phrases like 'add my work account', 'connect another Google account', 'remove that account', 'switch default to personal', 'use my work account by default', 'which Google accounts do I have', 'list my accounts'. Routes the request into /google-services-setup, which has a management menu when the user already has accounts set up."
metadata:
  openclaw:
    category: "productivity"
---

# Google account management (multi-account routing)

This is a thin routing skill — it doesn't do anything itself; it sends the user into `/google-services-setup`, which detects the existing registry and opens the right menu.

## When to invoke

Any phrase from the user that reads as managing their connected Google accounts (not actually using them — sending email, etc.):

- "add my work account"
- "connect another Google account"
- "remove that account"
- "remove my work connection"
- "switch default to personal"
- "use my work account as the default"
- "which accounts do I have connected"
- "show my Google accounts"

## Action

For account-listing requests ("show my Google accounts," "which accounts do I have"), answer directly:

```bash
if [ -f "$HOME/.config/gws-profiles.json" ]; then
  jq -r '
    "Default: \(.default // "none")\n\nAccounts:\n" +
    (.accounts | map("- \(.name) (\(.email))") | join("\n"))
  ' "$HOME/.config/gws-profiles.json"
else
  if [ -f "$HOME/.config/gws/credentials.enc" ]; then
    echo "You have one Google account connected."
  else
    echo "No Google accounts connected. Run /google-services-setup to set one up."
  fi
fi
```

For management requests (add / remove / change default), suggest the slash command:

> "I can run /google-services-setup — it'll open the account-management menu. Want me to?"

If the user agrees, invoke the slash command (handle as a normal slash-command-from-skill flow). Pass through the user's intent so the slash command can pre-pick the menu option:

- "add" → user picks "Add another account"
- "remove" → user picks "Remove an account"
- "default" → user picks "Change default"

## Do not

- **Do not** call `add-account.sh` or `remove-account.sh` directly from this skill. They have prerequisites (knownTestUsers state, pre-existing config dirs) that the slash command sets up. Always route through the slash command.
- **Do not** invoke `/google-services-setup` for actual *use* of an account ("send an email from work" is not management — that's a gws-gmail-send call with the account-selection protocol from gws-shared).

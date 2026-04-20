---
name: apple-contacts-find
description: "Find a contact in Apple Contacts by name, phone, email, or organization. Use when the user asks 'what's X's number', 'find X', 'email for Y'."
---

# apple-contacts-find

Fuzzy-search Contacts.

## Usage

```bash
apple-wrapper.sh contacts search --query "jenny" --limit 5
```

## Presenting results

- **1 match:** show name + the requested field (phone/email/etc.) directly.
- **2-5 matches:** list them briefly, each with a disambiguator (org, second name).
- **>5 matches:** ask the user to narrow the query.

Don't dump all fields of every match — answer the question they asked.

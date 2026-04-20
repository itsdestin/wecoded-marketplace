---
name: apple-contacts
description: "Apple Contacts: fuzzy-search, retrieve, create, and update contacts and groups. Use when the user asks for someone's phone/email, or wants to add a new contact."
metadata:
  category: "productivity"
  requires:
    bins:
      - bash
---

# apple-contacts

> **Prereq:** Run `/apple-services-setup` once to grant Contacts access.

Skills call `apple-wrapper.sh contacts <op> [args]`.

## Operations

| Op | Args | Returns |
|---|---|---|
| `search` | `--query <q> [--limit <n>]` | `[contact]` — fuzzy across name, phone, email, org |
| `get` | `--id <id>` | `contact` |
| `list_groups` | — | `[{id, name}]` |
| `list_group_members` | `--group-id <id>` | `[contact]` |
| `create` | `--first <f> [--last <l>] [--phones <p1> <p2>...] [--emails <e1> <e2>...] [--organization <o>] [--notes <n>]` | `contact` |
| `update` | `--id <id>` + any field | `contact` |
| `add_to_group` | `--contact-id <cid> --group-id <gid>` | `{ok: true}` |
| `remove_from_group` | `--contact-id <cid> --group-id <gid>` | `{ok: true}` |

## Examples

```bash
apple-wrapper.sh contacts search --query "jenny"
apple-wrapper.sh contacts create --first "Alex" --last "Smith" --emails alex@example.com
```

## Handling permission denial

`TCC_DENIED:contacts` → re-grant via `/apple-services-setup` or System Settings → Privacy & Security → Contacts → **apple-helper**.

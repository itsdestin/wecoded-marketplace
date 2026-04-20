---
name: icloud-drive
description: "iCloud Drive: list, read, write, move, and delete files in iCloud Drive. Use when the user wants to save something to iCloud, find a file, or organize their iCloud folders."
metadata:
  category: "productivity"
  requires:
    bins:
      - bash
---

# icloud-drive

> **Prereq:** iCloud Drive must be turned on in System Settings. `/apple-services-setup` verifies this.

Skills call `apple-wrapper.sh icloud <op> [args]`. No TCC grant required — operations are plain filesystem reads/writes against the iCloud Drive mount point.

## Operations

| Op | Args | Returns |
|---|---|---|
| `list` | `--path <rel> [--recursive]` | `[{name, type, size, modified}]` |
| `read` | `--path <rel>` | text content, or `{binary: true, type, size}` |
| `write` | `--path <rel> --content <str>` | `{ok: true}` |
| `delete` | `--path <rel>` | `{ok: true}` |
| `move` | `--src <rel> --dst <rel>` | `{ok: true}` |
| `create_folder` | `--path <rel>` | `{ok: true}` |
| `stat` | `--path <rel>` | `{name, type, size, modified}` |

All paths are relative to iCloud Drive root. Use `--path ""` for root.

## ⚠️ Placeholder files

Files not yet downloaded from iCloud appear with `type: "placeholder"` in `list` output. `read` on such a file returns `UNAVAILABLE` — tell the user to open Finder, right-click the file, Download Now, then retry.

## Offline behavior

If iCloud sync is paused or offline, reads return what's on disk. Writes succeed locally and sync on next connection — no special handling needed.

## Related: youcoded-inbox

> For inbox-style watched-folder reading with same-day re-presentation guards, see the `youcoded-inbox` bundle's `icloud-drive` provider. This skill is general-purpose and does not track "already shown today" state.

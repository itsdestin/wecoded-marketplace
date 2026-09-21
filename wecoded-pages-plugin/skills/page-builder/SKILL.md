---
name: page-builder
description: Build and edit YouCoded Pages — small apps inside YouCoded that look like part of the app and follow its theme. Invoke as /page-builder "what the page should do", or /page-builder edit <page name or folder>. Also handles rename, new description or icon, delete, and "put it back" from history.
---

# /page-builder

A **page** is a small app inside YouCoded: a timer, a week planner, a paint studio, a notes
board, a checklist, a game. The person describes it; you build it as one HTML document that
uses the app's page style kit, so it looks native and follows whatever theme they switch to.
The app lists it in Pages, lets them pin it to the top bar, and opens it in its own frame.

> **`${SKILL}` in this file** means this skill's own directory (the one containing this
> `SKILL.md`, under the installed plugin). Resolve it once and use it for every path below.

## What a page is on disk

One folder, three files:

```
<home>/<slug>/
  page.html    the whole page — a complete document, no external files
  page.json    { "name": "…", "description": "…", "icon": "…" }
  data.json    written by the app when the page saves data; never write it yourself
```

Two homes. Ask which if the person did not say:

- **Personal** — `~/YouCoded/Personal/Pages/<slug>/`. Theirs on every device; the app syncs it.
- **Project** — `<project folder>/Pages/<slug>/`, a visible folder in the project this
  conversation runs in. It travels with the project. Never put a page under a `.youcoded/`
  folder: that folder is ignored by sync and by git on purpose.

`slug`: kebab-case from the name (`week-planner`), letters, digits and hyphens only, unique in
its home ignoring case. Check with `ls` before you pick it. The app never renames a folder;
neither do you unless the person asks to rename the page.

`icon` is one of: `page` `timer` `notes` `paint` `chart` `calendar` `list` `game`.

## Building a page

1. **Get three things** (ask only for what is missing, one short message): what the page does,
   personal or project, and a name. A one-line description you can write yourself.
2. **Read `${SKILL}/reference/style-kit.md`** — the classes and theme values a page may use.
   Start from `${SKILL}/reference/page-template.html`.
3. **Write `page.html`.** Rules:
   - A complete document. No `<link>` to outside stylesheets, no `<script src>`, no web fonts,
     no images or data fetched from the internet. The page must work with nothing but itself.
     (The app does not yet block outside connections, so this is on you: a page that reaches
     out will silently break offline and is not what a person expects yet.)
   - Every control is a kit class: `.yc-button` (one `.yc-button--primary` per screen, the
     rest default or `--ghost`), `.yc-input` / `.yc-textarea` / `.yc-select`, `.yc-card`,
     `.yc-eyebrow` for section labels, `.yc-app` / `.yc-toolbar` / `.yc-rail` / `.yc-sidebar`
     for app-shaped layouts. Colours come from `var(--…)`; hard-code colours only for content
     that must keep them (a drawing, a chart series, a photo).
   - Saved data goes through `window.youcoded`: read `window.youcoded.data` at start (null the
     first time), call `window.youcoded.save(value)` whenever it changes. JSON only, well under
     1 MB. **Never `localStorage`, `sessionStorage`, cookies or IndexedDB** — the page runs in a
     frame where none of those survive a reopen.
   - Plain, dependency-free JavaScript. Keep state in memory, save on change, render from
     state. Text a person reads is real words, not placeholders.
   - Works from 390 px wide up. Nothing fixed-width that would overflow a phone.
   - The page's own title (`<h1>`) is its name; the app shows the name in its band too.
4. **Write `page.json`** with the name, description and icon.
5. **Say what you made and where**, in one or two sentences: the page is in their library now,
   they can pin it from the card or the panel, and "edit in chat" or `/page-builder edit <name>`
   changes it.

Show restraint: a page does one thing well. Do not add settings, themes, accounts, or
"future" panels the person did not ask for.

## Editing a page

`/page-builder edit <name or folder>`, or a request in conversation. Find the folder (search
both homes for `page.json` whose name matches, case-insensitive; if several match, ask).
Rewrite `page.html` in place with the change. The app reloads the open page when the file
changes; any unsaved in-page state is lost, which is expected. Keep `data.json` untouched
unless the change makes the saved shape invalid — then migrate it in the page's own start-up
code, not by editing the file.

## Rename, description, icon, delete

- Rename or re-describe: edit `page.json`. A rename does not change the folder.
- Delete: remove the folder. Say so first if the page has a `data.json` with content.

## "Put it back" — history

Pages live in synced folders that are git repositories, but not in the usual place:

- Personal: `git --git-dir="$HOME/YouCoded/Personal/.youcoded/sync.git" --work-tree="$HOME/YouCoded/Personal" log --oneline -- "Pages/<slug>/page.html"`
- A project under `~/YouCoded/Projects/<name>/`: the same with that folder as root.
- Any other project: its own git, if it has one.

Show the last few versions with dates, then `… show <commit>:Pages/<slug>/page.html > page.html`
to restore one. History is recorded on each sync (roughly every 15 seconds while the app is
running), not on every edit. If the page has no repository at all, say you cannot undo and
offer to rewrite the change instead.

## Honest limits (say them when relevant)

- A page cannot open the person's files, use their accounts, or run programs. Connections come
  in a later phase.
- The app does not block a page from the internet yet; you do not use it (above).
- Switching to another page reloads it; saved data survives, unsaved in-page state does not.

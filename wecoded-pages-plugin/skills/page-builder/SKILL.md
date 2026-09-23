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
  page.json    { "name": "…", "description": "…", "icon": "…", "connections": [ … ] }
  data.json    written by the app when the page saves data; never write it yourself
```

`connections` is optional — leave it out for a page that needs nothing from outside (most pages).

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
     no images loaded from the web. **The app blocks all of it**: a page cannot load anything
     from the internet itself. If you want a library (a chart library, a date library), paste
     its code into a `<script>` in the page. Pictures go in as `data:` URLs or inline SVG.
   - Information from outside — live numbers, a feed, weather — comes ONLY through
     `window.youcoded.fetch`, and only from places listed in `page.json` (see "Pages that
     connect" below). Never call `fetch`, `XMLHttpRequest` or `WebSocket` directly; they are
     blocked and fail silently.
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
4. **Write `page.json`** with the name, description and icon, plus `connections` if the page
   reaches outside.
5. **Say what you made and where**, in one or two sentences: the page is in their library now,
   they can pin it from the card or the panel, and "edit in chat" or `/page-builder edit <name>`
   changes it.

Show restraint: a page does one thing well. Do not add settings, themes, accounts, or
"future" panels the person did not ask for.

## Pages that connect

A page that shows outside information lists every place it reaches in `page.json`. The first
time it opens, the app shows the person a card that says in plain words what the page could
do, and asks. Nothing else is reachable. The person's keys and sign-ins stay in the app: the
page never sees them.

```json
"connections": [
  { "id": "yc",      "kind": "youcoded" },
  { "id": "feed",    "kind": "public", "address": "hnrss.org" },
  { "id": "weather", "kind": "key", "service": "OpenWeather", "address": "api.openweathermap.org",
    "access": "lookup", "keyIn": "query", "keyParam": "appid",
    "keyHelp": { "steps": ["Sign in at openweathermap.org.", "Open My API keys.", "Copy the key."] } },
  { "id": "gh",      "kind": "github", "access": "lookup" },
  { "id": "any",     "kind": "open" }
]
```

| kind | reaches | credential |
|---|---|---|
| `youcoded` | `api.youcoded.ai` only; look-ups anywhere there, changes only at `writePaths` | the person's YouCoded sign-in |
| `public` | exactly `address` | none |
| `key` | exactly `address` | a key the person pastes into the app, once |
| `github` | `api.github.com` only | the GitHub sign-in the app already holds |
| `open` | any public website | none — and it may **never** sit beside `youcoded`, `key` or `github` |

Rules the app enforces — a manifest that breaks one is dropped, and the page reaches nothing:

- `address` is a bare hostname: `api.example.com`. No `https://`, path, port or `*`.
- Each address must be the **exact** host the page requests. `example.com` does not cover
  `api.example.com`; list both if the page needs both.
- `access`: `"lookup"` (the default) lets the page send look-ups only (GET). Use `"full"` only
  when the page must create, change or delete things at that service; the approval card then
  says so bluntly. Choose the narrowest one that works.
- A `youcoded` connection is look-up only unless it lists `writePaths` — the exact places on
  the service the page must change something, e.g.
  `{ "id": "yc", "kind": "youcoded", "writePaths": ["/admin/analytics/website-campaigns"] }`.
  List only what the page actually posts to; the approval card names each one and tells the
  person nothing else on their account can be changed. Plain paths only (letters, digits,
  `-`, `_`, `/`), at most four.
- **`open` alone.** A page that needs the whole internet (a feed reader following any link, a
  link previewer) gets `open` and no keys or sign-ins. If a request needs both, build two pages.
- A `key` service's key goes as `Authorization: Bearer <key>` unless you say otherwise:
  `"keyParam": "x-api-key"` for another header, `"keyScheme": "token"` or `"none"` for another
  word before it, `"keyIn": "query", "keyParam": "appid"` for a key the service takes in the
  URL. Check the service's own documentation.
- `keyHelp.steps`: two to five short steps telling a non-technical person where to find the
  key on that service's website. They are shown as your words, beside the box where the key
  is pasted.
- **Never build a box inside the page asking for a key, a password or a token.** The app asks
  for keys on its own card; a page that asks is misbehaving.

In the page's script:

```js
async function load() {
  try {
    const r = await window.youcoded.fetch('https://hnrss.org/frontpage.jsonfeed');
    if (r.status !== 200) return showError('The feed answered ' + r.status + '.');
    render(JSON.parse(r.body));
    window.youcoded.save({ last: JSON.parse(r.body) });   // so a reopen shows something at once
  } catch (e) {
    showError(e.message);   // a plain sentence from the app, e.g. why it was refused
  }
}
window.youcoded.onRefresh(load);   // the refresh button beside the page's name
load();
```

- `fetch(url, { method, headers, body })` resolves `{ status, headers, body }` with `body` as
  text. Only `Accept`, `Accept-Language` and `Content-Type` headers survive; the app adds the
  credential itself. The URL must be absolute (`https://…`).
- Show the last saved numbers first (`window.youcoded.data`), then refresh. Say plainly when a
  request fails, using the message the app gave; never invent a reason.
- Refresh on open, from `onRefresh`, and — only if the person wants live numbers — on a timer
  of **at least one minute**. The app refuses more than 120 requests a minute from one page (requests past four at once simply wait their turn), and
  a paid key should not be spent faster than the person can read.
- The app shows how long ago the page last updated, beside its name. Do not draw your own
  "last updated" line.

## Editing a page

`/page-builder edit <name or folder>`, or a request in conversation. Find the folder (search
both homes for `page.json` whose name matches, case-insensitive; if several match, ask).
Rewrite `page.html` in place with the change. Adding a connection, widening `access` or
changing an `address` makes the page ask the person again the next time it opens; say so when
you make such a change. Removing one never asks. The app reloads the open page when the file
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

- A page cannot open the person's files or run programs.
- A page reaches only the places it lists, after the person agrees. Sign-in style services
  (Google, Microsoft and the like) are not available yet — only keys the person pastes, their
  YouCoded sign-in and their GitHub sign-in.
- Look-up only stops a page CHANGING anything at a service; it does not stop the page putting
  what it knows into the address it looks up. Do not describe it as "read-only" or "safe".
- Adding a key cannot be done from a phone; the person finishes that on their computer.
- Switching to another page reloads it; saved data survives, unsaved in-page state does not.

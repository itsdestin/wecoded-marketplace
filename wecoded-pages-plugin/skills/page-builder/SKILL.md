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
   - Information from outside comes through the app's approved APIs: `window.youcoded.fetch`
     for requests, or `window.youcoded.socket` / `window.youcoded.video` for home-device events
     and camera pictures. List each connection in `page.json` (see "Pages that connect" below).
     Never call `fetch`, `XMLHttpRequest` or `WebSocket` directly; the frame blocks them.
   - Every control is a kit class: `.yc-button` (one `.yc-button--primary` per screen, the
     rest default or `--ghost`, which is outlined), `.yc-input` / `.yc-textarea` / `.yc-select` (a plain `<select>` — the app opens it in its
     own menu; never a hand-made dropdown, see style-kit.md → Dropdowns), `.yc-card`,
     `.yc-eyebrow` for section labels, `.yc-app` / `.yc-toolbar` / `.yc-rail` / `.yc-sidebar`
     for app-shaped layouts. Colours come from `var(--…)`; hard-code colours only for content
     that must keep them (a drawing, a chart series, a photo).
   - Use the app's own building blocks instead of inventing them (style-kit.md → "The app's
     building blocks"): `.yc-status` pills for a state, `.yc-notice` boxes for a warning or error
     (raw error text only in its Details fold), `.yc-loading` while something loads,
     `.yc-screen-error` when the whole page cannot load, `.yc-switch` for on/off,
     `.yc-search` + `.yc-filter` chips, `.yc-fold` for anything that opens, `.yc-section` for
     long sections (they fold on a phone, the first open), `.yc-box` inside a card,
     `.yc-chips` for a row of short facts. Scrolling boxes fade at their edges by themselves.
   - **The kit is a starting point, not a rule.** Destin: "users should still be able to fully
     customize page ui and disregard our design principles if they so choose. the kit is just a
     starting point for good first-shot attempts, but should be ignored if the user provides
     contradictory guidance." When the person asks for a look the kit does not give (or that
     goes against it), build what they asked for with the page's own styles.
   - Saved data goes through `window.youcoded`: read `window.youcoded.data` at start (null the
     first time), call `window.youcoded.save(value)` whenever it changes. JSON only, well under
     1 MB. **Never `localStorage`, `sessionStorage`, cookies or IndexedDB** — the page runs in a
     frame where none of those survive a reopen.
   - **Starting a conversation from the page** (only if the person wants a button that does
     this). Add `"connections": [{ "id": "start-session", "kind": "session" }]` to `page.json`
     and call `window.youcoded.startSession({ prompt: '…' })` from a real click on the page's
     own button — never from a timer or on load; the app refuses those. It opens YouCoded's
     new-session window showing the message read-only. The person picks the project, model and
     permissions and presses Create Session; the message then waits unsent until they press
     Enter. It never throws: it resolves `{ ok, reason }` (`ok: false` with a plain reason if
     refused). A message over 20,000 characters, or containing invisible or format characters
     (including zero-width-joiner emoji such as 👩‍💻), is refused — keep it plain text. A
     project page always starts in its own project; a personal page may pass
     `project: '<folder path>'`, honoured only if it is one of the person's saved projects.
     The person allows this once, on the page's approval card; the approval belongs to the
     `page.json` line, so editing `page.html` or the page's data never asks again. Older apps
     lack it: check `typeof window.youcoded.startSession === 'function'` and keep a fallback,
     such as the message in a box with a Copy button.
   - **Showing the person's chats** (only if the page is about their conversations). Add
     `{ "id": "chats", "kind": "chats", "access": "lookup", "scope": "all" }` to `connections`.
     `scope` is `"all"`, `{ "projects": ["<project name>"] }` or `{ "tag": "<tag name>" }` — ask
     for the narrowest the page needs; the approval card names it. `access: "full"` (a separate,
     wider approval) also lets the page change tags, notes and the pinned/complete marks — only
     when the person asked for that. `await window.youcoded.chats.list()` resolves
     `{ ok, chats: [{ id, name, lastActive, created, tags:[{id,name,color}], note, project, model,
     pinned, complete, branch, open }] }` — never what was said in a chat. `chats.resume(id)`
     opens one, and works only from a real click (like startSession). With `full`:
     `setTag(id, tagId, on)`, `setNote(id, text)` (8,000 characters at most),
     `setMark(id, 'pinned'|'complete', on)`. Every call resolves `{ ok, reason }`; it never throws.
     A tag's `color` names a theme colour: paint it with `var(--<color>)`. Never combine with
     `"kind": "open"` (the app refuses the whole list).
   - **Running a program** (rare; only when the person asks for something a page alone cannot do,
     such as reading their files or running git). Put the program in the page's own folder
     (`.mjs`/`.js`/`.cjs` run on the app's own Node, `.py` on python3, `.sh` on bash), add
     `{ "id": "helper", "kind": "program", "file": "<name>" }`, and call
     `await window.youcoded.program.run('<name>', inputString)` → `{ ok, output, exitCode, stderr? }`
     or `{ ok: false, reason }`. Input arrives on stdin (1 MB at most); the answer is stdout
     (2 MB at most); it is stopped after two minutes and when the page closes. **Tell the person
     plainly**: the approval card says it can do anything their account can, and editing the
     program file makes the page ask again.
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
  { "id": "gh",      "kind": "github", "access": "lookup" }
]
```

Choose only the entries the page needs. A page needing any public website uses this
**separate alternative**, never added to the credentialled list above:

```json
"connections": [{ "id": "any", "kind": "open" }]
```

| kind | reaches | credential |
|---|---|---|
| `youcoded` | `api.youcoded.ai` only; look-ups anywhere there, changes only at `writePaths` | the person's YouCoded sign-in |
| `public` | exactly `address` | none |
| `key` | exactly `address` | a key the person pastes into the app, once |
| `github` | `api.github.com` only | the GitHub sign-in the app already holds |
| `open` | any public website | none — never combine with `youcoded`, `key`, `github`, `device`, `plaid` or `chats` |
| `device` | an approved home/Tailscale address, optionally with a port | a device key held by the app, if needed |

For a home-device page, **read `${SKILL}/reference/device-connections.md`** before building:
manifest, approved address, live events and app-played camera video. The style kit covers
see-through backgrounds; keep the page background transparent when the person wants the theme behind it.

Rules the app enforces — a manifest that breaks one is dropped, and the page reaches nothing:

- For public/key services, `address` is a bare hostname: `api.example.com`. No `https://`,
  path, port or `*`. A `device` connection uses its own address rules in the reference below.
- Each address must be the **exact** host the page requests. `example.com` does not cover
  `api.example.com`; list both if the page needs both.
- `access`: `"lookup"` (the default) lets the page send look-ups only (GET). Use `"full"` only
  when the page must create, change or delete things at that service; the approval card then
  says so bluntly. Choose the narrowest one that works.
- A `youcoded` connection is look-up only unless it lists `writePaths`. **Each entry grants
  changes at that path and every descendant path**, e.g. `/admin/foo` also permits
  `/admin/foo/bar`, but not `/admin/foobar`. Use the narrowest prefix the page needs:
  `{ "id": "yc", "kind": "youcoded", "writePaths": ["/admin/analytics/website-campaigns"] }`.
  Explain the descendant access when requesting approval; nothing outside those prefixes can
  be changed. Plain paths only (letters, digits, `-`, `_`, `/`), at most four.
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

- A page cannot open the person's files on its own. It can reach approved services, see chats
  and run a program from its own folder only through the connections above, each approved on
  its card. Older apps lack `chats` and `program`: check `window.youcoded.chats` /
  `window.youcoded.program` exist and say so plainly if not.
- A page reaches only the places it lists, after the person agrees. Sign-in style services
  (Google, Microsoft and the like) are not available yet — only keys the person pastes, their
  YouCoded sign-in and their GitHub sign-in.
- Look-up only stops a page CHANGING anything at a service; it does not stop the page putting
  what it knows into the address it looks up. Do not describe it as "read-only" or "safe".
- Adding a key cannot be done from a phone; the person finishes that on their computer.
- Switching to another page reloads it; saved data survives, unsaved in-page state does not.

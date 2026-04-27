---
name: marketplace-publisher
description: Conversational assistant that helps users publish their plugins (skills, commands, hooks, MCPs, agents) to the WeCoded marketplace. Offers a community-maintained path and an adoption-request path. Handles disk discovery, plugin rebuild, secret sanitization, and PR creation.
---

# WeCoded Marketplace Publisher

You are helping the user publish something they've built to the WeCoded marketplace. The user is a non-technical user who built their plugin via conversation with Claude; they may not know what components it has or where its files live. Your job is to guide them warmly and clearly, never dead-ending, and always explaining what will happen before doing it.

## Step 1 — Preflight (gh CLI check)

Before anything else, confirm the GitHub CLI is installed and signed in. Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/publish.js" preflight-gh
```

Parse the JSON output. If `ok: false`:

- Tell the user in plain language that the GitHub CLI (a small command-line tool called `gh`) isn't ready yet. Show them the `reason` from the script output.
- Include these setup steps:
  - **Install `gh`** — on Windows: `winget install GitHub.cli`. On macOS: `brew install gh`. On Linux (Debian/Ubuntu): `sudo apt install gh`. (If those commands don't work, it means the user doesn't have a package manager set up — tell them to visit https://cli.github.com/ and follow the install instructions there.)
  - **Sign in** — once installed, run `gh auth login` and follow the prompts (it opens a browser).
- Stop the flow politely. Tell them to run `/publish-to-marketplace` again once `gh` is ready.

If `ok: true`, continue to Step 2.

## Step 2 — Open-ended intake

Ask the user, in a friendly tone:

> *"Great, let's get your plugin published. First — tell me about what you made. In your own words, what does it do, and how do you use it?"*

Listen carefully to their answer. From their reply, extract (in scratchpad notes — don't show the user):

- **A one-sentence description** — becomes the marketplace listing's `description` field
- **A casual name** they use for it — seeds the `displayName` field
- **Keywords** that suggest what TYPE of components are involved (e.g. "summarize my emails" → likely a skill + Gmail external-service tool (MCP); "runs when I open Claude" → likely a hook; "a command I type" → slash command)

Don't quiz them. One open question, let them answer naturally — let them ramble. The richer their answer, the better your seed values for description and keywords will be.

## Step 3 — Structured triage

Now confirm what components are involved. Ask these one at a time — never all at once. Each answer populates a `signals` object used by the inventory script:

1. *"Do you trigger it with a slash command — something you type starting with `/`?"* → `hasCommand`
2. *"Does it talk to any external services — email, GitHub, Slack, Notion, anything like that?"* → `hasMCP` (external services almost always mean external-service tools, called MCPs)
3. *"Does it run automatically — like when you start a Claude session, or when you save a file?"* → `hasHook`
4. *"Does it include its own reusable instructions — something you built that you could imagine sharing with a friend?"* → `hasSkill` (default to `true` if they're unsure — most plugins have one)
5. *"Does it include a custom sub-agent — a separate Claude personality you hand off work to?"* → `hasAgent`

Keep the questions brief. If the user answers "I don't know" to any of them, say something reassuring like *"No worries — I'll check for everything just in case."* and set the signal to `true`.

## Step 4 — Detective work (inventory)

With signals collected and keywords in hand, call the inventory script:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/inventory.js" '{
  "signals": { "hasSkill": true, "hasCommand": true, "hasHook": true, "hasMCP": true, "hasAgent": true },
  "userDescription": "summarize my emails",
  "userKeywords": ["email", "gmail", "summary"]
}'
```

The values above are an example. Replace `signals` with the actual booleans from Step 3. Replace `userDescription` with the user's own words from Step 2. Replace `userKeywords` with a short array of lowercased quoted strings derived from the description (3-5 keywords), e.g. `["calendar", "schedule"]`.

Parse the JSON output. The `candidates[]` array is sorted by score — highest relevance first.

If `candidates[]` is EMPTY:
- Tell the user you couldn't find anything matching their description in the usual places.
- Ask: *"Do you happen to know where your files are? If you paste a path, I can look there."*
- If they provide a path, re-run inventory passing that path as an override. (Use `home` or `cwd` keys in the JSON input to redirect scanning.)
- **If the second attempt is still empty**, ask once more: *"I can keep searching if you know another folder where parts of it might live."* Try again with the new path.
- If they still can't locate it, offer to stop and come back later: *"No rush — when you find where your stuff lives, run `/publish-to-marketplace` again."*

If `candidates[]` has entries, proceed to Step 5.

## Step 5 — Findings & confirmation

Present the top candidates in plain language. Don't just dump the JSON — translate each entry into a sentence the user can understand.

Example framing for a skill with cross-references to an external-service tool (MCP):

> *"I looked around and found a few things that might be what you mean:*
>
> *1. A skill called `summarize-emails` in `~/.claude/skills/`. It says it summarizes your inbox using Gmail. It also mentions a Gmail tool (`mcp__gmail__list_messages`), which means it needs the Gmail external-service tool (MCP) to work.*
>
> *Is `summarize-emails` what you made? If yes, should I include the Gmail tool as a required dependency so other people's installs work?"*

Guidelines for this step:

- **Surface cross-references explicitly.** For each candidate whose `references[]` points to an external-service tool (MCP server) that's also in the candidate list, call it out: *"this skill uses the Gmail tool — want me to list that as a dependency?"* This is how we catch hidden dependencies the user didn't know about.
- **Ask one question at a time.** Confirm each candidate separately. Don't batch five "is this yours?" questions into one message.
- **Let the user add pieces you didn't find.** After going through what you found, ask: *"Anything else that belongs with this plugin I didn't mention?"*
- **Let the user remove pieces you shouldn't include.** If they say "no, that's not mine," drop it from the manifest you're building.

Build a "confirmed manifest" in your scratchpad as the user confirms pieces. Structure it like:

```json
{
  "pluginId": "summarize-emails",
  "pieces": [
    { "type": "skill", "sourcePath": "/full/path/SKILL.md", "targetPath": "skills/summarize-emails/SKILL.md" },
    { "type": "mcp", "name": "gmail", "config": { "command": "npx", "args": ["-y", "@mcp/gmail"] } }
  ]
}
```

For `pluginId`: suggest a kebab-case version of the displayName. Confirm with the user — they may want something different. Rules: lowercase only, words separated by `-`, no spaces, no capital letters, no special characters other than `-`. If the user proposes an invalid ID, gently reformat it for them and confirm: *"So I'll use `their-reformatted-id` — sound right?"* Don't reject their suggestion — always propose a valid version and ask for approval.

Once the user has confirmed the manifest, proceed to **Step 6 — rebuild** (filled in during Task 15).

## Step 6 — Rebuild

You now have a confirmed manifest from Step 5. Call the build-plugin script with `sanitize: false` for this first pass. Running unsanitized first means we can see any secret findings BEFORE we modify anything — so we can show them to the user for review.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/build-plugin.js" '{
  "manifest": { "pluginId": "...", "metadata": { ... }, "pieces": [ ... ] },
  "workingRoot": "~/.claude/wecoded-marketplace-publisher/working",
  "sanitize": false
}'
```

Replace the JSON placeholders with the actual confirmed manifest plus initial metadata (you'll gather fuller metadata in Step 8 — for now include at least `displayName` from the user's casual name, and a working `description` and `author.name`).

Parse the JSON output. If `unsanitizedFindings` is non-empty, go to **Step 7**. Otherwise skip directly to **Step 8**.

## Step 7 — Secret review & sanitization

If the build found anything that looks like a secret (API keys, GitHub tokens, etc.), explain what you found to the user BEFORE making any changes. Frame it as a safety check — because shipping a secret to a public GitHub repo is serious, and non-technical users may not realize their plugin contains one.

Show each finding with:
- The **file and line number** where the secret was found
- **What kind of secret** it looks like (GitHub token, Anthropic API key, etc.) in plain language
- A **short, masked excerpt** — e.g. `ghp_...` — never the full value

Then explain the options clearly:

> *"I found **N** things that look like secrets in your plugin. Before we publish anywhere, I want to show you what I found and figure out what to do.*
>
> *[List each finding as above.]*
>
> ***Recommended:** I can sanitize the published version — take these secrets out of the code and set up a place where anyone who installs your plugin configures their own values. That way you're not sharing your personal keys with anyone. I'll also write a **SETUP.md** file that tells installers exactly what values to provide and where to get them. Your local copy stays exactly as it is — only the version we publish is sanitized.*
>
> *Or: if these are deliberately-shared demo values (rotated, revoked, or never sensitive), I can keep them in. But I have to warn you — anyone who installs this plugin will be able to see and use those values. Not recommended unless you're 100% sure.*
>
> *Or: cancel publishing so you can review things yourself first.*
>
> *Which would you like?"*

### If they choose sanitize (recommended)

Re-run the build-plugin script with `sanitize: true`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/build-plugin.js" '{
  "manifest": { ... same as before ... },
  "workingRoot": "~/.claude/wecoded-marketplace-publisher/working",
  "sanitize": true
}'
```

Parse the output. If `sanitizedFindings.length` is GREATER than the original `unsanitizedFindings.length`, the sanitize pass found secrets the first scan missed. Surface those additional findings clearly: *"I found a few more secrets on the sanitize pass that didn't show up in the first scan — here's everything I replaced."*

For each item in `sanitizedFindings`, show a before/after summary in plain language:

> *"In `scripts/fetch.js`, I replaced the Anthropic API key with `process.env.ANTHROPIC_API_KEY` and added `ANTHROPIC_API_KEY` to `SETUP.md`."*

Make sure the transformation feels transparent — the user should understand roughly what happened, not feel like something was done to them.

### If they choose keep-as-is

Proceed without re-running sanitize. The unsanitized files are already in the working dir from Step 6.

**Warning:** the Step 9 preflight will likely fail on the secret-scan check — preflight re-scans the working dir as a safety net. When Step 9 returns a `secret-scan` failure, loop back to Step 7 and offer sanitization again, quoting the preflight's findings. Non-technical users often change their minds once they realize the consequences are real.

### If they choose cancel

Stop the flow. Tell them:

> *"No problem — I'll leave your working copy in place so you can review it. Run `/publish-to-marketplace` again when you're ready."*

Do not delete the working dir on cancel — user may want to inspect.

## Step 8 — Metadata

The marketplace listing needs more than just the plugin files — it needs metadata that makes it discoverable. The `plugin.json` generated in Step 6 has basics, but the marketplace entry itself needs `displayName`, `description`, `category`, `tags`, `lifeArea`, and `audience`.

Propose values based on:

- **`displayName`** — the casual name the user gave in Step 2, cleaned up (Title Case, no weird punctuation). Example: "summarize emails" → "Summarize Emails".
- **`description`** — the one-sentence description from Step 2, gently polished for marketplace prose (remove "it" at the start, add a subject if missing). Target length: 1-2 sentences, under 150 characters.
- **`category`** — pick ONE from the valid set. The first time you reach this step, fetch the live marketplace schema to get the current valid categories (the preflight script already knows how — you can read `scripts/schema.js` source via a plain `fetch` or reuse the schema-fetch helpers the preflight script uses). Common values: `personal`, `productivity`, `development`, `work`, `fun`. Match based on what the plugin does. If it's a Gmail skill → `productivity`. If it's a journaling skill → `personal`.
- **`tags`** — 3-5 lowercase kebab-case keywords that help people find it. Draw from the user's intake words + the component types detected (e.g. `email`, `summary`, `mcp-integration`, `gmail`). Rules: lowercase only, words within a tag separated by `-`, no spaces or special characters. If the user proposes an invalid tag, reformat it silently and confirm: *"I'll use `their-reformatted-tag` — sound right?"*
- **`lifeArea`** — infer from category: `personal` category → `["personal"]`; `work` → `["work"]`; others can be empty `[]` or mirror the category.
- **`audience`** — default to `"general"` unless the plugin is clearly for developers (mentions git, terminals, CI, etc.), in which case `"developer"`.

Show the user the proposed values as a clean list. Then ask:

> *"Here's how your plugin will appear in the marketplace:*
>
> *- **Name:** Summarize Emails*
> *- **Description:** Summarize your inbox using the Gmail MCP, grouped by sender importance.*
> *- **Category:** productivity*
> *- **Tags:** email, summary, gmail, mcp-integration*
> *- **Life area:** work*
> *- **Audience:** general*
>
> *Any of these you want to change?"*

If they say "looks good," move on. If they want to change specific fields, update only those — don't re-ask everything. Keep the loop tight.

Once metadata is confirmed, you're ready for preflight in **Step 9** (filled in during Task 16).

## Step 9 — Preflight

Run the full preflight checks against the working dir:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/preflight.js" '{
  "pluginDir": "~/.claude/wecoded-marketplace-publisher/working/<pluginId>",
  "pluginId": "<pluginId>",
  "metadata": { "displayName": "...", "description": "...", "category": "...", "audience": "..." }
}'
```

Replace `<pluginId>` with the confirmed plugin ID and fill in the metadata object with the values from Step 8.

Parse the JSON output. For each `check` entry:

- **If `status: "pass"`** — silently continue; no need to report these.
- **If `status: "warn"`** — briefly describe the concern to the user and ask if they want to proceed. Example: *"Heads up — I noticed your plugin references a Gmail tool, but there's no Gmail MCP in your dependencies yet. Want to add it, or continue without?"*
- **If `status: "fail"`** — don't proceed. Translate the `detail` field into plain language and jump back to the appropriate earlier step:
  - `secret-scan` fail → **loop back to Step 7** and quote the preflight's findings so the user sees exactly what was flagged
  - `required-fields` fail → **loop back to Step 8** and fix the missing fields
  - `id-uniqueness` fail → the plugin ID is taken on the marketplace. Suggest 2-3 alternatives based on the displayName (e.g. "summarize-emails" → "summarize-my-emails" or "email-summarizer"). Ask the user to pick one, update the manifest, and re-run build-plugin (Step 6) with the new ID before looping back here
  - `size` / `hygiene` fail → show the offending files. Offer to exclude them from the build (ask the user to confirm each) and re-run build-plugin with the updated piece list

Only proceed to Step 10 when `pass: true`.

**If `hasMCP` is true**, also walk the user through the MCP cross-platform checklist in **Appendix A** below before continuing. The preflight script can't catch protocol-layer or Windows-spawn issues; those are real-world fixes that any MCP server author needs to verify by hand.

## Step 10 — Show finished plugin

Give the user a human summary of what's ready to publish. Translate the metadata and component list into prose:

> *"Here's what's ready to publish:*
>
> *- **Name:** Summarize Emails*
> *- **Description:** Summarize your inbox using the Gmail MCP, grouped by sender importance.*
> *- **Category:** productivity*
> *- **Tags:** email, summary, gmail, mcp-integration*
> *- **Contains:** 1 skill (`summarize-emails`), 1 MCP dependency (Gmail)*
> *- **Installers will need to configure:** `GMAIL_TOKEN` (your `SETUP.md` explains how)*
>
> *Everything looks good. Ready to publish?"*

If the user says no or wants a change, figure out what they want to adjust and jump back to the relevant step (usually Step 8 for metadata).

## Step 11 — Path choice

This is the most consequential decision in the flow. The user chooses between maintaining the plugin themselves (community path) or asking WeCoded to adopt it. Present it clearly — especially the irreversible consequences of adoption.

Show the user the two options verbatim (keep this framing — it's been reviewed for clarity):

```
Two options for publishing:

Option A: Community plugin (you maintain it)
  • Your plugin lives in your own GitHub repo
  • You can edit, update, or remove it any time
  • If people report bugs, you fix them
  • Marketplace shows a "Community" badge

Option B: Request WeCoded adoption (they may take over)
  • Your plugin still gets published to your GitHub repo and listed
    as Community — no matter what, you end up with a working listing
  • Separately, WeCoded reviews and decides whether to adopt it

  If WeCoded accepts:
    • WeCoded copies your plugin into their own repo
    • Marketplace shows an "Official WeCoded" badge
    • Your community version is delisted (adopted copy replaces it)
    • You no longer control updates, bug fixes, or the plugin itself
    • You still have YOUR repo — it's just no longer what the
      marketplace lists

  If WeCoded declines:
    • Nothing changes — your community version stays listed
    • WeCoded gives you a reason

  Response usually takes 1-2 weeks.
```

Then ask:

> *"Which would you like — A (community, you maintain) or B (request adoption)?"*

If the user picks **B**, follow up with one more question:

> *"In a sentence or two, why would you like WeCoded to take this over?"*

Save their answer as `reason`. This goes into the adoption-request PR body so WeCoded knows what they're responding to.

If the user hesitates or asks questions, answer them honestly. Common ones:
- *"What does adoption mean again?"* → restate the consequences in fresh language, emphasize "you lose control if accepted"
- *"Can I change my mind later?"* → once the adoption PR is merged, no — the community listing is delisted. Before merge, yes — they can close the adoption PR themselves.
- *"How will I know WeCoded's decision?"* → they'll get a GitHub notification on the adoption-request PR.

## Step 12 — Publish

Call the publish orchestrator:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/publish.js" publish '{
  "workingDir": "~/.claude/wecoded-marketplace-publisher/working/<pluginId>",
  "pluginId": "<pluginId>",
  "ghUser": "<from gh auth>",
  "metadata": { ... },
  "pathChoice": "community" | "adoption",
  "reason": "...",
  "configDir": "~/.claude/wecoded-marketplace-publisher"
}'
```

Fill in the actual values:
- `pluginId` — the confirmed plugin ID
- `ghUser` — the user's GitHub handle (get this via `gh api user --jq .login` if you don't already have it)
- `metadata` — the full confirmed metadata object from Step 8
- `pathChoice` — `"community"` or `"adoption"` based on Step 11
- `reason` — only include if `pathChoice` is `"adoption"`

The script writes a ledger to `~/.claude/wecoded-marketplace-publisher/published.json` as it progresses, so if it fails partway through, re-running `/publish-to-marketplace` will resume from where it stopped.

Parse the JSON output. If the script throws (exits non-zero):

- **`gh repo create` failure with "name already taken"** — the user's GitHub already has a repo with that name. Suggest appending a number or rewording (e.g. `summarize-emails-v2`). Ask the user to pick a new ID, update the manifest, and re-run Step 12 with the new ID.
- **PR creation failure after the repo is live** — tell the user: *"Your GitHub repo was created successfully, but opening the PR to the marketplace failed. Your working copy is saved — run `/publish-to-marketplace` again and I'll pick up from where we left off."* The ledger handles this — do not retry manually.
- **Adoption PR fails after community PR succeeded** — tell the user: *"Your community listing PR is open, but the adoption request PR failed. The community listing will still go live. I'll retry the adoption request now."* Then re-call the publish script (it'll skip completed phases via the ledger).
- **Any other failure** — surface the error message, apologize, and stop. The ledger preserves partial state for a later resume.

## Step 13 — Confirmation

On success, give a warm, concrete summary:

> *"**Done.** Here's what happened:*
>
> *- **Your repo:** https://github.com/{user}/{pluginId}*
> *- **Community listing PR:** https://github.com/itsdestin/wecoded-marketplace/pull/NNN*
> *- **Adoption request PR:** https://github.com/itsdestin/wecoded-marketplace/pull/MMM  (if applicable)*
>
> *What happens next:*
>
> *- The WeCoded team reviews community PRs typically within a few days. You'll get a GitHub notification when they respond.*
> *- If you chose adoption: the adoption review usually takes 1-2 weeks. Either way, your community listing is already live as soon as the community PR is merged.*
> *- If you need to make changes before the PR is merged, just push commits to your repo and the PR will update automatically.*
>
> *You can always find these URLs in `~/.claude/wecoded-marketplace-publisher/published.json` if you need them later.*
>
> *Thanks for publishing — your plugin is on its way to the marketplace."*

End the session. Do not poll PR status. GitHub will notify the user directly when there's activity.

## Appendix A — MCP Server Cross-Platform Checklist

**Walk this with the user any time `hasMCP` is true and the plugin ships its own MCP server.** It does NOT apply to plugins that only consume external MCPs (e.g. a plugin whose only MCP integration is Gmail). The checklist captures real-world breakages from prior plugin submissions; for the canonical engineering reference and code citations, see `youcoded-dev/docs/PITFALLS.md` → "MCP Plugin Authoring (Cross-Platform)".

Frame this conversationally. Don't quiz the user on every item — pick the ones their plugin actually exposes and ask focused questions.

### A.1 — Cross-platform spawn

Their MCP server's `command` in `mcp-manifest.json` MUST work when Claude Code spawns it via Node `child_process.spawn` on Windows.

Ask: *"On Windows, what command does your MCP server start with?"* Map their answer:

- **A real `.exe` on the system PATH** (`node`, `python`, `uvx`, custom-compiled binary): ✓ safe.
- **`bash` or `sh`**: ✗ Git Bash's `bash.exe` is NOT on the Windows system PATH (only `git.exe` is). Tell the user to either (a) avoid bash entirely (write the launcher in Python/Node), or (b) use the 8.3 short path `C:\PROGRA~1\Git\usr\bin\bash.exe` in the Windows entry of `mcp-manifest.json`. NEVER use `C:\Program Files\Git\usr\bin\bash.exe` — Claude Code's spawn appears to wrap with `cmd.exe shell:true` and word-splits at the space.
- **A `.sh` file path directly**: ✗ Windows can't execute `.sh` via CreateProcess. Wrap with the bash short path as above, OR ship a `.cmd` Windows wrapper alongside the `.sh`.
- **An absolute path containing spaces**: ✗ same word-split problem. Use the 8.3 short name (verify with `powershell -Command "(New-Object -ComObject Scripting.FileSystemObject).GetFile('<path>').ShortPath"`).

If the manifest currently uses `${PACKAGE_DIR}` placeholders: warn the user that `${PACKAGE_DIR}` is only expanded by the YouCoded desktop app's MCP reconciler. Users who run Claude Code from the CLI outside of YouCoded will see the literal placeholder reach `spawn()` and the server will fail with `Missing environment variables: PACKAGE_DIR`. Either accept that limitation (it's the precedent set by other community plugins like `imessages`) or bake an absolute path / on-PATH command into the manifest instead.

### A.2 — Python SDK pinning

If the MCP server is written in Python and uses the official `mcp` SDK, the user's `pyproject.toml` MUST pin a major version: `mcp>=1.0.0,<2.0.0`. The 0.x → 1.x transition broke the dict-based tool API in favor of Pydantic `Tool` / `TextContent` objects, and a loose `mcp>=0.9.0` floor will silently pull 1.x with no version audit. Symptom: `tools/list` returns `{"error":"'dict' object has no attribute 'name'"}`.

Ask: *"Open your `pyproject.toml`. What does the line for `mcp` say?"* If it has no upper bound, walk them through tightening it. The same logic applies to other rapidly-evolving SDK deps with major-version Pydantic migrations.

### A.3 — Real-world handshake test (not just `claude mcp list`)

The `claude mcp list` CLI lies about MCP server health: it only verifies the `initialize` step and reports `✓ Connected` even when `tools/list` is broken. The in-session `/mcp` host runs the full handshake and shows the truth. Two consequences:

- Tell the user to verify with `/mcp` (in a Claude Code session), NOT with `claude mcp list`. If `/mcp` shows `✗ Failed`, run `claude --debug` to see the actual error.
- For a deeper test, offer to walk them through a Node spawn-probe that sends `initialize` + `notifications/initialized` + `tools/list` and confirms all three succeed. Reference: the pattern in `wecoded-marketplace/spotify-services/docs/plan.md` Phase 2 (look for `spawn-tools-list.js`).

### A.4 — Setup script portability (only if the plugin ships shell setup scripts)

If the user ships `setup/*.sh` scripts:

- **`PYTHONIOENCODING=utf-8`** on any line that invokes Python and prints non-ASCII (✓, ✗, em-dash, etc.). Without it, Git Bash + Python 3.13 crashes on cp1252 stdout before any work happens.
- **No `rsync`** — it's not on Git Bash's PATH by default. Use `tar | tar` pipe or `cp -r` with manual excludes.
- **No `python3` prereq check** — it resolves to a Microsoft Store stub on Windows and false-fails. Either drop the check (`uv venv --python X.Y` self-manages) or also try `py` and `python` as fallbacks.
- **`chmod +x` on shell scripts**, then `git update-index --chmod=+x` so the executable bit survives the Windows commit.
- **Don't source the venv `activate` script in launchers.** Activate calls `basename` / `dirname` from `/usr/bin/`, which Claude Code's MCP spawn doesn't put on PATH. The launcher fails with `basename: command not found` and never reaches python. Skip activate entirely — call the venv python by absolute path (`$VENV/Scripts/python.exe` on Windows, `$VENV/bin/python` on Unix) and set `VIRTUAL_ENV` manually. Symptom: `/mcp` shows ✗ Failed but the same launcher works fine from a Git Bash terminal.

### A.5 — Real Windows test before submission

The single highest-leverage thing a user can do is run their plugin's full setup flow (server install + OAuth/auth + first `/mcp` connect + first tool call) on a real Windows machine before submitting. Every item above was caught by exactly that pass for prior plugins. If the user is on macOS and doesn't have Windows access, flag this in the PR description so the marketplace reviewer can run the Windows pass on their behalf.

End of Appendix A. After walking the items that apply, return to Step 10.

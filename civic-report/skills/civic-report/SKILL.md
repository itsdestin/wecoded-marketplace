---
name: civic-report
description: Use when the user asks for a report on their representatives, wants to research candidates before voting, or wants to understand who represents their address. Handles federal reps deeply, state officials as name-level stubs.
---

# Civic Report

Generate a comprehensive, source-linked report on the user's federal
representatives (President, VP, 2 US Senators, US House Rep) plus name-level
stubs for their state officials (Governor, state senator, state rep).

## Workflow

### 1. First-run check

Check if `~/.claude/plugins/civic-report/config.local.json` exists.
If not, run `node $PLUGIN_ROOT/scripts/setup-key.js` and wait for the user
to complete the prompt. Do not proceed until the config file exists.

### 2. Collect inputs

Ask the user these questions **in order, one message at a time**:

1. **Address** — "What's your full street address? (Street, City, State, ZIP — US only)"
2. **Angle** — "What angle or reason brought you here? Examples: housing, guns,
   climate, immigration, economy, foreign policy, general. Feel free to be
   specific ('I'm writing to my rep about rent control'). Free text."
3. **Tone** — Present the six options from `prompts/tone-instructions.md`.
   Ask the user to pick one.
4. **Scope** — "Full report (all 8 sections per rep) or Custom (pick which
   sections)?" If Custom, list the sections and let them select.
5. **Depth** — "Quick (1-page per rep), Standard (~3 pages per rep), or Deep
   dive (everything)?"

### 3. Resolve reps and detect elections

Run, in order:

```bash
node $PLUGIN_ROOT/scripts/resolve-districts.js '<address-json>'
node $PLUGIN_ROOT/scripts/fetch-members.js '<{state, congressionalDistrict}>'
node $PLUGIN_ROOT/scripts/fetch-elections.js '<members-list>'
```

If `fetch-elections` returns any `upcoming` members, ask the user **in one
batched prompt**:

> Upcoming elections detected:
>   • US Senator Jane Smith — 8 months (Nov 2026)
>   • US Rep John Doe — 8 months (Nov 2026)
>
> Include opponent research? [A] All  [N] None  [S] Select subset

Store the user's selection as the `opponentResearchList` (array of bioguide ids,
possibly empty).

### 4. Fetch structured data

For each federal rep, run:

```bash
node $PLUGIN_ROOT/scripts/fetch-voting.js '<{govtrackId}>'
node $PLUGIN_ROOT/scripts/fetch-finance.js '<{name, state}>'
```

`fetch-finance` needs the api.data.gov key if present — read it from
`config.local.json` and pass via env: `API_DATA_GOV_KEY=... node ...`.

### 5. Narrative web research

For each federal rep, use your `WebSearch` and `WebFetch` tools to collect:

- **Scandals & controversies** — search Wikipedia, reputable news outlets.
  Record source URLs. If nothing credible, return empty — DO NOT fabricate.
- **Recent public statements** — last 90 days, news + official site + social.
- **Opponent research** — only for reps in `opponentResearchList`. Ballotpedia
  candidate pages, FEC filings, campaign websites, recent news.

For state officials (Governor, state sen, state rep), collect only name +
party + office + any major recent news. Wikipedia "List of current [state]
state legislators" pages are the best keyless source.

### 6. Compose the report

Read `prompts/report-template.md` and `prompts/tone-instructions.md`.

- Apply the selected tone to narrative sections per tone-instructions.md. If
  tone === "Neutral", omit the `Claude's take` section entirely for every rep.
- Apply the selected depth by controlling prose length (Quick ≈ 150
  words/section, Standard ≈ 400, Deep ≈ 1000+).
- Apply the selected scope by including only sections in `sectionsSelected`.
- Every factual claim gets a footnote linking to the source URL. No source,
  no claim.

### 7. Write the file

Compute the address hash using the same normalization as `lib/hash-address.js`
(lowercase + collapse whitespace, sha256, first 6 chars).

Write the report to the user's current workspace at:

```
reports/civic-<YYYY-MM-DD>-<hash>.md
```

Confirm the path to the user.

## Error handling

- **Non-US address**: `resolve-districts.js` throws — exit with the friendly
  error and stop. Don't retry.
- **Vacant seat**: `fetch-members.js` returns `houseRep: null`. Render
  "Seat vacant — special election [date]" based on the most recent prior
  term-end and skip rep-specific sections for that seat.
- **Rate-limit hit**: fetcher throws HTTP 429. Retry once after a 30s wait.
  If still failing, drop that section with an explanatory note and continue.
- **Conflicting sources**: when Wikipedia and Ballotpedia disagree, present
  both with attribution rather than picking one.

## What NOT to do

- **Do not fabricate.** If a fetcher returns empty or a web search finds
  nothing credible, write the empty-state line and move on. Never invent
  votes, donors, or quotes.
- **Do not omit the footnote trail.** Every factual claim has a linked
  source. This is non-negotiable for political content.
- **Do not apply the selected tone to data sections.** Tone only affects
  `Claude's take`, scandals framing, and opponent analysis. Basics, Votes,
  and Finance are flat facts in every tone.
- **Do not store the address anywhere.** Use it for district resolution and
  the report body only. Filename gets the hash.

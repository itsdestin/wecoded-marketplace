# Civic Report — {{address}}

_Generated {{date}} · Angle: {{angle}} · Tone: {{tone}} · Depth: {{depth}}_

{{#if sectionsSelected.summary}}
## Summary

{{A 3-5 sentence overview across all reps, grounded in the sections below,
reflecting the user's angle. Under Neutral tone, just list who their reps are
and any salient upcoming elections. Under other tones, apply the tone per
`tone-instructions.md`.}}
{{/if}}

## Federal

{{#each federalReps as rep}}
### {{rep.title}} {{rep.name}} ({{rep.party}}){{#if rep.district}} — {{rep.state}}-{{rep.district}}{{/if}}

{{#if sectionsSelected.basics}}
**Basics**
- Office: {{rep.office}}
- Term: {{rep.termStart}} – {{rep.termEnd}}
- Committees: {{rep.committees}}
{{/if}}

{{#if sectionsSelected.ideology}}
**Ideological profile**
{{rep.ideology ?? "Data unavailable — brand-new member or API returned nothing."}}
{{/if}}

{{#if sectionsSelected.votes}}
**Recent notable votes** _(tied to angle: {{angle}} where possible)_
{{List up to 10 recent votes from `fetchVoting` output. Prefer votes whose
`question` matches the user's angle. For each: date, question, result, how
this rep voted. Cite vote URL as footnote.}}
{{/if}}

{{#if sectionsSelected.finance}}
**Campaign finance**
{{If `finance.source === "fec"`: render totals.receipts/disbursements and top
5 employers. If `finance.source === "skipped"`: include a single-line note
with `finance.reason`.}}
{{/if}}

{{#if sectionsSelected.scandals}}
**Scandals & controversies**
{{Summarize findings from web research. Every claim MUST have a footnote
linking to the source. If research returned nothing credible, write: "No
significant controversies surfaced in this run." DO NOT fabricate.}}
{{/if}}

{{#if sectionsSelected.statements}}
**Recent public statements**
{{Summarize last 90 days of notable statements with footnotes. If nothing
credible found, write the empty-state line and skip.}}
{{/if}}

{{#if sectionsSelected.electoral}}
**Electoral context**
- Last win margin: {{rep.lastMargin ?? "unknown"}}
- Next election: {{rep.electionDate ?? "n/a"}}
{{#if rep.opponents}}
  **Opponents** _(limited data — challengers often have thin records)_
  {{List opponents with what research turned up. Footnotes required.}}
{{/if}}
{{/if}}

{{#if tone !== "Neutral" && sectionsSelected.take}}
**Claude's take** _(tone: {{tone}})_
{{Apply tone per `tone-instructions.md`. Ground every judgment in a fact from
the sections above. One paragraph for Quick, 3 for Standard, 5+ for Deep.}}
{{/if}}

{{/each}}

## State

### Governor: {{state.governor.name}} ({{state.governor.party}})
{{Basics only + Claude's take if tone !== Neutral.}}

### State Senator: {{state.senator.name ?? "not resolved"}}
### State Representative: {{state.representative.name ?? "not resolved"}}

## Sources

{{Footnote-style list of every URL consulted, grouped by rep. Every factual
claim in the report must correspond to a footnote here.}}

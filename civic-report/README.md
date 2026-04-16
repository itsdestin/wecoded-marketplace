# Civic Report

A Claude Code skill that generates a comprehensive, source-linked report on
your federal representatives (President, VP, US Senators, US House Rep) and
your state officials (Governor, state senator, state rep), personalized by
your reason for looking them up.

## What you get

Per federal rep: basics, ideological profile, recent notable votes (tied to
your angle), campaign finance, scandals & controversies, recent statements,
electoral context including opponent research when an election is upcoming,
and Claude's take through the tone lens of your choice.

State officials get a lightweight version with name + party + office plus
Claude's take if you picked a non-neutral tone.

## Tones

Neutral · Analytical · Devil's advocate · Cynic · Sarcastic · Historian

## Install

Install via the YouCoded marketplace — search "Civic Report".

## First run

The skill will ask if you want to add a free api.data.gov key. This is
optional — the skill works without it. Adding a key (30-second signup at
https://api.data.gov/signup/) unlocks clean FEC campaign-finance data
(top donors, industry breakdown). Press Enter to skip.

## Usage

```
/civic-report
```

Then answer the prompts for address, angle, tone, scope, and depth. The
final report is saved to `reports/civic-<date>-<hash>.md` in your workspace.

## Data sources

- Address → district: U.S. Census Geocoder (keyless)
- Federal member bios: `@unitedstates/congress-legislators` (keyless)
- Voting records: GovTrack (keyless)
- Campaign finance: FEC via api.data.gov (optional free key)
- Scandals, statements, opponents: Wikipedia, Ballotpedia, news via Claude's
  web search tools

## Privacy

Your address is used only to resolve your districts. It is not logged, not
sent anywhere except the Census Geocoder, and not written to the report
filename — filenames use a hash. The address does appear in the report body
itself since you're reading it.

## License

MIT

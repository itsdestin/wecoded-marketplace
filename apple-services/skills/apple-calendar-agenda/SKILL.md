---
name: apple-calendar-agenda
description: "Show what's on the user's Apple Calendar for today, this week, or a specific date range. Use when they ask 'what's on my calendar', 'what do I have today', 'show my agenda', or similar."
---

# apple-calendar-agenda

Show calendar events for a time range.

## Usage

```bash
# Today
apple-wrapper.sh calendar list_events --from "$(date -u +%Y-%m-%dT00:00:00Z)" --to "$(date -u -v+1d +%Y-%m-%dT00:00:00Z)"

# This week (Monday-Sunday)
apple-wrapper.sh calendar list_events --from "$(date -u -v-Mon +%Y-%m-%dT00:00:00Z)" --to "$(date -u -v+Sun +%Y-%m-%dT23:59:59Z)"

# Specific range
apple-wrapper.sh calendar list_events --from 2026-04-17 --to 2026-04-24
```

Output is a JSON array of events; format for display as a human-readable list (don't print raw JSON).

## Rendering

When showing the agenda, group by day and format times in the user's local timezone. Prefer a compact list over a table for ≤10 events. For an empty result, say "Nothing on your calendar in that range."

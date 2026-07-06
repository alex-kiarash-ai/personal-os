# 10 - Weekly Exec Report

## What it actually does
Every Friday at 16:00 it plays CEO's chief of staff: reads what every other automation produced that week - standups and velocity, job pipeline numbers, inbox stats, meetings, expenses, content, radar findings - plus Gmail and Calendar, and compresses it into a branded seven-slide deck (Week Summary, Project Status, Meetings, Market Intel, Relationships, Blockers, Next Week) and a matching Notion page. Trend metrics accumulate week over week in a history file.

## Why it exists
It's the capstone that proves the pyramid: sixteen automations are only a system if something reads them *together*. The Friday deck is Shaheen's own weekly review (what actually moved, what stalled), and it doubles as interview evidence - a real, recurring artifact showing the whole operation working end to end. The trend history exists because a single week lies; the direction doesn't.

## Works together with
- **Everything.** It's a pure reader: [Sprint Tracker](01-sprint-tracker.md) for progress, both [job](03-application-engine.md) [engines](14-ai-application-engine.md) for pipeline stats, [Email Triage](07-email-triage.md), [Meeting Intel](06-meeting-intel.md), [Expense Wrangler](08-expense-wrangler.md), [Content Machine](09-content-machine.md), [Radar](15-alex-ai-radar.md), [Airbnb](13-airbnb-host.md).
- **The vault's /lint health check** runs read-only inside it, so the week's report includes system hygiene.

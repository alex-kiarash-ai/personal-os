# 01 — Sprint Tracker

## What it actually does
Every weekday at 09:00 it reads the Progress Tracker board in Notion (the master to-do board for the whole Personal OS build), writes a short standup: what got done, what's in progress, what's stuck and for how long — and appends one line of "velocity" (how fast things are moving week over week). It's the system's project manager, and it never forgets to run the meeting.

## Why it exists
Sixteen projects get built in parallel; without a daily reckoning, "in progress" quietly becomes "abandoned". The standup makes drift visible within a day. Its velocity log also became the system's canary: a three-day gap in the numbers was how a silent scheduling failure got caught in June — which is why this automation got armor (failure detection + automatic retries + a red alert to the dashboard) before any other.

## Works together with
- **Every other project** — they all report Done to the board this reads.
- **[Alex HQ](16-alex-hq.md)** — receives the velocity number and a green/red run status daily; a failed standup shows as a red tile.
- **[Weekly Exec Report](10-weekly-exec-report.md)** — uses the week's standups as its progress section.

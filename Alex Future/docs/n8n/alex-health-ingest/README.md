# Alex Health - Ingest (the sleep + steps receiver)

**Workflow ID:** `WtOKBY00Cq1FhQ8T` · **Trigger:** an iPhone Shortcut POSTs to it once a day at 23:59 · **Nodes:** 4 · **Export in this folder:** workflow.json (2026-07-04, latest)

## What it does

Shaheen's phone sends this workflow two things each day: how many steps he walked yesterday, and how his sleep broke down into stages last night. The workflow turns the raw sleep stages into a single **Alex Sleep Score from 0 to 100** and files a row per day into a small database on the box (`alex_health`). From there the morning brief and the Alex HQ dashboard read it. The same webhook was used once to load in two and a half years of history from Shaheen's Apple Health export.

## Why it exists

Apple Health has no way to send data out on a schedule and no single sleep score. This is the receiver that makes both possible: a free door into Alex's server that the phone can knock on daily, and the place where the sleep stages become one honest number Shaheen can glance at.

## The steps, node by node

- **Health Webhook** - the front door. Listens for a POST at `/webhook/alex-health-ingest`. It's locked: every request must carry the secret `X-Alex-Token` header or it's turned away (403). Accepts one day, or a batch of days (the history load used a batch).
- **Score + Normalize** - the brain. For each day it reads the sleep-stage minutes (deep, REM, core, awake, in-bed) and computes the Alex Sleep Score: full marks for 7-9 hours asleep, good efficiency, healthy deep and REM percentages, and few wake-ups; points come off for short or broken nights. It cleans every field into the right type and stamps the row. (The exact same formula also lives in the backfill script, so history and daily runs score identically.)
- **Insert Health Row** - files the finished row into the `alex_health` table. The table is append-only: re-sending a day just adds a newer row, and the readers always take the latest, so nothing is ever overwritten or lost.
- **Respond OK** - tells the phone it worked (`{"ok": true, "count": N}`).

## Notes
- The score is **v1, five components** (duration, efficiency, deep %, REM %, restfulness). A sixth, bedtime consistency, is planned once the daily path can look back at recent nights.
- The Shortcut runs at 23:59 with "is today" filters and sends ONE combined row dated today (the day's steps + the night woken from that morning). The next morning's 08:00 brief reads that row and shows steps for *yesterday* (a complete day) and sleep for *last night*. The table is still merged-by-day, so a resend or a partial row coalesces cleanly.
- Full build + the phone-side Shortcut: `work/17-health-tracker/CLAUDE.md` and `work/17-health-tracker/IPHONE-SHORTCUT.md`.

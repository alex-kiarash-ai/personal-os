# 17 — Health Tracker

## What it actually does
Once a day, Shaheen's iPhone quietly hands Alex two numbers from Apple Health: **how many steps he walked yesterday**, and **how well he slept last night**. A small automation he builds on the phone (a native Shortcut, no app to install, no cost) reads yesterday's steps and last night's sleep stages from the Watch and sends them to Alex's server. The server turns the raw sleep stages into a single **Alex Sleep Score from 0 to 100** and files it away. From then on both numbers show up in the morning brief and on the Alex HQ dashboard, with a two-week trend line.

## Why it exists
Apple gives you sleep *stages* (deep, REM, light, awake) but never a single "how was my sleep" number, and there's no way to get the data off the phone automatically — it just sits in the Health app. Shaheen wanted the two things he actually cares about, steps and a sleep score, to land in front of him every morning without opening anything. So Alex built the missing piece: a free path off the phone plus its own sleep score, tuned to what sleep science says matters (enough hours, enough deep and REM, few wake-ups, good efficiency). The whole two-and-a-half years of history he exported was parsed once and loaded in, so the trends started full instead of empty.

## The honest limitations
- **The score is Alex's own**, not a medical or Oura/Whoop number. It's defensible and tunable, but it's a personal yardstick.
- **Sleep data is only as good as watch-wear** — he wears it to bed maybe one night in six, so there are real gaps, shown honestly rather than faked.
- **The phone occasionally skips the daily send** (an iOS quirk on a locked phone); the system just shows the last good day and self-heals.

## Works together with
- **[Morning Brief](02-morning-brief.md)** — carries the "Body" line: steps yesterday, sleep score last night.
- **[Alex HQ](16-alex-hq.md)** — two glance tiles (sleep score, steps) with sparklines; it reuses HQ's exact metrics plumbing (token webhook → data table → summary), so this was a bolt-on, not a new system.

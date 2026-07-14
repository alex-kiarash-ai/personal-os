# Airbnb Host - Browser Automation Runbook

Read-only harvest of **your own** Airbnb host data via a real Chromium browser.
No host API exists, so this drives the logged-in dashboard. It never sends, accepts,
declines, or changes anything.

## One-time setup (already done by Alex)
- `pip install playwright pandas openpyxl` + `playwright install chromium` - installed 2026-06-14.

## First run - log in once (you do this)
```
cd work/13-airbnb-host
python scrape_airbnb.py --setup
```
A browser opens. Log into Airbnb, complete 2FA, land on your host dashboard, then press ENTER in the terminal. Your session is saved to `.browser-profile/` and reused forever after. **You will not log in again** unless Airbnb expires the session.

## Normal run
```
python scrape_airbnb.py        # harvest (visible window, reuses session)
python ingest_airbnb.py        # parse raw/ into the Excel income model
```
Then `/airbnb-host` syncs the normalized bookings into Notion.

## What you get
- `raw/airbnb-earnings-<date>.csv` - official earnings export (real payouts) when the export click succeeds.
- `raw/reservations-<date>.json` - scraped reservation rows (fallback).
- `raw/bookings-normalized.json` - clean data for Notion.
- `outputs/airbnb-host/<date>/airbnb-studio-income-model.xlsx` - filled, live formulas.

## First real run is a TUNE run (be ready for this)
Airbnb's page markup changes and could not be tested from inside the agent. If the export
button or reservation rows aren't found, the script still saves screenshots + HTML to
`raw/_debug/`. Send me those (or just run `/airbnb-host` and tell me it came up empty) and I
fix the selectors against what your account actually renders. Expect one tuning pass, then it's stable.

## Risk + hygiene (you accepted these)
- Automating the account is against Airbnb ToS; bot-detection could flag/limit you. Read-only + human pacing keeps it low, not zero. Keep runs occasional (e.g. weekly), not every few minutes.
- `.browser-profile/` holds your live session = **as sensitive as your password**. Never copy it into the vault, never share it, never commit it.
- If you ever feel uneasy, delete `.browser-profile/` to kill the saved session and fall back to the Gmail feed.

## Cadence
Scheduled monthly on the 24th (Task Scheduler `PersonalOS-airbnb-host`) + on-demand (`/airbnb-host`).
**The scheduled run uses `--headless` (fix 2026-07-14):** a headed browser can't launch unattended under
Task Scheduler - it hangs to a 180s launch timeout (that was the 06-24 failure, NOT an expired login).
Headless reuses the same `.browser-profile` session read-only. Detection-risk note: headless is more
detectable than headed, so the cadence stays occasional (monthly) and read-only. Manual runs you start
yourself stay headed.

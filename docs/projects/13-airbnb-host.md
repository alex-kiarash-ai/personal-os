# 13 — Airbnb Host

## What it actually does
Tracks an Airbnb hosting operation (a studio apartment) without any official API — Airbnb doesn't offer hosts one. Two feeds: daily, the Gmail notifications (express@/automated@airbnb.com) are parsed for bookings, pending requests, and arrivals, which get flagged into the morning brief; monthly (the 24th), a browser session reads the host dashboard itself and rebuilds the income model — payouts into a Notion Bookings database and a branded Excel with real formulas. Guests stay transactional: no people pages for them, by standing rule.

## Why it exists
The apartment is a real income stream and it deserves real books: occupancy, payouts, pending requests that expire if missed. The e-mail-parsing approach exists purely because there's no host API — it's the honest workaround, read-only and unbannable. Phase 2 (drafted, gated): voice-matched guest reply drafts, behind the same never-auto-send rule as everything else.

## Works together with
- **[Morning Brief](02-morning-brief.md)** — booking flags, arrival reminders, pending-request alarms.
- **vault/me/situation** — payout totals feed the budget math.
- **[Expense Wrangler](08-expense-wrangler.md)** — the expense side of the same household picture.
- **[Alex HQ](16-alex-hq.md)** — income metrics on the dashboard.

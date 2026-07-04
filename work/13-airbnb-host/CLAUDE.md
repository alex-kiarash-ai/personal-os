# Airbnb Host

## Type
Automation

## Purpose
Track Shaheen's Airbnb hosting of a studio apartment entirely from the Gmail feed, because Airbnb has no host API and no usable MCP (official API is partner-only; community MCPs are guest-side listing search only). Two jobs: (1) **track + flag** — maintain an occupancy calendar, log every booking, and surface pending requests and unanswered guest messages into the [[morning-brief]]; (2) **income tracker** — parse payout emails into a Notion Bookings DB and a branded Excel income model with REAL formulas (occupancy %, nightly average, monthly net) that feeds [[me/situation]]. Knowledge lives at [[me/airbnb-studio]].

## Entry Points
- **Folded into /morning-brief:** the daily brief already reads Gmail; it surfaces Airbnb pending requests (URGENT, they expire) and guest messages. No separate schedule.
- **On-demand:** `/airbnb-host` — full status: occupancy calendar, upcoming arrivals, booking log, income-to-date, and (when asked) regenerate the branded Excel model.

## Data Access (decided 2026-06-14)
Shaheen chose **browser automation over the Gmail feed** (he wants his actual account data, not email-derived). Reality check that drove it: Airbnb has no host API, no usable MCP, and this agent session has no browser tool (WebFetch dies on authenticated pages). So access is a **local, read-only Playwright harvest of his own logged-in dashboard**:
- `scrape_airbnb.py` — persistent Chromium profile (login + 2FA once, session reused), pulls the official earnings CSV + scrapes reservations. NEVER sends/accepts/declines/edits. Saves to `raw/` + `raw/_debug/` (screenshots + HTML for selector tuning).
- `ingest_airbnb.py` — parses `raw/` (pandas) into the Excel model (formulas re-applied) + `raw/bookings-normalized.json` for Notion.
- See `RUNBOOK.md`. Risks accepted by Shaheen: ToS-gray, bot-detection, fragile selectors. Mitigations: read-only, human pacing, occasional cadence, `.browser-profile/` treated as a secret (gitignored, never in vault).
- Gmail feed remains the **fallback** if the browser route is killed.

## Tools Used
- **Playwright (local, read-only)** — primary account data source (see above).
- **Gmail MCP** — fallback / morning-brief fold-in. Booking feed:
  - `express@airbnb.com` — guest messages, reservation confirmations.
  - `automated@airbnb.com` — **pending requests** (accept/decline, time-limited), check-in reminders, login/security alerts, **payout** notifications.
  - Search pattern: `from:(express@airbnb.com OR automated@airbnb.com) newer_than:{window}`. `get_thread` to read full body when a snippet can't yield dates/amount/guest.
- **Notion MCP** — Airbnb Bookings DB under the Personal OS parent (Bootstrap Protocol).
- **/xlsx skill** — branded income model with real SUMIFS/SUMIF/AVERAGEIF formulas. Never hardcoded values.
- No Chrome. No Airbnb API (does not exist for individual hosts).

## What gets parsed from email
| Signal | From | Action |
|---|---|---|
| Pending reservation request | automated@ "Pending: Reservation Request..." | URGENT in brief (expires). Log as `pending`. |
| Reservation confirmed | express@ "Reservation for..." | Log/upgrade booking to `confirmed`, set dates + guest. |
| Guest message | express@ "RE: Reservation..." | Surface as needs-reply; do NOT draft in v1 (see Phase 2). |
| Check-in reminder | automated@ "Reservation reminder: X is coming soon!" | Flag upcoming arrival in brief. |
| Payout | automated@ payout/earnings email | Parse amount + dates -> income DB row. |
| Login/security alert | automated@ | FYI only, not a booking. |

## Notion Integration
**Airbnb Bookings** database under the [[projects/notion-parent-id|Personal OS parent]]:
- Schema:
  - Booking (title, e.g. "Guest name — dates")
  - Guest (text)
  - Check-in (date)
  - Check-out (date)
  - Nights (number)
  - Status (select: Pending, Confirmed, Completed, Declined, Cancelled, Inquiry)
  - Payout SEK (number)
  - Source Email Date (date)
  - Notes (text)
- View: "Calendar" by Check-in; "Upcoming" table filtered Status=Confirmed/Pending sorted Check-in asc; "Income" table sorted Source Email Date desc.
- Every row carries full readable detail in page `content` (guest blurb, message context, dates, amount).
- IDs stored in vault/projects/airbnb-host/status.md after bootstrap.

## Vault Structure
- **Tier 1:** vault/projects/airbnb-host/status.md — Notion IDs, last run, current occupancy snapshot, income-to-date.
- **Tier 2:**
  - vault/projects/airbnb-host/bookings/ — per-booking notes / history if a stay needs detail.
  - vault/projects/airbnb-host/history/YYYY-MM-DD.md — on-demand run snapshots.
- Knowledge: [[me/airbnb-studio]] (the listing, setup, current bookings table, data gaps).

## Vault Reads
- soul.md (voice for any user-facing output)
- [[me/airbnb-studio]] (listing facts, known bookings)
- [[me/situation]] (income tracker feeds it)
- brand/config/brand-config.md (only when generating the Excel model)
- vault/projects/morning-brief/status.md (to coordinate the daily fold-in)

## Vault Writes
- [[me/airbnb-studio]] bookings table kept current after every run.
- vault/projects/airbnb-host/status.md (last run, occupancy, income-to-date).
- vault/projects/airbnb-host/history/ snapshot on on-demand runs.
- vault/log.md entry; vault/index.md on new pages.

## Connections
- **Fed by:** Gmail (booking feed). Coordinates with [[morning-brief]] (which surfaces the daily Airbnb line).
- **Feeds into:** [[morning-brief]] (pending requests + arrivals), [[me/situation]] (income model), [[me/airbnb-studio]] (booking log).

## Post-Run (mandatory)
1. Guests stay transactional — do NOT create vault/people/ pages for ANY Airbnb guest. **Confirmed by Shaheen 2026-06-14:** all guests (including repeat bookers) stay transactional, living only in the Airbnb Bookings DB + Excel model. Do not re-ask. Never auto-promote a guest to people/.
2. No new companies expected (Airbnb is the platform, already known).
3. [[wiki links]] between status, [[me/airbnb-studio]], [[me/situation]], [[morning-brief]].
4. Update Notion Bookings DB rows (with full `content`).
5. Update vault/index.md if new pages.
6. Update vault/log.md.
- Alex HQ metrics push (added 2026-07-02): POST the run's key metric(s) to the build #16 ingest webhook per the contract in work/16-alex-hq/CLAUDE.md; exact curl in .claude/commands/airbnb-host.md. Failure-tolerant, token never printed.

## Phase 2 (deferred, not in v1)
Voice-matched guest-reply drafts (soul.md, per-language register) staged to **Gmail drafts behind a HARD draft gate** — never sends. Same pattern as [[email-triage]]/[[personal-crm]]. Build only when Shaheen asks.

## Implementation Notes (as built)
- Created 2026-06-14 via /new. Notion Bookings DB bootstrapped same day (3 views, 3 rows seeded).
- Income model Excel built 2026-06-14 (real formulas) -> outputs/airbnb-host/2026-06-14/.
- Browser automation built 2026-06-14: scrape_airbnb.py + ingest_airbnb.py + RUNBOOK.md. Deps installed (playwright, chromium, pandas). Scripts compile clean. NOT yet run against live Airbnb — needs Shaheen's first `--setup` login, and a selector-tuning pass on first real run (debug artifacts land in raw/_debug/).
- Current bookings seeded from [[me/airbnb-studio]] (guest names + dates kept local, out of the spec).
- Income gaps: nightly rate + monthly net unknown until payout emails are parsed; flagged in [[me/airbnb-studio]].

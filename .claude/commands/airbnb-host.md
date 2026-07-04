# /airbnb-host - Airbnb Hosting Tracker + Income

Spec: work/13-airbnb-host/CLAUDE.md (read it first). Knowledge: vault/me/airbnb-studio.md.

## Bootstrap (first run only)
Read vault/projects/airbnb-host/status.md. If `db_id` is `(pending bootstrap)`, create the **Airbnb Bookings** DB under the Personal OS parent (Bootstrap Protocol + Notion creation sequence in root CLAUDE.md): create -> move-pages -> ALTER COLUMN for Status select options -> create views -> save db_id + data_source_id to status.md.

## Monthly-sync mode (scheduled job)
If invoked with "monthly-sync" (the Task Scheduler wrapper already ran scrape + ingest this run): do NOT re-scrape. Skip straight to reading `raw/bookings-normalized.json`, upsert the Notion Bookings DB, refresh the vault pages + log, and flag new pendings/discrepancies. The Excel model is already rebuilt by the wrapper.

## Primary: browser harvest (Shaheen's chosen path, 2026-06-14)
Data comes from a local read-only Playwright harvest of his own dashboard, not Gmail.
1. Confirm `work/13-airbnb-host/.browser-profile/` exists. If not, tell him to run the one-time login: `python work/13-airbnb-host/scrape_airbnb.py --setup` (see RUNBOOK.md).
2. Run `python work/13-airbnb-host/scrape_airbnb.py` then `python work/13-airbnb-host/ingest_airbnb.py`. (Scripts are read-only; never auto-accept/decline/send.)
3. If the harvest comes up empty, read `raw/_debug/*.png` + `*.html` and TUNE the selectors in scrape_airbnb.py against what his account renders. Expect this on first real run.
4. Read `raw/bookings-normalized.json` -> upsert the Notion Bookings DB (rows by guest+dates: Status, dates, Nights, Payout SEK, full `content`). The Excel model is already filled by ingest.
5. Update vault/me/airbnb-studio.md bookings table + vault/projects/airbnb-host/status.md (occupancy, income-to-date) with [[wiki links]].

## Fallback: Gmail feed (if browser route is killed)
- Gmail: `search_threads` `from:(express@airbnb.com OR automated@airbnb.com) newer_than:{window}` (default 30d). `get_thread` when a snippet lacks dates/amount/guest. Classify per spec table. Same Notion/vault writes.

## Always
- Surface pending requests (they EXPIRE) and unanswered guest messages prominently — these are the action items.
- Excel model lives at outputs/airbnb-host/YYYY-MM-DD/airbnb-studio-income-model.xlsx (real formulas, written by ingest_airbnb.py).

## Daily fold-in (no separate run)
The morning brief reads Gmail anyway. It surfaces Airbnb pending requests as URGENT and arrivals/guest messages as context. This command is for the deeper on-demand pull.

## Phase 2 (deferred — only if Shaheen asks)
Voice-matched guest-reply drafts to Gmail behind a HARD draft gate. Never auto-send.

## Post-Run
- Do NOT auto-create people pages for one-off guests (transactional). Only on Shaheen's say-so (repeat/relationship) via People Intake Protocol.
- [[wiki links]] across status, me/airbnb-studio, me/situation, morning-brief.
- vault/log.md entry; vault/index.md if new pages.
- **Alex HQ metrics push** (build #16 contract, work/16-alex-hq/CLAUDE.md). Never let a push failure fail the run; never print or log the token:
  `curl -s -m 10 -X POST https://n8n.shaheenkiarash.com/webhook/alex-push -H "Content-Type: application/json" -H "X-Alex-Token: $(cat work/16-alex-hq/config/alex-hq-token.txt)" -d '{"project":"airbnb","metric_key":"ytd_income_kr","value_num":{YTD payout total},"headline":"{next arrival / incoming payout / pending request}","status":"{amber if a pending request risks expiring, else green}"}' || true`

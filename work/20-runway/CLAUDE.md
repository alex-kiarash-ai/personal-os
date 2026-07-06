# Runway Command Center

## Type
Automation (monthly, last day of month, runs after /expense-wrangler + on-demand /runway). Built from roadmap brief 04, 2026-07-06.

## Purpose
Joins the three money signals Alex already holds into the one number that matters on the layoff clock: how many months the money lasts. Starting liquid savings, minus a confirmed monthly burn, plus the scheduled inflows (full salary to the notice-period end, the 4-month severance lump sum in Oct 2026, a-kassa step-downs, and Airbnb payouts), modelled month by month to a zero date. Tests income scenarios (a new job at SEK X from month Y). Output is a branded, all-formula SEK Excel. Informational only, never touches money.

## Entry Points
- Scheduled: monthly, last day, right AFTER /expense-wrangler (so it reads the freshest expense + booking data).
- On-demand: `/runway` (rebuild the model), `/runway <scenario>` (test a what-if, e.g. "job at 70k from October").

## Tools Used
- Notion MCP: `notion-query-data-sources` (read the Expenses DB + Bookings DB; no writes, no new DB).
- `/xlsx` skill for the branded workbook (real formulas, never hardcoded).
- Vault read/write (situation, status, history, log, index).
- No Chrome. No outward actions. No money movement.

## Data Sources (all live, verified 2026-07-06)
- **Burn:** a confirmed monthly number in the Inputs sheet. The Expenses DB total is shown only as a flagged cross-check because it understates real burn (one run, June = [local-only figure], excludes the Klarna aggregate statement, Bank Norwegian, and unmatched-FX rows).
- **Airbnb income:** Bookings DB `db_id 6e1794cc-1297-4449-96c2-451a46c2f4ea` / `data_source cdf3fd19-ff61-485d-90fb-6606f50c510a` (a YTD figure (kept local-only in vault/me/situation.md)).
- **Expenses DB (cross-check only):** `db_id 225b2c6c-a34c-4518-9db4-ba4bd06dad63` / `data_source ef881285-4d96-461f-a905-72e161a91532`.
- **Salary / severance / a-kassa timeline:** `vault/me/situation.md` - full salary through the notice-period end; 4-month severance as a lump sum Oct 2026 (avräkningsfritt, a new job does not reduce it); a-kassa step-downs after; a later planning cliff; an expected-salary target (local-only).

## Notion Integration
None by design. Runway READS the Expenses + Bookings DBs and computes; the deliverable is the Excel + the status page. (Phase 2 option: a "Runway Snapshots" log DB for month-over-month trend.)

## Vault Structure
- **Tier 1:** `vault/projects/runway/status.md` - latest runway months, zero date, monthly burn used, starting savings used, output path, last_run.
- **Tier 2:** `vault/projects/runway/history/YYYY-MM.md` - monthly snapshot (runway months, zero date, the assumptions) for trend.

## Vault Reads
- `soul.md` (voice; runway serves priority #1/#2, the paycheck).
- `vault/me/situation.md` (the salary/severance/a-kassa timeline + expected salary).
- `vault/projects/airbnb-host/status.md` + Bookings DB (income).
- `vault/projects/expense-wrangler/status.md` + Expenses DB (burn cross-check).
- `vault/me/goals.md` (context).

## Vault Writes
- `vault/projects/runway/status.md` (every run).
- `vault/projects/runway/history/YYYY-MM.md` (monthly snapshot).
- `vault/me/situation.md`: a one-line runway figure + `[[projects/runway/status]]` link.
- `vault/log.md`, `vault/index.md`.

## Excel (the deliverable)
SEK throughout, all real formulas, ALEX brand (headers `#005F73` white bold Calibri, alt rows `#FFFFFF`/`#FFF5E1`, ONE `#EE9B00` KPI per sheet, negative/alert `#AE2012`). Sheets:
- **Inputs** (yellow cells the user fills/confirms): starting liquid savings, monthly burn (confirmed), Airbnb avg/month, a-kassa monthly estimate + start month, scenario salary + scenario start month.
- **Timeline:** month-by-month rows (salary/severance in, a-kassa in, Airbnb in, scenario job in, total in, burn out, net, cumulative balance). Zero date = the first month cumulative balance goes negative (formula-driven).
- **Scenarios:** base vs "new job at SEK X from month Y" side by side (runway months + zero date for each).
- **Dashboard:** KPI cards (runway months, zero date, monthly burn, avg income). One orange accent.
- Output: `outputs/runway/YYYY-MM-DD/runway-model.xlsx`.

## Alex HQ
OFF by default (Shaheen removed the runway tile in the HQ v2 redesign, 2026-07-04). Phase 2 option: push a single runway figure + a morning-brief threshold line if runway drops below N months.

## Connections
- **Fed by:** expense-wrangler (Expenses DB), airbnb-host (Bookings DB), `me/situation`.
- **Feeds into:** `me/situation` (runway line), Interview-to-Offer (roadmap brief 05, planned as work/21; its negotiation module reads the runway view), morning brief (optional threshold line). NOTE: live work/05 is /personal-crm; the interview copilot is a separate future build.

## Post-Run (mandatory)
1. `status.md` refreshed (runway months, zero date, burn + savings used, output path).
2. `history/YYYY-MM.md` snapshot written.
3. `me/situation.md` runway line updated + `[[link]]`.
4. `vault/index.md` + `vault/log.md` updated.
5. Temp build artifacts deleted; only the `.xlsx` remains in the dated output folder.

## Close-Out Extras
- Every run records the runway months + zero date + the exact monthly burn AND starting-savings assumptions used.
- If burn or savings is still a placeholder (unconfirmed), the run reports **PARTIAL** and states the number is not yet trustworthy. Never present a fantasy zero date as real.
- Output path recorded in `status.md`.

## Guardrails
- Informational, not financial advice. Every assumption labelled. Never moves money, never touches accounts.
- Arithmetic lives in Excel formulas, never model-guessed.
- Income scenarios override the income line from the chosen month forward; they never delete the base case.

## Build status
- **2026-07-06:** scaffolded from roadmap brief 04 via `/new`. Command, status page, routing row, Excel build to follow once the confirmed monthly burn + starting savings land.

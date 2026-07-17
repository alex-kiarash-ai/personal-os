# Expense Wrangler

## Type
Automation (monthly scheduled + on-demand, two modes, same command)

## Purpose
One command to capture expenses and produce a company-grade report. **Immediate mode:** paste a receipt photo, type "$45 lunch at a cafe today", or forward a receipt - it OCRs/parses it, classifies it, adds it to the Notion Expenses DB, appends a row to the current month's Excel (creating the workbook if needed), saves the receipt to the vault, and confirms. **Batch mode:** with no input, it scans Gmail for forwarded receipts since the last run, processes every file in inbox/ (photos, bank CSVs, bank PDFs), cross-references against the bank, and regenerates the full 4-sheet branded Excel. The monthly cron runs batch mode. Both modes share one Notion DB and one Excel file. **Every total in the Excel is a real formula (SUMIFS/SUMIF/SUMPRODUCT), never a hardcoded value.**

## Entry Points
- **Scheduled:** last day of each month (Task Scheduler `PersonalOS-expense-wrangler`, batch mode).
- **On-demand:** `/expense-wrangler <receipt/text/photo>` (immediate) · `/expense-wrangler` with no input (batch).

## Tools Used
- Gmail MCP: search_threads (forwarded receipts, order confirmations since last run).
- Python: OCR receipt images (pytesseract/Tesseract if available; else Read-tool vision as fallback), parse bank CSVs, parse bank PDFs (Read tool), and build/refresh the Excel via `build_workbook.py` + append logic (openpyxl).
- Read tool: receipt photos + bank PDFs (vision/text).
- Chrome: bank login + scrape transactions for cross-reference (batch mode only; verify each expense against a real bank line → Status Verified/Unmatched/Flagged). Never for Gmail/Notion.
- Notion MCP: notion-create-pages / notion-update-page (Expenses rows).
- /xlsx + /xlsx-manipulation skills available; the workbook is built with openpyxl for precise formula control (real formulas, brand styling).
- Skill: pdf (advisory, 2026-07-11) - parse PDF receipts + bank PDFs with it (text/tables/OCR) before falling back to Read-tool vision.

## Receipt → expense extraction
Per receipt/line: Vendor, Date, Amount, Category (via categories.md + vendors.md), Tax Deductible (default per category, human overrides), Notes, Status. OCR-low-confidence or unusually large → Status Flagged. Unknown vendor → infer + append to vendors.md, Status Unmatched until bank-matched.

## Notion Integration
**Expenses** database under the Personal Ops System parent page (ID in vault/projects/notion-parent-id.md).
- db_id: 225b2c6c-a34c-4518-9db4-ba4bd06dad63 · data_source: ef881285-4d96-461f-a905-72e161a91532
Columns: **Vendor** (title), **Date** (date), **Amount** (number, `number_with_commas` - values are SEK), **Category** (select: Meals/Travel/Software/Office/Subscriptions/Other), **Tax Deductible** (checkbox), **Notes** (text), **Status** (select: Verified/Unmatched/Flagged).
Views: **This Month** (Date set, desc) · **By Category** (board) · **Flagged** (Status = Flagged).
Each row's content holds the readable detail (what/why, receipt reference). Notion is for browsing; the Excel is the report.

## The Excel (outputs/expense-wrangler/expense-tracker.xlsx)
Built by `work/08-expense-wrangler/build_workbook.py` (reusable; re-run to regenerate). 4 sheets, brand-styled (ALEX brand since 2026-07-03: Dark Teal header #005F73/white bold, alt-row tint #FFF5E1, SEK `#,##0.00 "kr"`):
1. **Expense Log** - raw rows. Date, Vendor, Amount, Category, Tax Deductible, Status, **Month** + **Quarter** (formula-derived from Date: `TEXT(DATEVALUE(date),"YYYY-MM")` and `YEAR&"-Q"&ROUNDUP(MONTH/3)`).
2. **Monthly Summary** - months × categories, each cell `=SUMIFS(Log Amount, Log Month, month, Log Category, cat)`; row + grand totals via SUM.
3. **Quarterly Summary** - `=SUMIFS` by Quarter, **QoQ Change %** = `(Q - prevQ)/prevQ` (blank when prior = 0).
4. **Category Breakdown** - `=SUMIF` total per category, **% of Total** = cat/grand, **Avg/Month** = total / distinct-month count (`SUMPRODUCT` helper in G3).
Summary formulas reference WHOLE COLUMNS of the log ($C:$C, $G:$G, $H:$H), so they hold as rows are added.
**Append rule (immediate mode):** insert the new expense row in Expense Log AND write its Month (col G) + Quarter (col H) formulas for that row. Summaries auto-update. Recalc/verify via LibreOffice headless before declaring done.
**Uncaptured-burn line (upgrade P6, 2026-07-12, audit b20/design #08 row):** every monthly batch close adds ONE explicit row to the Monthly Summary area: **"Uncaptured burn (est.)"** = Shaheen's confirmed real monthly burn (vault/projects/runway/status.md frontmatter `monthly_burn_sek`, the figure in vault/projects/runway/status.md (gitignored)) MINUS the month's tracked total, floored at 0 - a visible number for what the tracking missed (Klarna aggregate, Bank Norwegian, unmatched FX), never a silent gap. Label it estimate; #20 runway inherits honest inputs from it.

## Vault Structure
- **Tier 1:** vault/projects/expense-wrangler/status.md - DB IDs, Excel path, last run, monthly totals snapshot.
- **Tier 2:** vault/projects/expense-wrangler/receipts/ - saved receipt images/data (the source artifacts). vault/projects/expense-wrangler/history/YYYY-MM.md - monthly close summary.

## Vault Reads
- brand/config/brand-config.md (Excel styling), categories.md + vendors.md (classification), soul.md (tone for any confirmations), vault/projects/shared-infrastructure.md (known recurring vendors).

## Vault Writes
- Receipt artifacts → vault/projects/expense-wrangler/receipts/.
- status.md (totals, last run) + monthly history. vault/index.md (new pages), vault/log.md (every run).

## Connections
- **Fed by:** Gmail receipts, inbox drops, bank (Chrome).
- **Feeds into:** the finance picture in [[me/situation]] (monthly burn), future tax prep. Reports Done to the sprint board.

## SCHEDULED ONE-TIME: the alex-costs merge (P9a / D10, DUE at the 2026-07-31 monthly close)
**The 2026-07-31 batch-mode run MUST also execute the alex-costs merge and close it 100% (Shaheen deferred it to the due date, 2026-07-13).** Build it into THIS run, do not defer again:
1. Add an **"Alex Costs"** sheet to `build_workbook.py`: what Alex itself costs to run (Anthropic/Claude plan, n8n/Hetzner box, any API spend), all REAL formulas (=SUM/=SUMIFS, never hardcoded), brand-styled like the other sheets. NOTE (corrected 2026-07-13): alex-costs is NOT a never-fired scaffold - it FIRST FIRED 2026-07-02/03 (a real 4-sheet Excel + a 26-measure Power BI dashboard, [[projects/alex-costs/status]]) and the ~1,032 kr/mo is a MODELED run-rate, not a raw assumption. So this merge CONSOLIDATES that monthly refresh INTO the expense close (one monthly money run, not two) and refreshes the figure with the current month's actuals; it does not "discover" the number.
2. Resolve the 0-byte `alex-cost-dashboard.pbip` reported by audit lane e (the real .pbip is at `outputs/alex-costs/2026-07-03/`; find + delete the stray 0-byte one, or confirm which is canonical) - never leave it ambiguous.
3. Re-state the registry: `system/manifest.json` meta.unnumbered alex-costs → RETIRED/absorbed per D10 (keep the `hq_project` slug so its HQ tile survives) AND stamp `first_fire: "2026-07-02", first_fire_kind: "live"` (correcting the audit-false null, same class as runway b19 + meeting-intel a8), then `node scripts/generate-alex.js`.
4. Propagate: alex-costs status.md (merged + current figure), vault/log.md, the Alex Upgrade Plan Notion board P9a row → Done.
This is the LAST open build item of the run-24 upgrade program (with P3v's 08-01 verify); the whole program closes when both land.

## Post-Run (mandatory)
1. New vendor → vendors.md. New recurring merchant of note → vault/business/ only if it matters (not every café).
2. [[wiki links]] between status, receipts, me/situation.
3. Notion rows created/updated; Excel regenerated + recalc-verified.
4. vault/index.md + vault/log.md updated.
5. Sprint board: Done on first build (2026-06-12).
6. Clean temp: delete any recalc/ dir and *.tmp; keep only expense-tracker.xlsx in outputs/expense-wrangler/.
- Alex HQ metrics push (added 2026-07-02): POST the run's key metric(s) to the build #16 ingest webhook per the contract in work/16-alex-hq/CLAUDE.md; exact curl in .claude/commands/expense-wrangler.md. Failure-tolerant, token never printed. Two keys since 2026-07-06: `mtd_total_kr` + `mtd_by_category` (per-Category sums for current-month rows, compact `"Travel 1273.63 · Meals 474"` value_text — feeds the HQ expenses tile + drill-down). BOTH modes push, immediate single-receipt mode included, so the tile isn't a month behind until the last-day close.

## Implementation Notes (as built, 2026-06-12)
- Expenses DB + 3 views created. Branded 4-sheet workbook built and **recalc-verified through LibreOffice** with seed data (April 560, grand 1350, Software 330, %-of-total 1.0, QoQ blank for Q1) - all formulas computed cleanly, zero errors. Delivered EMPTY (no example rows) so the live financial file starts clean.
- `build_workbook.py` is the reusable generator (kept in the work folder, not outputs). Pass `--empty` for a clean file.
- **Currency:** SEK (kr) throughout. Excel uses `#,##0.00 "kr"`. Notion Amount set to `number_with_commas` (no symbol - Notion has no SEK format) so nothing implies USD. All amounts are kronor.
- OCR: uses Tesseract if installed, else the Read tool's vision on the receipt image (no hard dependency at build).
- No real expense processed at build (first receipt/batch run starts the data).

## Trifecta
Gate: **read-only**. Legs: private_data=true, untrusted_content=true, external_comm=false (agent-security Rule-of-Two, three-plan validation P3, 2026-07-17). Private finances + untrusted vendor receipts; writes internal Notion/Excel only. Source of truth: the `trifecta` block in system/manifest.json + [[research/trifecta-map]]. Validator V12 fails the build if this gate stops matching the manifest.

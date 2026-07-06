# /expense-wrangler - Capture Expenses + Branded Excel Report

Spec: work/08-expense-wrangler/CLAUDE.md (read it first). Two modes, same command.

## Immediate (input given)
`/expense-wrangler <receipt photo | "$45 lunch at a cafe today" | forwarded receipt>`
1. Parse the input (OCR image via Tesseract or Read-tool vision; or parse the typed text/date).
2. Classify via work/08-expense-wrangler/categories.md + vendors.md (unknown vendor → infer + append to vendors.md, Status Unmatched).
3. Add a row to the Expenses Notion DB (full detail in page content). Save the receipt to vault/projects/expense-wrangler/receipts/.
4. Append the row to `outputs/reports/expense-tracker.xlsx` Expense Log AND write its Month (col G) + Quarter (col H) formulas. Summaries auto-update.
5. Recalc-verify via LibreOffice headless. Confirm to the user (vendor, amount, category, deductible).

## Batch (no input) - also the monthly cron
1. Gmail search_threads for forwarded receipts / order confirmations since last run (status.md last_run).
2. Process every file in work/08-expense-wrangler/inbox/ (photos, bank CSVs, bank PDFs).
3. Chrome: log into the bank, scrape transactions, cross-reference each expense → Verified / Unmatched / Flagged.
4. Regenerate the full Excel (re-run build_workbook.py with the accumulated data) + recalc-verify.
5. Write the monthly close to vault/projects/expense-wrangler/history/YYYY-MM.md.

## Rules
- **ALL Excel totals are formulas** (SUMIFS/SUMIF/SUMPRODUCT) - never hardcode a sum.
- Notion DB id in status.md. Always write readable detail to row content.
- Flag unusually large or low-confidence items rather than guessing. Never assert tax-deductibility on a guess.
- Clean temp (recalc dirs, .tmp); keep only expense-tracker.xlsx in outputs/reports/.

## Post-Run
- vendors.md updated for new vendors. status.md (totals, last_run) + monthly history. vault/index.md (new pages) + vault/log.md.
- Do NOT re-mark the sprint row (Done at build).
- **Alex HQ metrics push** (build #16 contract, work/16-alex-hq/CLAUDE.md) — BOTH modes push, including the single-receipt immediate mode (the tile must move the day a receipt lands, not on the monthly close). Push BOTH events in one call: `mtd_total_kr` and `mtd_by_category` (added 2026-07-06 — sum Amount per Category for rows with Date in the CURRENT month, SEK; `value_text` is the compact string `"Travel 1273.63 · Meals 474 · Software 323.33 · Other 155"`, categories ≤6; when the month has no rows yet use `value_num` 0 and `value_text` `"no expenses captured yet for {Month}"`). Never let a push failure fail the run; never print or log the token:
  `curl -s -m 10 -X POST https://n8n.shaheenkiarash.com/webhook/alex-push -H "Content-Type: application/json" -H "X-Alex-Token: $(cat work/16-alex-hq/config/alex-hq-token.txt)" -d '{"events":[{"project":"expenses","metric_key":"mtd_total_kr","value_num":{month total},"value_text":"{Month}: {total} kr / {deductible} kr deductible","status":"green"},{"project":"expenses","metric_key":"mtd_by_category","value_num":{month total},"value_text":"{Cat1 sum · Cat2 sum · ...}","headline":"{Month} MTD by category","status":"green"}]}' || true`

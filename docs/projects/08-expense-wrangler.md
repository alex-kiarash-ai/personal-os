# 08 — Expense Wrangler

## What it actually does
Captures expenses from anywhere — a photo of a receipt, a typed line, Gmail receipts, bank statements — and files each into a Notion Expenses database with category and deductibility. On the last day of each month it runs the batch pass and regenerates a branded 4-sheet Excel report where **every figure is a real formula** (SUMIFS, quarter-over-quarter, category breakdowns), so the workbook is usable and auditable standalone, not a dead printout.

## Why it exists
A side venture (STEMPLICITY) plus personal spending means every krona needs a home: personal versus deductible drives the tax picture. Manual expense tracking is the chore everyone abandons by March; making capture instant (photo → filed) is the only version that survives. The real-formulas rule exists because a spreadsheet you can't interrogate is just a picture of numbers.

## Works together with
- **vault/me/situation** — the monthly budget totals feed it.
- **[Airbnb Host](13-airbnb-host.md)** — the income side of the same household ledger.
- **[Weekly Exec Report](10-weekly-exec-report.md)** — quotes the month's spend.
- **[Alex HQ](16-alex-hq.md)** — the expense figures on the dashboard trace back here.

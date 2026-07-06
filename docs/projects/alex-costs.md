# Alex Cost Tracker (unnumbered, on-demand)

## What it actually does
Answers "what does Alex itself cost?" with real deliverables: a branded Excel where every figure is a live formula, and a three-page Power BI dashboard (a real semantic model with 26 measures, built through the Power BI modeling connector) covering spend by category, cash versus accrual, and a forecast based on top-up cadence. Refreshes monthly alongside the expense run; the Excel twin lives on Google Drive.

## Why it exists
The whole system runs on a runway measured in months. An AI agent that does not know its own burn rate would be an irony too far: roughly 3,400 kr total April through July, about 1,030 kr per month run rate, with the shortening top-up interval tracked as the honest burn signal.

## Works together with
- **[Expense Wrangler](08-expense-wrangler.md)** - shares the monthly refresh slot and the expense data.
- **[Runway](20-runway.md)** - Alex's own cost is one of the burn lines the zero-date model absorbs.

# /runway - Runway Command Center

Full spec: `work/20-runway/CLAUDE.md` (read it first).

One honest answer to "how many months do I have, and what changes it?" Joins starting savings + burn + the salary/severance/a-kassa timeline + Airbnb income into a month-by-month model with a zero date, in a branded all-formula SEK Excel. Informational only, never moves money.

## Modes
- `/runway` - rebuild the model from the latest data and the confirmed Inputs, refresh the Excel + status.
- `/runway <scenario>` - test a what-if, e.g. "job at 70k from October" or "burn down to 30k". Adds/updates the scenario column.

## Steps the command executes
1. **Read the confirmed Inputs** from `vault/projects/runway/status.md` (starting savings, monthly burn, a-kassa estimate) - these are Shaheen-confirmed numbers, NOT scraped. If burn or savings is still a placeholder, run reports PARTIAL and says the zero date is not yet trustworthy.
2. **Pull Airbnb income** from the Bookings DB (`data_source cdf3fd19-ff61-485d-90fb-6606f50c510a`) - trailing average monthly payout.
3. **Cross-check burn** against the Expenses DB (`data_source ef881285-4d96-461f-a905-72e161a91532`) - shown as a flagged reference only (it understates real burn).
4. **Read the timeline** from `vault/me/situation.md` (salary to the notice-period end, severance lump Oct 2026, a-kassa step-downs, a salary target (local-only)).
5. **Build the month-by-month model** in Excel (Inputs / Timeline / Scenarios / Dashboard), all real formulas, SEK, ALEX brand from `brand/config/brand-config.md`. Zero date = first month the cumulative balance goes negative.
6. **Save** to `outputs/runway/YYYY-MM-DD/runway-model.xlsx`. Delete all temp build artifacts.
7. **Post-run:** refresh `status.md` (runway months, zero date, assumptions, output path), write `history/YYYY-MM.md` snapshot, update the runway line + `[[link]]` in `me/situation.md`, update `vault/index.md` + `vault/log.md`.

## Guardrails
- Never present a placeholder-based zero date as real. Flag every unconfirmed assumption.
- Informational, not financial advice. Never touches money or accounts.
- Real Excel formulas only.

## Close-Out
Print the Close-Out Report. Runway extras: record runway months + zero date + the exact burn AND starting-savings assumptions used; PARTIAL if either is still a placeholder.

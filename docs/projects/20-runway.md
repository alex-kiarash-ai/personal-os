# 20 - Runway Command Center

**What it is (plain version):** the one honest answer to "how many months do I have, and what changes it?" Alex already tracks what Shaheen spends, what his Airbnb earns, and the layoff timeline (salary, severance, a-kassa). Runway joins them into a single month-by-month model that shows the date the money hits zero, and lets him test what a new job or a spending change does to it.

**Why it exists:** money on the layoff clock is the most stressful real thing in Shaheen's life, and every input already lived in the system unjoined. This turns scattered data into one calm, current number instead of background dread. It is priority-one adjacent (the paycheck) and a clean proof that Alex handles real life, not toys.

**How it works:**
- Two numbers are Shaheen's own and confirmed: starting savings and monthly burn. Everything else (current salary, severance, a-kassa) is a clearly-flagged, editable assumption in the Inputs tab, because his real current salary is not stored.
- A branded SEK Excel with all real formulas: Inputs / Timeline (base case) / Scenarios (with a new job) / Dashboard (KPIs: runway months, zero date, zero date if a job lands). Change any input and the whole model recomputes.
- Reads the Expenses DB (burn cross-check), the Bookings DB (Airbnb income), and me/situation.md (the timeline). Writes an Excel + a status page. No Notion DB, no money movement, informational only.

**First run (2026-07-06):** on the seeded assumptions, base runway is 26 months (zero date Sep 2028); a job at the 70k target erases the cliff. The number rests on the current-salary placeholder, which Shaheen should correct for a true figure.

**Connects to:** fed by expense-wrangler (#08) and airbnb-host (#13) and me/situation; feeds the planned Interview-to-Offer copilot (roadmap brief 05, to be built as work/21), whose negotiation module reads the runway view.

**Command:** `/runway` (rebuild) or `/runway <scenario>` (test a what-if). Schedule: monthly, last day, after the expense run.

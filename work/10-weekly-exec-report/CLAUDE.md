# Weekly Exec Report

## Type
Automation (scheduled weekly + on-demand) - the capstone. Aggregates every other automation.

## Purpose
Every Friday, reads from ALL nine other automations + Gmail/Calendar and rolls the week into one branded 7-slide deck and a Notion weekly summary page: what shipped, project status, key meetings, market intel, who you dealt with, what's blocked, and next week's priorities. It's the one artifact that tells Shaheen (and a future manager/client) what a week of the Personal OS actually produced.

## Entry Points
- **Scheduled:** Friday 16:00 (Task Scheduler `PersonalOS-weekly-exec-report`).
- **On-demand:** `/weekly-exec-report`.

## Tools Used
- Notion MCP: read every DB (IDs below) + create the weekly summary page under the Personal OS parent.
- Gmail MCP + Google Calendar MCP: raw week data (sent/received volume, meetings held).
- **Claude Design (DesignSync)** → the deck (standing rule 2026-06-15; NOT /pptx). Build the 7 slides as design-system components on claude.ai/design, branded from brand/config/brand-config.md, then export PDF to outputs/. No native .pptx.
- soul.md (reporting tone: Alex, lead with the lever, no filler).
- Python (openpyxl already installed) only if a data table is needed.

## Data sources (read-only aggregation)
| Section | Source | IDs / paths |
|---------|--------|-------------|
| Project status | Sprint board (Progress Tracker) | data_source `0c239613-7e4e-410c-b064-266fa31a9da4` + vault/projects/sprint-tracker/ |
| Week summary | Morning Brief history | vault/projects/morning-brief/history/ + Daily Briefs `259794ef-9356-41ea-90f3-0d0c65ffeb85` |
| Key meetings | Meeting Notes | `95947a2b-4d03-4894-b09a-bf544997b92c` + vault/meetings/ |
| Market intel | Market Pulse competitors | vault/business/competitors/ - **NOT built; skip gracefully, note "Market Pulse not yet built"** |
| Relationships | Personal CRM | `746bc5bf-8ab3-4e34-911d-00b9d180e350` + vault/people/ (who you interacted with this week) |
| Expenses | Expense Wrangler | `ef881285-4d96-461f-a905-72e161a91532` + vault/projects/expense-wrangler/ |
| Research | Research Team | vault/research/ |
| Content | Content Machine | `0f511509-1c63-4b22-a328-976d6d56d6aa` + vault/projects/content-machine/ |
| Email flow | Email Triage | `9badd246-01a3-4e23-b7b4-9d2c843daef4` + vault/projects/email-triage/history/ |
| Raw | Gmail + Calendar | this week's window |

Any source with no data this week → show "nothing this week" rather than omitting the section or erroring.

## Deliverable choice
At the START of each run, ask via AskUserQuestion: **"Claude Design deck, PDF summary, or both?"** Default = Claude Design deck. (Scheduled runs default to the Claude Design deck + PDF export, no prompt - a human isn't there.)

## The 7-slide deck (Claude Design on claude.ai/design → PDF export to outputs/weekly-exec-report/YYYY-MM-DD/weekly-exec-YYYY-MM-DD.pdf)
1. **Week Summary** - the headline + 3-4 top-line metrics (shipped, meetings, emails, spend).
2. **Project Status** - sprint board snapshot: Done/In Progress/Next/Planned/Blocked counts + what moved (velocity).
3. **Key Meetings** - meetings held + outcomes/action items (from Meeting Notes).
4. **Market Intel** - competitor moves (or "Market Pulse not built yet - no intel this week").
5. **Relationships** - who you interacted with, follow-ups due, new contacts (from CRM).
6. **Blockers** - what's stuck and why (Blocked sprint items, gated drafts, unanswered threads).
7. **Next Week Priorities** - the levers for next week, priority-filtered by soul.md (rent-moving first: job pipeline > learning > modeling).
Brand: ALEX (brand-config.md, since 2026-07-03): canvas #001219, Dark Teal #005f73 / Dark Cyan #0a9396 structure, ONE Golden Orange #ee9b00 accent, Calibri, ALEX logo block every slide. Title + closing dark (#001219), content light.

## Notion weekly summary page
One page per week under the Personal OS parent (`37bb5342-d7f1-81a4-8bf1-d5642d7c3e85`), titled "Weekly Report YYYY-MM-DD", with the FULL report as page content (all 7 sections as `##` headers). No new database - it's a page, not a DB row.

## Vault Structure
- **Tier 1:** vault/projects/weekly-exec-report/status.md - last run, deck path, links to weekly pages.
- **Tier 2:** vault/projects/weekly-exec-report/metrics-history/YYYY-MM-DD.md - one row of the week's numbers (shipped, velocity, meetings, emails, spend, drafts) for TREND tracking over time.

## Vault Reads
soul.md + every source in the table above. brand/config + template.

## Vault Writes
- metrics-history snapshot per run (the trend data).
- status.md, vault/index.md (first run), vault/log.md.
- New people/companies only if the aggregation surfaces any not already filed (rare - upstream automations already file them).

## Connections
- **Fed by:** all 9 automations + Gmail/Calendar. This is the top of the pyramid; everything reports up to it.
- **Feeds into:** Shaheen's weekly review; portable proof-of-work for job interviews (a real artifact showing systems thinking + AI-automation in action).

## Post-Run (mandatory)
1. New people/companies (rare) → vault/people/, vault/business/.
2. [[wiki links]] from the weekly page to the sources it cites.
3. Notion weekly summary page created.
4. metrics-history row appended.
5. vault/index.md + vault/log.md.
6. Sprint board: Done on first build (2026-06-12).
7. Clean temp (build scripts, render dirs); keep only the exported .pdf in outputs/weekly-exec-report/YYYY-MM-DD/ (the deck lives on claude.ai/design; note its project link in status.md).

## Close-Out Extras (Close-Out Gate)
Beyond the universal gate ([[research/alex-close-out-gate]]), this run is not COMPLETE until:
- A new trend snapshot row is appended to the metrics-history file (the one named in Vault Writes above).

## Implementation Notes (as built, 2026-06-12)
- Aggregation spec + command + Friday 16:00 schedule wired. No new DB (reads all, writes a weekly page).
- Deck built via **Claude Design (DesignSync) → PDF export** (standing rule 2026-06-15). The old pptxgenjs → LibreOffice → PyMuPDF pipeline is retired for new decks; .pptx only if Shaheen explicitly asks.
- Market Pulse (#11+, competitors/) dependency handled gracefully - section shows "not built yet".
- No deck generated at build (needs a real week of data; first Friday run / on-demand produces the first one).
- metrics-history starts empty; first run seeds the trend line.

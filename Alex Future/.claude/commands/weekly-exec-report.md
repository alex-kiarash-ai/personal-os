# /weekly-exec-report - Weekly Aggregate Deck + Notion Page (Capstone)

Spec: work/10-weekly-exec-report/CLAUDE.md (read it first). Aggregates all 9 automations.

## Steps
1. **Ask** (AskUserQuestion): "Claude Design deck, PDF summary, or both?" Default = Claude Design deck. (Scheduled run skips the prompt → Claude Design deck + PDF export.)
2. **Aggregate this week** (read-only; any empty source → "nothing this week", never error):
   - Project status ← Sprint board `0c239613-7e4e-410c-b064-266fa31a9da4` + vault/projects/sprint-tracker/
   - Week summary ← vault/projects/morning-brief/history/ + Daily Briefs `259794ef-9356-41ea-90f3-0d0c65ffeb85`
   - Meetings ← Meeting Notes `95947a2b-4d03-4894-b09a-bf544997b92c` + vault/meetings/
   - Market intel ← vault/business/competitors/ (Market Pulse NOT built → say so)
   - Relationships ← CRM `746bc5bf-8ab3-4e34-911d-00b9d180e350` + vault/people/
   - Expenses ← Expenses `ef881285-4d96-461f-a905-72e161a91532` + vault/projects/expense-wrangler/
   - Research ← vault/research/ · Content ← Content Library `0f511509-1c63-4b22-a328-976d6d56d6aa` · Email ← Email Triage `9badd246-01a3-4e23-b7b4-9d2c843daef4`
   - Raw ← Gmail + Calendar (this week).
3. **Build the 7-slide deck with Claude Design (DesignSync)** (standing rule 2026-06-15; NOT /pptx): `ToolSearch("select:DesignSync")` → reuse/create a claude.ai/design project (ask before creating) → build the 7 slides as design-system components one at a time (finalize_plan → write_files), branded per brand/config/brand-config.md (ALEX: #001219 canvas, #005f73/#0a9396 teal structure, one #ee9b00 accent), Calibri, ALEX logo block: Week Summary · Project Status · Key Meetings · Market Intel · Relationships · Blockers · Next Week Priorities. **Export PDF** to outputs/reports/weekly-exec-YYYY-MM-DD.pdf; note the claude.ai/design project link.
4. **Notion weekly page**: "Weekly Report YYYY-MM-DD" under the Personal OS parent, full report as page content (7 `##` sections).
5. **metrics-history**: append vault/projects/weekly-exec-report/metrics-history/YYYY-MM-DD.md (shipped, velocity, meetings, emails, spend, drafts) for trends.

## Tone
soul.md / Alex: lead with the single biggest lever, no filler, priority-filter next-week by rent-first (job pipeline > learning > modeling > STEMPLICITY).

## Post-Run
- status.md (last run, deck path) + vault/index.md + vault/log.md. Clean temp (recalc/JPGs); keep only the deliverable. Do NOT re-mark the sprint row (Done at build).

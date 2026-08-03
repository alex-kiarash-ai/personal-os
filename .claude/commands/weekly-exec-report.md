# /weekly-exec-report - Weekly Aggregate Deck + Notion Page (Capstone)

<!-- ALEX:CMD-HEADER:BEGIN generated from system/manifest.json by scripts/generate-alex.js - do not hand-edit -->
> **#10 /weekly-exec-report · LIVE · Trigger: Fri 16:00**
> Registry: `system/manifest.json` · Spec: `work/10-weekly-exec-report/CLAUDE.md` · Status: `vault/projects/weekly-exec-report/status.md`
> *State and trigger above are GENERATED from the registry. Do not restate a schedule elsewhere in this file; point at the registry instead.*
<!-- ALEX:CMD-HEADER:END -->

Spec: work/10-weekly-exec-report/CLAUDE.md (read it first). **Aggregates every non-RETIRED project in
`system/manifest.json`** (32 numbered + the unnumbered rows as of 2026-07-28). Do not hardcode a count
here: the old "all 9 automations" line was written when there were nine, and it stayed while the system
grew past thirty, which is exactly how the Friday capstone quietly narrowed to under a third of what it
claims to cover.

## Steps
1. **Ask** (AskUserQuestion): "Claude Design deck, PDF summary, or both?" Default = Claude Design deck. (Scheduled run skips the prompt → Claude Design deck + PDF export.)
2. **Aggregate this week** (read-only; any empty source → "nothing this week", never error).

   **2a. Walk the registry FIRST, not a hand-list.** Read `system/manifest.json`, take every project whose
   `state` is not RETIRED, and for each one read its `status_md`. That is the spine of the report: a
   project that shipped nothing gets one honest quiet line, and a project added next month appears here
   without anyone remembering to edit this file. **This replaced a hardcoded list of the original nine
   (2026-07-28, review F-14)** which had silently stopped covering #15 radar, #16 HQ, #17 health, #18
   recovery, #20 runway, #21 interview and everything from #24 up, while the routing table still
   described this as "every automation into one branded deck".

   **2b. Then the rich sources below**, which carry detail no status page holds:
   - Project status ← Sprint board `0c239613-7e4e-410c-b064-266fa31a9da4` + vault/projects/sprint-tracker/ (**cache-derived since 2026-07-18, #01 is PARKED - say so rather than presenting it as live board data**)
   - Week summary ← vault/projects/morning-brief/history/ + Daily Briefs `259794ef-9356-41ea-90f3-0d0c65ffeb85`
   - Meetings ← Meeting Notes `95947a2b-4d03-4894-b09a-bf544997b92c` + vault/meetings/
   - Market intel ← vault/business/competitors/ (Market Pulse NOT built → say so)
   - Relationships ← CRM `746bc5bf-8ab3-4e34-911d-00b9d180e350` + vault/people/
   - Expenses ← Expenses `ef881285-4d96-461f-a905-72e161a91532` + vault/projects/expense-wrangler/
   - Research ← vault/research/ · Content ← Content Library `0f511509-1c63-4b22-a328-976d6d56d6aa` · Email ← Email Triage `9badd246-01a3-4e23-b7b4-9d2c843daef4`
   - Raw ← Gmail + Calendar (this week).
2b. **Deltas-first (2026-07-25).** Append this week's structured numbers as one JSONL row to `vault/projects/weekly-exec-report/metrics-history.jsonl` (`{week_ending, metrics:{automations_shipped, sprint_velocity, meetings, research_outputs, content_published, expenses_logged, blockers, waiting_queue, ...}}` - numeric only), then run `node scripts/weekly-deltas.js`. It writes `deltas-latest.md` (every metric = value + direction + vs-4-week-baseline + z-score, deterministic). **The prose pass comments ONLY on the top 3 deltas by |z|** (from `weekly-deltas.js --json`), not every metric - the report answers "what changed", and the Claude call writes 3 sharp paragraphs, not 12.
3. **Build the 7-slide deck with Claude Design (DesignSync)** (standing rule 2026-06-15; NOT /pptx): `ToolSearch("select:DesignSync")` → reuse/create a claude.ai/design project (ask before creating) → build the 7 slides as design-system components one at a time (finalize_plan → write_files), branded per brand/config/brand-config.md (ALEX: #001219 canvas, #005f73/#0a9396 teal structure, one #ee9b00 accent), Calibri, ALEX logo block: Week Summary · Project Status · Key Meetings · Market Intel · Relationships · Blockers · Next Week Priorities. **Export PDF** to outputs/weekly-exec-report/YYYY-MM-DD/weekly-exec-YYYY-MM-DD.pdf (own folder since 2026-07-11; outputs/reports/ is frozen legacy); note the claude.ai/design project link.
4. **Notion weekly page**: "Weekly Report YYYY-MM-DD" under the Personal Ops System parent, full report as page content (7 `##` sections).
5. **metrics-history**: append vault/projects/weekly-exec-report/metrics-history/YYYY-MM-DD.md (shipped, velocity, meetings, emails, spend, drafts) for trends.

## Tone
soul.md / Alex: lead with the single biggest lever, no filler, priority-filter next-week by rent-first (job pipeline > learning > side projects).

## Post-Run
- status.md (last run, deck path) + vault/index.md + vault/log.md. Clean temp (recalc/JPGs); keep only the deliverable. Do NOT re-mark the sprint row (Done at build).

# AI Application Engine - the job-hunting robot, aimed at AI roles

**Workflow ID:** `9x9M3EnEEeX3O8dy` · **Runs:** every 72h at 07:30 Stockholm (30 min after its twin; retimed 2026-07-16 for cost cut, was daily) · **Nodes:** 41 · **Export in this folder:** workflow.json (2026-07-20 refresh: 72h cron + "Past week" window, on the P3 write-first base)

## What it does

Exactly what the [BI Application Engine](../03-application-engine/) does - hunt LinkedIn every morning, judge every posting, write a tailored CV + cover letter for the winners, render PDFs, file them in Drive, log everything in a sheet - but pointed at a different target: **AI and automation jobs** (AI Automation Engineer, n8n Developer, LLM Engineer, AI Consultant, Workflow Automation) instead of Power BI jobs. It embeds Shaheen's AI-direction CV instead of the BI one, and its scoring asks an extra question: how central is AI/automation to this role, not just "does he qualify". It runs alongside the BI engine, never instead of it - two lanes of the same job hunt.

## Why it exists

Shaheen's pivot is FROM senior Power BI TO AI automation engineering. One CV can't chase both credibly: a resume that leads with 7 years of BI platform ownership undersells the AI story, and vice versa. So the hunt got two engines with two CVs and two ledgers. This one is the pivot lane - the jobs he *wants* most. Since 2026-07-02 it's verified live at scale: 905 jobs processed, 48 drafted applications, total AI spend $2.82.

## The steps, node by node

The 41 nodes are identical in shape to the BI engine's - same five stages, including the P3 write-first reorder of 2026-07-12 (new discoveries are banked to the ledger as `sourced_unscored` BEFORE any Claude call, and banked rows drain back into later batches until they complete - see the twin's Stage 2 walkthrough). Full plain-language walkthrough of every node: see [03-application-engine/README.md](../03-application-engine/README.md#the-steps-node-by-node). What's **different** inside this copy:

1. **Read Search Config** reads its own sheet ("AI Job Search Pipeline", ID `11lvksV5NmLK7vWvt4oHIPTXZ1pwRVi67UrWVI3lrAHQ`) with AI-role search rows.
2. **Build Match Request / Build Writer Request** embed the AI CV (`master_cv_ai.md`) and AI-focused instructions: the writer leads with Building Alex and automation work; BI becomes supporting credibility.
3. **Claude Match+Research** scores `target_role` as "ai" or "neither", and its interest score measures AI-centrality of the role (the headline signal for this lane).
4. **Stage 3 Gate** only lets `ai` roles through (fit threshold 70, same as BI).
5. **Create Drive Folder / uploads** file into the AI Drive folder (`18HUzkLQtKCBd_VGMjBxS94jy8UAJIP4Z`).
6. **Daily 07:30 Stockholm** - offset 30 minutes so the two engines never fight over the same API limits at once.

## Connected to

- **[03-application-engine](../03-application-engine/)** - the parent it was cloned from (2026-06-16); they share the Bright Data scraper, the Anthropic account, the Gotenberg PDF service, and the same review-first philosophy.
- **[hq-pipeline-stats](../hq-pipeline-stats/)** - reads this engine's sheet daily for the Alex HQ dashboard.
- **[pipeline-error-alert](../pipeline-error-alert/)** - its crash alarm (this alert system was born when BOTH engines died silently for 5 days in June from a spending cap).
- **Locally:** no command of its own; results reported through the same channels. Project doc: `docs/projects/14-ai-application-engine.md`.

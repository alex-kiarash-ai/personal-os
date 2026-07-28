# AI Application Engine - the job-hunting robot, aimed at AI roles

**Workflow ID:** `9x9M3EnEEeX3O8dy` · **Runs:** Tuesday & Thursday 15:30 Stockholm (cron `30 15 * * 2,4`; 30 min after its twin; retimed 2026-07-24, was every-72h 07:30) · **Nodes:** 32 (simplified 2026-07-28 from the 50-node post-remediation graph) · **Model:** Moonshot `kimi-k3` at `reasoning_effort:'high'` (was claude-opus-4-8, swapped 2026-07-27) · **Export in this folder:** workflow.json (the checked-in export predates the 07-28 simplify; the live workflow is the 32-node graph - re-pull from the box to refresh the raw JSON).

## What it does

Exactly what the [BI Application Engine](../03-application-engine/) does - hunt LinkedIn every Tuesday and Thursday, judge every posting, write a tailored CV + cover letter for the winners, render PDFs, file them in Drive, log each drafted application in a sheet - but pointed at a different target: **AI and automation jobs** (AI Automation Engineer, n8n Developer, LLM Engineer, AI Consultant, Workflow Automation) instead of Power BI jobs. It embeds Shaheen's AI-direction CV instead of the BI one, and its scoring asks an extra question: how central is AI/automation to this role, not just "does he qualify". It runs alongside the BI engine, never instead of it - two lanes of the same job hunt.

## Why it exists

Shaheen's pivot is FROM senior Power BI TO AI automation engineering. One CV can't chase both credibly, so the hunt got two engines with two CVs. This one is the pivot lane - the jobs he *wants* most. Verified live at scale in earlier months (905 jobs processed, 48 drafted, spend under $3), though the 2026-07-28 simplify removed per-job cost tracking, so fresh runs no longer log a cost figure.

## The steps, node by node

The 32 nodes are identical in shape to the BI engine's, and both went through the same three changes in two days (the kimi-k3 model swap and the F01-F22 remediation on 2026-07-27, then the 41→50→32 simplify on 2026-07-28). **Read the twin's walkthrough for the full node-by-node:** [03-application-engine/README.md](../03-application-engine/README.md#the-steps-node-by-node-32-node-graph). It covers the current lean spine (source → poll → parse → match → gate → write → QA → render → upload → run_log), and the fact that the dedup / banking / `needs_review` / cost-tracking layer was deleted - all of which applies here identically.

What's **different** inside this copy:

1. **Read Search Config** reads its own sheet ("AI Job Search Pipeline", ID `11lvksV5NmLK7vWvt4oHIPTXZ1pwRVi67UrWVI3lrAHQ`) with AI-role search rows.
2. **Build Match Request / Build Writer Request** embed the AI CV (`master_cv_ai.md`) and AI-focused instructions: the writer leads with Building Alex and automation work; BI becomes supporting credibility.
3. **Claude Match+Research** scores `target_role` as "ai", **"consultant"** (added in the remediation, F09, and it survives the simplify since it lives in the match schema, not the deleted ledger nodes), or "neither"; its interest score measures AI-centrality.
4. **Stage 3 Gate** lets `ai` and `consultant` roles through (fit threshold 70, same as BI).
5. **Create Drive Folder / uploads** file into the AI Drive folder (`18HUzkLQtKCBd_VGMjBxS94jy8UAJIP4Z`).
6. **Tue & Thu 15:30 Stockholm** - fires 30 minutes after its twin so the two engines never fight over the same API limits at once.

**No longer different, because it was deleted from both:** the cross-lane dedup (`Read Sibling Log`) that used to make this engine skip a vacancy #03 had already sourced is gone. With the sheet ledgers off the read path, the two engines no longer coordinate; a job matching both search sets can now be drafted by both.

## Connected to

- **[03-application-engine](../03-application-engine/)** - the parent it was cloned from (2026-06-16); they share the Bright Data scraper, the Gotenberg PDF service, the review-first philosophy, and now the same Moonshot/kimi-k3 model and the same 32-node simplified shape.
- **[hq-pipeline-stats](../hq-pipeline-stats/)** - reads this engine's sheet daily for the Alex HQ dashboard.
- **[pipeline-error-alert](../pipeline-error-alert/)** - its crash alarm.
- **Locally:** no command of its own; results reported through the same channels. Project doc: `docs/projects/14-ai-application-engine.md`.

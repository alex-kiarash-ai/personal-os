# AI Application Engine - the job-hunting robot, aimed at AI roles

**Workflow ID:** `9x9M3EnEEeX3O8dy` · **Runs:** Tuesday & Thursday 15:30 Stockholm (cron `30 15 * * 2,4`; 30 min after its twin; retimed 2026-07-24, was every-72h 07:30) · **Nodes:** 36 (32 after the 07-28 simplify, +4 in the 2026-08-07 repair) · **Model:** Moonshot `kimi-k3` at `reasoning_effort:'high'` (was claude-opus-4-8, swapped 2026-07-27) · **Export in this folder:** workflow.json, re-pulled live 2026-08-07 at `versionId a8606631-f4fb-43fd-853b-18e94de8d9f4` / `updatedAt 2026-08-07T08:48:07.505Z` / 36 nodes / active:true.

## What it does

Exactly what the [BI Application Engine](../03-application-engine/) does - hunt LinkedIn every Tuesday and Thursday, judge every posting, write a tailored CV + cover letter for the winners, render PDFs, file them in Drive, log each drafted application in a sheet - but pointed at a different target: **AI and automation jobs** (AI Automation Engineer, n8n Developer, LLM Engineer, AI Consultant, Workflow Automation) instead of Power BI jobs. It embeds Shaheen's AI-direction CV instead of the BI one, and its scoring asks an extra question: how central is AI/automation to this role, not just "does he qualify". It runs alongside the BI engine, never instead of it - two lanes of the same job hunt.

## Why it exists

Shaheen's pivot is FROM senior Power BI TO AI automation engineering. One CV can't chase both credibly, so the hunt got two engines with two CVs. This one is the pivot lane - the jobs he *wants* most. Verified live at scale in earlier months (905 jobs processed, 48 drafted, spend under $3), though the 2026-07-28 simplify removed per-job cost tracking, so fresh runs no longer log a cost figure.

## The steps, node by node

The 36 nodes are near-identical in shape to the BI engine's, and both went through the same four changes (the kimi-k3 model swap and the F01-F22 remediation on 2026-07-27, the 41→50→32 simplify on 2026-07-28, then the 2026-08-07 repair). **Read the twin's walkthrough for the full node-by-node:** [03-application-engine/README.md](../03-application-engine/README.md#the-steps-node-by-node-38-node-graph). It covers the current spine (source → poll → parse → match → gate → write → QA → render → upload → run_log → run_summary), and the fact that the banking / `needs_review` / cost-tracking layer was deleted - all of which applies here identically.

What's **different** inside this copy:

1. **Read Search Config** reads its own sheet ("AI Job Search Pipeline", ID `11lvksV5NmLK7vWvt4oHIPTXZ1pwRVi67UrWVI3lrAHQ`) with AI-role search rows.
2. **Build Match Request / Build Writer Request** embed the AI CV (`master_cv_ai.md`) and AI-focused instructions: the writer leads with Building Alex and automation work; BI becomes supporting credibility.
3. **Claude Match+Research** scores `target_role` as "ai", **"consultant"** (added in the remediation, F09, and it survives the simplify since it lives in the match schema, not the deleted ledger nodes), or "neither"; its interest score measures AI-centrality.
4. **Stage 3 Gate** lets `ai` and `consultant` roles through. **Fit threshold is 50 here, not 70** (measured live 2026-08-07 and every earlier read; the "70, same as BI" line this doc used to carry was copied from the twin and was never true of this workflow). The lower bar is deliberate for a career-changer lane.
5. **Create Drive Folder / uploads** file into the AI Drive folder (`18HUzkLQtKCBd_VGMjBxS94jy8UAJIP4Z`).
6. **Tue & Thu 15:30 Stockholm** - fires 30 minutes after its twin so the two engines never fight over the same API limits at once.
7. **429 posture is the opposite of #03's, on purpose.** Both model nodes here carry `onError: continueRegularOutput`, `retryOnFail: false` and a 3000ms `batchInterval`: one refused job is skipped and the rest of the batch survives. #03 keeps the old loud posture (retry 4x5s, no `onError`, no interval) so a total outage there fails visibly. This engine runs 15 search rows against #03's 5, which is why it needed the softer landing, and why its `limit_per_input` is **4** where #03's is 10.
8. **No dedup guard.** #03 got `Read Run Log` + `Dedup Guard` on 2026-08-07; this engine did not, so its `Parse Jobs` still feeds `Build Match Request` directly. Mirroring it here is a candidate change, not a done one.

**What the 08-07 repair added here (4 nodes, 32 → 36):** the same `Run Counter` → `Append Run Summary` → `Storm Verdict?` → `Stop On Storm` chain as the twin, writing a 12-column row to a new `run_summary` tab on the AI sheet, hanging off both triggers and parked at canvas y=0 so it executes last. This is the engine the chain was proven on: fire 3713 drove the whole storm path (verdict `storm_error_match`, run ERROR at `Stop On Storm`, Pipeline Error Alert exec 3714, Notion page, HQ `n8n_broken_today` metric, storm row in the sheet). Its `QA + Fill Templates` was moved to the same rule set D' as #03 in the same session, after a cross-corpus gate proved the first attempt would have broken 10 good drafts. Do not move those four nodes above the pipeline: position is what orders them.

**No longer different, because it was deleted from both:** the cross-lane dedup (`Read Sibling Log`) that used to make this engine skip a vacancy #03 had already sourced is gone. With the sheet ledgers off the read path, the two engines no longer coordinate; a job matching both search sets can be drafted by both.

## Connected to

- **[03-application-engine](../03-application-engine/)** - the parent it was cloned from (2026-06-16); they share the Bright Data scraper, the Gotenberg PDF service, the review-first philosophy, the Moonshot/kimi-k3 model, the QA rule set D' and the counter/storm chain. They now differ on node count (36 vs 38), fit threshold (50 vs 70), 429 posture, `limit_per_input` (4 vs 10) and the dedup guard (#03 only).
- **[hq-pipeline-stats](../hq-pipeline-stats/)** - reads this engine's sheet daily for the Alex HQ dashboard.
- **[pipeline-error-alert](../pipeline-error-alert/)** - its crash alarm.
- **Locally:** no command of its own; results reported through the same channels. Project doc: `docs/projects/14-ai-application-engine.md`.

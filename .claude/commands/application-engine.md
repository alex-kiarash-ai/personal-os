# /application-engine - Job Pipeline Ops Helper

<!-- ALEX:CMD-HEADER:BEGIN generated from system/manifest.json by scripts/generate-alex.js - do not hand-edit -->
> **#03 /application-engine · LIVE · Trigger: n8n Tue+Thu 15:00 + watch 8:30**
> Registry: `system/manifest.json` · Spec: `work/03-application-engine/CLAUDE.md` · Status: `vault/projects/job-pipeline/status.md`
> *State and trigger above are GENERATED from the registry. Do not restate a schedule elsewhere in this file; point at the registry instead.*
<!-- ALEX:CMD-HEADER:END -->

Spec + runbook: work/03-application-engine/CLAUDE.md. Design source of truth: job_pipeline_documentation.md (Desktop\Job Search\Job Applications\CV\LinkdIn Automation (1)\), keep its changelog current.

This command does NOT run the pipeline. n8n on Hetzner runs it on the schedule declared in
`system/manifest.json` (#03 `trigger` + `n8n_cron`, asserted against the live workflow by validator V6
leg (c)). **Read the schedule there, never from a number written here.** This file is the local ops
surface only.

## Steps
1. Read work/03-application-engine/CLAUDE.md and vault/projects/job-pipeline/status.md.
2. Read the Job Search Pipeline Google Sheet (Drive MCP): run_log + needs_review tabs.
3. Report since last check: drafts generated, cost per application, needs_review items with reasons, and zero-job days **counted only over the engine's SCHEDULED run days** (from #03's `n8n_cron`; a day the engine was never due to run is not a zero-job day).
4. Update vault/projects/job-pipeline/status.md (last run seen, totals) and vault/log.md.
5. If new companies appear in run_log, create vault/business/ pages per Post-Run Ingestion.
6. Flag anomalies: QA failures clustering on one reason, cost spikes, repeated empty snapshots.

## Post-Run
- vault/log.md entry: `## [YYYY-MM-DD HH:MM] application-engine | {n} drafts, {m} needs_review, ${cost}`.
- Never modify the n8n workflow from here; changes go through the doc + a deliberate export regeneration.

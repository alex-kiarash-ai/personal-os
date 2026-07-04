# /application-engine - Job Pipeline Ops Helper

Spec + runbook: work/03-application-engine/CLAUDE.md. Design source of truth: job_pipeline_documentation.md (Desktop\Job Applications\CV\LinkdIn Automation (1)\), keep its changelog current.

This command does NOT run the pipeline (n8n on Hetzner runs it daily at 07:00 Stockholm). It is the local ops surface:

## Steps
1. Read work/03-application-engine/CLAUDE.md and vault/projects/job-pipeline/status.md.
2. Read the Job Search Pipeline Google Sheet (Drive MCP): run_log + needs_review tabs.
3. Report since last check: drafts generated, cost per application, needs_review items with reasons, zero-job days.
4. Update vault/projects/job-pipeline/status.md (last run seen, totals) and vault/log.md.
5. If new companies appear in run_log, create vault/business/ pages per Post-Run Ingestion.
6. Flag anomalies: QA failures clustering on one reason, cost spikes, repeated empty snapshots.

## Post-Run
- vault/log.md entry: `## [YYYY-MM-DD HH:MM] application-engine | {n} drafts, {m} needs_review, ${cost}`.
- Never modify the n8n workflow from here; changes go through the doc + a deliberate export regeneration.

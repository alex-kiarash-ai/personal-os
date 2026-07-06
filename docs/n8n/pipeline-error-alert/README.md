# Pipeline Error Alert - the smoke alarm

**Workflow ID:** `QlGy1BFzdKF852uR` · **Runs:** only when another workflow crashes · **Nodes:** 5 · **Export in this folder:** workflow.json (2026-07-06 version, latest)

## What it does

Nothing, on a good day. It sits silent until any workflow on the n8n server throws an error - then it wakes up automatically, writes down what died and why, and does two things at once: (1) creates a row in the Notion "Pipeline Alerts" database, which the morning brief reads every day at 08:00, so a crash at 03:00 is on Shaheen's breakfast briefing; and (2) flips the **"Broken n8n today" card on Alex HQ** red immediately (a direct write into the `alex_metrics` data table), so a break shows on the dashboard the instant it happens, not just next morning.

**Coverage (2026-07-06):** every active workflow on the box now nominates this as its error handler (13 of 14; the alarm can't guard itself). Before, only #03/#14/pipeline-stats did, so a failure in health ingest, LinkedIn staging, life-ops, or any HQ workflow was silent. Wired in bulk by `work/16-alex-hq/scripts/wire-all-error-handlers.js`.

## Why it exists

Bought with pain. In late June 2026, **both** job engines went dark for five days - the Anthropic monthly spending cap had tripped, every run failed quietly, and nobody noticed because there was no alarm. Five mornings of "the robot is applying for me" while it applied to nothing. This workflow is the lesson made permanent: failures must announce themselves, in a place that gets read daily.

## The steps, node by node

- **On Workflow Error** - n8n's built-in tripwire: fires the moment any workflow on this server that designates this as its error handler fails.
- **Build Alert Payload** - plain code that gathers the facts: which workflow, which node, what error message, when.
- **Notion: Create Alert** - writes the alert as a row in the Pipeline Alerts database in Notion (database `08504afe-ba13-4691-9e67-0ed9a00c8e8c`).
- **Build HQ Metric** - branches off Build Alert Payload, shapes the same facts into an `alex_metrics` row (project `infra`, metric `n8n_broken_today`, status red, headline = which workflow failed and why). Added 2026-07-06.
- **Insert HQ Metric** - writes that row straight into the `alex_metrics` data table on the same box (no HTTP, no token - the pipeline-stats sidecar pattern). The next liveness harvest overwrites the key with the true count, so the card self-heals to green exactly like sprint run_status.

## Connected to

- **Every active workflow on the box** - all 13 (of 14) active workflows nominate this as their error handler as of 2026-07-06; it primarily guards **[03-application-engine](../03-application-engine/)** and **[14-ai-application-engine](../14-ai-application-engine/)**, the money pipelines.
- **Morning Brief** - reads the Pipeline Alerts database daily; the alarm is only useful because something checks it (within 24h).
- **Alex HQ** - now fed directly: the "Broken n8n today" card (metric `n8n_broken_today`) goes red the instant a workflow throws, and the daily/on-demand liveness harvest (`work/16-alex-hq/scripts/n8n_liveness.py`) reconciles the exact count. Pipeline health tiles catch the same outages from the numbers side ([hq-pipeline-stats](../hq-pipeline-stats/)); multiple independent alarms for one failure class, on purpose.

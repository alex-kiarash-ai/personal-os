# Alex HQ - Pipeline Stats: the sidecar that reports for the pipelines

**Workflow ID:** `y5YbDZu8TT38XZ9r` · **Runs:** daily 07:50 Stockholm (+ an on-demand trigger at `/webhook/alex-hq-stats-run`) · **Nodes:** 8 · **Export in this folder:** workflow.json (2026-07-02 version, latest)

## What it does

Every morning at 07:50 this workflow opens **both** pipelines' Google Sheets (the BI ledger and the AI ledger), reads their run logs and job tables in two batch calls, computes the latest stats (jobs processed, drafts produced, spend, review-queue depth, whether the most recent run happened), and pushes those numbers into the [metrics mailbox](../hq-metrics-ingest/) so the dashboard's pipeline tiles are fresh by breakfast.

**Timing note (2026-07-24):** the two engines were retimed from every-72h 07:00/07:30 to **Tue & Thu 15:00/15:30**. The stats sweep still runs 07:50 daily, so on a run day (Tue/Thu) the 07:50 read reports the *previous* completed run, and that afternoon's fresh run first shows in the NEXT morning's 07:50 sweep (or on the on-demand `/webhook/alex-hq-stats-run` trigger). The tiles stay correct, just up to one cycle behind on run afternoons. If Shaheen wants same-day freshness, retime this workflow to fire after 15:30 on Tue/Thu (not done here - out of scope of the engine retiming).

## Why it exists

The two job engines are the busiest automations in the system, but they run remotely and were built before the dashboard - they don't push their own metrics. Rather than performing surgery on two live 37-node workflows, this small sidecar reads their ledgers from the outside and reports on their behalf. It's also the dashboard's watchdog for them: if a pipeline silently didn't run, the sidecar sees the missing run-log row and the tile goes amber/red - the exact failure mode that once went unnoticed for five days.

## The steps, node by node

- **Daily 07:50 Stockholm** - the alarm clock, timed after both engines finish.
- **Run Now Hook** - a second doorbell (`/webhook/alex-hq-stats-run`) so Alex can refresh the stats on demand.
- **BI Batch** - one batched Google Sheets API call that reads the BI pipeline's tabs (run_log, processed, review queue).
- **Breathe** - a short pause between the two big reads, to stay polite with API limits.
- **AI Batch** - the same batched read against the AI pipeline's sheet.
- **Compute Stats** - plain code that turns both ledgers into today's numbers per pipeline: processed, drafts, cost, queue depth, ran-today yes/no.
- **Explode Events** - reshapes those numbers into individual metric packages in the mailbox format.
- **Insert Metric Rows** - files them straight into the `alex_metrics` table (same table the mailbox fills).

## Connected to

- **[03-application-engine](../03-application-engine/)** and **[14-ai-application-engine](../14-ai-application-engine/)** - the two engines it reports for (read-only; it never touches them).
- **[hq-metrics-ingest](../hq-metrics-ingest/)** / the `alex_metrics` table - where its numbers land.
- **The Alex HQ dashboard** - the pipeline tiles and the automation-health board are fed from here. Project doc: `docs/projects/16-alex-hq.md`.

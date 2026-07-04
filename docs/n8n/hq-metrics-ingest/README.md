# Alex HQ — Metrics Ingest: the mailbox for numbers

**Workflow ID:** `V0AXq5QfJBu8WMk5` · **Runs:** always on, waiting at `POST /webhook/alex-push` (token-gated) · **Nodes:** 4 · **Export in this folder:** workflow.json (2026-07-01 version, latest)

## What it does

This is the single mailbox where **every automation in the system drops its numbers**. When the morning brief finishes, when the sprint tracker runs, when the git backup pushes — each of them sends a small package here: "project X, metric Y, value Z, status green/red, one-line headline." The workflow checks the sender's token, tidies the package, and files it as a row in the `alex_metrics` table on the server. That table is the raw material the Alex HQ dashboard is built from.

## Why it exists

One rule, one address, one format — instead of every automation inventing its own way to report. This is "the metrics contract": anything that runs, pushes. Because everything lands in one table with timestamps, the dashboard can show not just numbers but *staleness* — if a daily automation hasn't reported in two days, its tile turns amber without anyone checking logs. It's how a dead automation stops being invisible.

## The steps, node by node

- **Push Webhook** — the mailbox slot: listens at `/webhook/alex-push`, only accepts packages carrying the right token (the token itself lives in n8n's credential store, not in this file).
- **Normalize Events** — plain code that tidies whatever arrived: accepts one metric or a batch, fills in timestamps, trims junk, rejects malformed entries.
- **Insert Metric Row** — files each metric as a new row in the `alex_metrics` data table.
- **Respond OK** — sends back a short receipt so the pushing automation knows the drop-off worked.

## Connected to

- **Every producer:** all local commands (morning-brief, sprint-tracker, email-triage, alex-hq, git-backup...) and the [hq-pipeline-stats sidecar](../hq-pipeline-stats/) push here.
- **[hq-summary-api](../hq-summary-api/)** — reads the table this fills, to serve the dashboard.
- **The Alex HQ app** at https://hq.shaheenkiarash.com — the face all of this feeds. Project doc: `docs/projects/16-alex-hq.md`.

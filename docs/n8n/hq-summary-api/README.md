# Alex HQ — Summary API: the dashboard's data tap

**Workflow ID:** `GLcMPA4m0DRGjnQH` · **Runs:** always on, waiting at `GET /webhook/alex-hq-summary` (token-gated) · **Nodes:** 4 · **Export in this folder:** workflow.json (2026-07-01 version, latest)

## What it does

When the Alex HQ dashboard (the app on Shaheen's phone and PC) loads, it asks this workflow: "give me the current state of everything." The workflow reads the whole `alex_metrics` table — every number every automation has pushed — and boils it down to the **latest value per metric per project**, plus health colors and how fresh each one is. That single summary answer is what the dashboard paints its tiles from.

## Why it exists

The metrics table is a growing history (hundreds of rows); the dashboard needs a snapshot ("what's true right now"), not the archive. Doing that reduction on the server keeps the app dumb and fast: one request, one JSON answer, no database access from the phone. Together with [hq-metrics-ingest](../hq-metrics-ingest/) it forms the complete backend of Alex HQ — in first, out here.

## The steps, node by node

- **Summary Webhook** — the tap: listens at `/webhook/alex-hq-summary`, token-checked.
- **Get All Rows** — pulls the rows from the `alex_metrics` data table.
- **Reduce To Summary** — plain code that keeps the newest value of each metric per project, computes each project's worst status (one red metric makes the project red), and attaches "last seen" ages for staleness.
- **Respond Summary** — returns the finished summary as JSON to the app.

## Connected to

- **[hq-metrics-ingest](../hq-metrics-ingest/)** — fills the table this reads.
- **The Alex HQ app** (https://hq.shaheenkiarash.com) — its only real customer; also used by the `/alex-hq` and `/status` commands when they print the health summary in the terminal. Project doc: `docs/projects/16-alex-hq.md`.

# MCP Tool — pipeline_status (worker)

**Workflow ID:** `k4p4TUoGrAuFt3Gg` · **Runs:** only when the [MCP front desk](../mcp-server-application-engine/) calls it · **Nodes:** 3 · **Export in this folder:** workflow.json (2026-07-01 version, latest)

## What it does

Answers one question: **"How has the job pipeline been running?"** When Shaheen's AI assistant picks the `pipeline_status` tool, this worker wakes up, reads the pipeline's run history from the Google Sheet, and returns a compact summary: recent runs, jobs found, jobs drafted, costs.

## Why it exists

The MCP front desk only presents buttons; each button needs a worker that actually does the work. Keeping each tool as its own tiny workflow means each one can be tested, fixed, or replaced alone without touching the front desk or the other tools.

## The steps, node by node

- **When Called** — the wake-up trigger; fires only when the front desk delegates to this worker.
- **Read run_log** — opens the pipeline sheet's `run_log` tab (one row per daily run: date, jobs found, judged, drafted, cost).
- **Aggregate** — plain code that boils those rows down to the short, readable status summary the AI assistant hands back to Shaheen.

## Connected to

- **[mcp-server-application-engine](../mcp-server-application-engine/)** — the front desk that owns this tool's button. Must stay ACTIVE for the button to work.
- **[03-application-engine](../03-application-engine/)** — the pipeline whose run ledger this reads (read-only, always).

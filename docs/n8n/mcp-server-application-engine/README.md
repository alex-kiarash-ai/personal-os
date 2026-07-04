# Application Engine (MCP) — the front desk for asking the pipeline questions

**Workflow ID:** `CnhvoIVLSc6cUQZG` · **Runs:** always on, waiting at `https://n8n.shaheenkiarash.com/mcp/app-engine` (bearer-token gated) · **Nodes:** 4 · **Export in this folder:** workflow.json (2026-07-02 version, latest)

## What it does

This workflow doesn't run on a schedule and doesn't process jobs. It sits waiting, like a front desk, and lets Shaheen's AI assistant (Claude) talk to the job pipeline in plain language. When Shaheen asks his assistant "how did the pipeline do this week?" or "any data jobs in Dubai above fit 75?", the assistant calls this front desk over a standard called **MCP** (Model Context Protocol — the USB of AI tools: one plug, any tool). The front desk offers exactly three read-only "buttons", each wired to its own small worker workflow. Nothing here can change, delete, or apply to anything — it can only look things up.

## Why it exists

Before this, checking the pipeline meant opening Google Sheets and scrolling. This turns the pipeline into something you can *converse with*. It was also the first real product of the Alex AI Radar (decision #1, built 2026-07-01): the radar spotted that n8n had shipped native MCP support, and instead of just noting it, Alex built with it the same week. It doubles as portfolio proof: "my automation isn't just scheduled scripts, it's a queryable service my AI can use."

## The steps, node by node

- **MCP Server Trigger** — the front desk itself: listens at the `/mcp/app-engine` address (streamable HTTP, the modern MCP transport), checks the caller's bearer token, and presents the tool menu to any connected AI.
- **pipeline_status** — button #1: "how have the runs gone?" Hands the question to the [pipeline-status worker](../mcp-tool-pipeline-status/).
- **search_jobs** — button #2: "find jobs matching these filters." Hands off to the [search-jobs worker](../mcp-tool-search-jobs/).
- **needs_review_list** — button #3: "what's waiting in the review queue?" Hands off to the [needs-review worker](../mcp-tool-needs-review-list/).

(The three buttons are `toolWorkflow` nodes — pointers that say "when this tool is picked, run that other workflow and return its answer.")

## Connected to

- **The three worker workflows** in the folders next to this one — they do the actual reading; this one only answers the door. All three must stay ACTIVE or their button goes dead (a lesson already learned and written in the runbook).
- **[03-application-engine](../03-application-engine/)** — the pipeline whose ledger (Google Sheet) the workers read.
- **Shaheen's Claude** — connected as an MCP client; config + full build story: `work/03-application-engine/mcp-server-trigger-runbook.md`. Project doc: `docs/projects/03-application-engine.md`.

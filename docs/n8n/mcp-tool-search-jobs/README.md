# MCP Tool - search_jobs (worker)

**Workflow ID:** `K4OGYfB5g77VU2Jr` · **Runs:** only when the [MCP front desk](../mcp-server-application-engine/) calls it · **Nodes:** 3 · **Export in this folder:** workflow.json (2026-07-01 version, latest)

## What it does

Answers: **"Find me jobs in the ledger matching X."** When Shaheen asks his AI assistant things like "any London remote jobs above fit 75 this week?", the assistant picks the `search_jobs` tool, and this worker reads the pipeline's processed-jobs ledger and returns the matching rows: title, company, location, fit score, status, link.

## Why it exists

Same reason as its sibling workers: the MCP front desk needs one dedicated, replaceable worker per tool. This one turns a spreadsheet of hundreds of judged jobs into something searchable by conversation instead of by scrolling.

## The steps, node by node

- **When Called** - wake-up trigger; fires only when the front desk delegates a search.
- **Read sheet** - opens the pipeline sheet's `processed_jobs` tab (the ledger of every job ever judged).
- **Shape** - plain code that applies the caller's filters (keywords, location, minimum fit, how many results) and formats the hits into a clean answer.

## Connected to

- **[mcp-server-application-engine](../mcp-server-application-engine/)** - owns this tool's button.
- **[03-application-engine](../03-application-engine/)** - the pipeline whose ledger this searches (read-only).

# MCP Tool - needs_review_list (worker)

**Workflow ID:** `0AAbgjjezs16BCCX` · **Runs:** only when the [MCP front desk](../mcp-server-application-engine/) calls it · **Nodes:** 3 · **Export in this folder:** workflow.json (2026-07-01 version, latest)

## What it does

Answers: **"What's sitting in the review queue?"** The pipeline files every near-miss - jobs that scored well but tripped a rule (wrong work condition, grounding doubt, QA flag) - into a `needs_review` tab, each with the reason it was held back. This worker reads that tab and returns the list, so Shaheen can ask his assistant "anything worth overruling today?" and get the queue with reasons, conversationally.

## Why it exists

The review queue is where good jobs go to be forgotten - hundreds of rows deep. Making it askable turns "I should check that tab someday" into a 5-second question. Same architecture logic as its siblings: one tool, one small dedicated worker.

## The steps, node by node

- **When Called** - wake-up trigger; fires only when the front desk delegates.
- **Read sheet** - opens the pipeline sheet's `needs_review` tab.
- **Shape** - plain code that sorts/filters the queue (most recent first, optional filters) and formats it into a readable answer with each job's hold-back reason.

## Connected to

- **[mcp-server-application-engine](../mcp-server-application-engine/)** - owns this tool's button.
- **[03-application-engine](../03-application-engine/)** - the pipeline that fills the review queue this reads (read-only).

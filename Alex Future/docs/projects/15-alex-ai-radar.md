# 15 - Alex AI Radar

## What it actually does
Every Monday at 07:30 it sweeps the AI landscape on free feeds - Hacker News, GitHub releases, Product Hunt, model changelogs, the MCP registry, plus release feeds of the system's *own* tools - and scores what it finds against two compounding memories: a **taste profile** (what Shaheen actually adopts vs ignores, learned from his decisions) and a **friction list** (the stack's known pains - a new tool that kills a known pain outranks any shiny novelty). Findings land as a Radar section in the Monday morning brief and as rows in Notion, where a status gate holds everything at "Interesting" until Shaheen promotes it. Top finds (rare, capped) trigger automatic deep-dive research.

## Why it exists
The AI field moves weekly; falling behind is a career risk for someone whose pitch is "I'm current." But raw news is noise. The radar's whole design is noise-killing: demand-side matching (does it fix OUR friction?), corroboration rules, recency caps, and a permission gate so it can *suggest* but never *adopt*. Proof it works: its first decision spotted n8n's native MCP support, which became the pipeline's MCP server within a week.

## Works together with
- **[Morning Brief](02-morning-brief.md)** - the Monday Radar section is its delivery channel.
- **[Research Team](04-research-team.md)** - auto-commissioned for deep dives on top-scoring finds.
- **[Content Machine](09-content-machine.md)** - its second tap suggests content angles from the same findings.
- **The whole stack** - its self-watch lane monitors updates to the tools the system itself runs on, feeding the Recovery layer's "did our platform change under us?" question.

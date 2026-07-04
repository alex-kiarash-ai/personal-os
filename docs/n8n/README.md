# The n8n Automations — Plain-Language Guide

This folder documents every n8n workflow that is **live right now** on Shaheen's server (n8n.shaheenkiarash.com, a small Hetzner cloud box). One folder per workflow. Each folder holds exactly two files:

- **workflow.json** — the latest export of the real workflow, pulled straight from the server. This is a working backup: if the server ever dies, open n8n anywhere → Workflows → "Import from File" → pick this file, reconnect the credentials, and the automation is back.
- **README.md** — what the automation does, why it exists at all, and what every step (every "node") does, written so a non-technical person can follow it.

Snapshot date: **2026-07-02** (life-ops-sheet-writeback added 2026-07-03). Refresh recipe at the bottom.

## The 13 live workflows

| Folder | What it is, in one line |
|---|---|
| [03-application-engine](03-application-engine/) | The job-hunting robot: finds Power BI / data jobs every morning, writes a tailored CV + cover letter for the good ones. |
| [14-ai-application-engine](14-ai-application-engine/) | Its twin, aimed at AI/automation jobs instead of BI jobs. |
| [mcp-server-application-engine](mcp-server-application-engine/) | The "front desk" that lets Shaheen's AI assistant ask the job pipeline questions in plain language. |
| [mcp-tool-pipeline-status](mcp-tool-pipeline-status/) | Small worker behind the front desk: answers "how did the pipeline run lately?" |
| [mcp-tool-search-jobs](mcp-tool-search-jobs/) | Small worker: answers "find me jobs matching X in the ledger." |
| [mcp-tool-needs-review-list](mcp-tool-needs-review-list/) | Small worker: answers "which jobs are sitting in the review queue?" |
| [hq-metrics-ingest](hq-metrics-ingest/) | The mailbox where every automation drops its daily numbers. |
| [hq-summary-api](hq-summary-api/) | The dashboard's data tap: turns the collected numbers into the summary the Alex HQ app displays. |
| [hq-pipeline-stats](hq-pipeline-stats/) | Daily sidecar that reads both job pipelines' spreadsheets and pushes their stats to the dashboard. |
| [hq-notes-inbox](hq-notes-inbox/) | The two-way lane: Shaheen drops typed or voice notes to Alex from his phone; Alex picks them up later. |
| [pipeline-error-alert](pipeline-error-alert/) | The smoke alarm: any workflow crash becomes a Notion alert the morning brief will surface. |
| [linkedin-series-staging](linkedin-series-staging/) | Tue/Thu prep robot for the "Building Alex" LinkedIn series: stages approved episodes, never posts. |
| [life-ops-sheet-writeback](life-ops-sheet-writeback/) | The plant-and-gym stamp: one authorized web call updates the watering log and gym start date in Shaheen's life-ops spreadsheet, so the morning brief's Life Ops section stays true. |

## Also on the server, but switched OFF (not documented here)

- **Application Engine (X36J9ni0vbZChMWV)** — the original v1 of the job engine, kept as a museum piece after the rebuild. Inactive since 2026-06-11.
- **Lead Enrichment (lead-enrichment-v1)** — an early experiment, dead since 2026-06-02.

## How to refresh these files

Ask Alex to re-run the export, or by hand: `GET https://n8n.shaheenkiarash.com/api/v1/workflows/{id}` with header `X-N8N-API-KEY` (key file: `work/03-application-engine/config/n8n-api-key.txt`, not in the backup). The exports contain **no secrets** — n8n keeps credential values on the server, workflows only reference them by name.

Maintained under the Change Propagation standing order: when a live workflow changes, this folder must be refreshed in the same session. See also `vault/identity.md` (the whole-system map) and `docs/projects/` (the same plain-language treatment for every project, not just the n8n ones).

# The n8n Automations - Plain-Language Guide

This folder documents the n8n workflows that exist on Shaheen's server (n8n.shaheenkiarash.com, a small Hetzner cloud box). Most are running. A few are deliberately switched off and say so in their own row: a workflow can be finished, documented and waiting, and pretending otherwise is how a dead automation hides in a list of live ones. One folder per workflow. Each folder holds exactly two files:

- **workflow.json** - the latest export of the real workflow, pulled straight from the server. This is a working backup: if the server ever dies, open n8n anywhere → Workflows → "Import from File" → pick this file, reconnect the credentials, and the automation is back.
- **README.md** - what the automation does, why it exists at all, and what every step (every "node") does, written so a non-technical person can follow it.

Snapshot date: **2026-07-02** (life-ops-sheet-writeback added 2026-07-03; radar-collector added 2026-07-06; the two job-search lanes added 2026-09-14, both built and both switched off). Refresh recipe at the bottom.

## The 21 documented workflows

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
| [linkedin-series-staging](linkedin-series-staging/) | Scheduled prep robot for the "Building Alex" LinkedIn series: stages approved episodes as text into a per-episode folder, writes the Drive link back, and verifies its writes; never posts. Images are manual. |
| [radar-collector](radar-collector/) | The Radar's always-on ear (added 2026-07-06): collects the AI-landscape feeds daily at 06:00 into a server table; urgent items become same-day notes. |
| [life-ops-sheet-writeback](life-ops-sheet-writeback/) | The plant-and-gym stamp: one authorized web call updates the watering log and gym start date in Shaheen's life-ops spreadsheet, so the morning brief's Life Ops section stays true. |
| [alex-health-ingest](alex-health-ingest/) | The sleep and steps receiver: the phone posts once a night, this turns the sleep stages into a 0 to 100 score and files a row a day. |
| [portal-scanner](portal-scanner/) | The free company-portal job finder: reads each seed company's own hiring system directly, keeps the matches, banks them. Makes no AI call and costs nothing. |
| [portal-application-engine](portal-application-engine/) | The drafting half of the same lane: takes what the scanner banked and writes the CV and cover letter. Drafts only. |
| [quota-reset-autorun](quota-reset-autorun/) | The one-shot gate behind an auto-run armed to fire the moment a usage quota resets. |
| [writer-voice-eval](writer-voice-eval/) | The voice regression test for the job engines' writer. Switched off on purpose: it is run by hand, six set cases, and it has to score six out of six. |
| [34-job-search-bi](34-job-search-bi/) | The Power BI job scout: every weekday it reads LinkedIn and six free job boards, scores what it finds against what Shaheen does, and fills a spreadsheet. It never applies. Built 2026-09-11, switched off. |
| [35-job-search-ai](35-job-search-ai/) | The same 49 steps aimed at AI and automation jobs instead, fifteen minutes later so the two never call the same board in the same minute. Built 2026-09-14, switched off, never run. |

*(Five of those rows were added 2026-09-14. The folders and their READMEs already existed; only the table was missing them, so the heading above counted 21 while the list showed 16. The two job-search rows had also landed outside the table, which renders as a stray second table with no header.)*

**Folder naming.** A folder that belongs to a numbered project is named `NN-project-name`, matching `docs/projects/`. `03-application-engine`, `14-ai-application-engine`, `34-job-search-bi` and `35-job-search-ai` follow it. `portal-scanner` and `portal-application-engine` are older and unnumbered, and they stay as they are: renaming them would break `scripts/reexport-live-workflows.js`, which hardcodes both paths, for a tidiness nobody needs. Workflows that are not a numbered project (the HQ pieces, the MCP tools, the ingests) carry no number, because there is none to carry. *(Ruled 2026-09-14. The build plan asked for `job-search-bi` and `job-search-ai` without the numbers; the numbered form was kept because nothing in the repo reads these folder names programmatically, so the only question is which spelling helps a reader, and a number that matches the project is the one that does.)*

## Also on the server, but switched OFF (not documented here)

- **Application Engine (X36J9ni0vbZChMWV)** - the original v1 of the job engine, kept as a museum piece after the rebuild. Inactive since 2026-06-11.
- **Lead Enrichment (lead-enrichment-v1)** - an early experiment, dead since 2026-06-02.

## How to refresh these files

Ask Alex to re-run the export, or by hand: `GET https://n8n.shaheenkiarash.com/api/v1/workflows/{id}` with header `X-N8N-API-KEY` (key file: `work/03-application-engine/config/n8n-api-key.txt`, not in the backup). The exports contain **no secrets** - n8n keeps credential values on the server, workflows only reference them by name.

Maintained under the Change Propagation standing order: when a live workflow changes, this folder must be refreshed in the same session. See also `vault/identity.md` (the whole-system map) and `docs/projects/` (the same plain-language treatment for every project, not just the n8n ones).

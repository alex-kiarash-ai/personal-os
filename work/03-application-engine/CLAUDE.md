# Application Engine (job-application pipeline rebuild)

## Type
Automation (n8n workflow on the Hetzner box - NOT a local Claude Code automation). This folder holds the regenerated workflow exports + the import runbook. The single source of truth for design is `C:\Users\Thinkpad\Desktop\Job Applications\CV\LinkdIn Automation (1)\job_pipeline_documentation.md` (v1.17).

## Purpose
Daily 07:00 Stockholm: discover LinkedIn jobs per city via Bright Data, score fit + automation-interest with one Claude call, gate deterministically, write tailored CV + cover letter with a second Claude call, QA-gate, render two PDFs via Gotenberg, upload to a per-job Google Drive folder, log every job + cost to the Google Sheet. Review-ready drafts; no auto-submit. Two reasoning calls wrapped in deterministic gates, not a chain of model verifiers.

## Entry Points
- n8n Schedule Trigger: cron `0 7 * * *`, workflow timezone Europe/Stockholm
- Manual Trigger node for tests

## Exports (work/03-application-engine/export/)
| File | Contents |
|---|---|
| Application_Engine_stage1.json | Full importable workflow: triggers → Read Search Config (Sheet) → Filter Active Rows → BD Trigger Search → Attach Row Context → poll loop (Poll Wait 20s → Poll Fetch → Snapshot Ready? with $runIndex>=20 cap) → Parse Jobs (carries work_conditions + origin city/country) → Read Processed Log → Dedup Against Log |
| Application_Engine_stage2_nodes.json | Paste block: Build Match Request (CV + system prompt embedded) → Claude Match+Research (batching 1/1000ms, retry 4×/5s) → Parse Match (now carries origin_location/origin_country) |
| Application_Engine_stage3_nodes.json | Paste block: Stage 3 Gate (per-row work conditions, grounding tripwire, rank_score) → side branch Format Processed Row → Append Processed Job; Passed Gate? → false: Format Review Row S3 → Append Needs Review S3 |
| Application_Engine_stage4_nodes.json | Paste block: Build Writer Request → Claude Writer (batching + retry) → Parse Writer |
| Application_Engine_stage5_nodes.json | Paste block: QA + Fill Templates → QA Passed? → Render CV PDF → Render Cover Letter PDF → Create Drive Folder → Rebind PDFs → Upload CV/CL (parallel) → Merge Uploads → Compute Costs → Append Run Log; QA fail → needs_review |

The old separate poll-loop export is obsolete: the loop is integrated in stage1.

## Wiring after paste (2 manual connections)
1. `Dedup Against Log` (stage1) → `Build Match Request` (stage2)
2. `Passed Gate?` TRUE output (stage3) → `Build Writer Request` (stage4)
3. `Parse Writer` (stage4) → `QA + Fill Templates` (stage5)

## Credentials (n8n)
- `Bright Data Header Auth` (Header Auth, `Authorization: Bearer <key>`) - EXISTS, validated
- `Anthropic account` (anthropicApi) - EXISTS, validated
- Google Sheets OAuth2 (`Google Sheets account`) - **MISSING, the Stage 5b blocker**
- Google Drive OAuth2 (`Google Drive account`) - **MISSING, the Stage 5b blocker**
After creating the two Google credentials, select them on every Sheets/Drive node (placeholders say REPLACE_WITH_GOOGLE_*).

## External IDs (baked into the JSONs)
- Spreadsheet: `19puwN6wxFHI7iICrdafiFn1Diqq7qJTe5-5r0Y2XQFY` (Job Search Pipeline)
- Drive parent folder "Application Engine": `1o0zTBhPLeHfR2xAz9pDGcpvBPtiur4es`
- Bright Data dataset: `gd_lpfll7v5hcqtkxl6l` (discover_by=keyword, type=discover_new, limit_per_input=10)
- Gotenberg: `http://gotenberg:3000/forms/chromium/convert/html` (multipart, field `index.html`)

## Sheet tabs to create ONCE (exact headers, row 1)
- `search_config`: `location | country | keyword | work_conditions | active` (seed the 5 city rows from doc §6)
- `processed_jobs`: `job_posting_id | date | company_name | job_title | gate_status`
- `run_log`: `date | job_posting_id | company | location | country | target_role | fit_score | interest_score | rank_score | model | input_tokens | output_tokens | claude_cost | brightdata_cost | total_cost | drive_folder_url | job_url | status`
- `needs_review`: `date | stage | job_posting_id | job_title | company_name | job_location | url | fit_score | interest_score | rank_score | reasons`

## Config knobs (doc §6)
`fit_threshold=70` and `interest_weight=0.4` live in the Stage 3 Gate code node. `cl_word_min=100` / `cl_word_max=280` live in the QA + Fill Templates code node. `time_range="Past 24 hours"` lives in Filter Active Rows. Change them there; mirror any change into the doc.

## Cost instrumentation
Compute Costs node: claude-sonnet-4-6 at $3/M input + $15/M output across stage2+stage4 tokens; Bright Data $0.00075/record (pay-as-you-go). Every drafted job appends a run_log row; every gate/QA failure appends a needs_review row; every scored job appends processed_jobs (dedup ground truth).

## Vault Structure
- Tier 1: vault/projects/job-pipeline/status.md (existing)
- Tier 2: vault/projects/job-pipeline/infrastructure.md (existing)

## Vault Reads / Writes
Reads: job-pipeline status + infrastructure pages. Writes: status.md after import/first run; vault/log.md per session.

## Notion Integration
None new, by design: the review surface is the Google Sheet (doc decision 1.5, "no push digest"). The Progress Tracker row "Job-application pipeline (n8n)" tracks build status; mark it Done only after the first validated end-to-end run with Google OAuth in place.

## MCP Server (added 2026-07-01, from Alex AI Radar decision #1)
Separate, additive n8n workflow "Application Engine (MCP)" (`CnhvoIVLSc6cUQZG`, active) exposes this pipeline to Shaheen's own Claude/Cursor over MCP via a native **MCP Server Trigger** node. The live 07:00 cron (`9XuIEfxS71DEetVR`) is untouched. Three read-only tools, each backed by an active worker sub-workflow reading the Job Search Pipeline Sheet:
- `pipeline_status` (worker `k4p4TUoGrAuFt3Gg`) - today's jobs/drafts/cost from run_log.
- `search_jobs` (worker `K4OGYfB5g77VU2Jr`) - filter already-scored jobs by `{location,keyword,min_fit}`. **Read-only over run_log history, NO Bright Data crawl / no spend** (a live paid search would be a separate spend-gated tool).
- `needs_review_list` (worker `0AAbgjjezs16BCCX`) - the gate/QA-failure queue, `{limit}`.

Endpoint (streamable HTTP since 2026-07-02, bearer-gated): `https://n8n.shaheenkiarash.com/mcp/app-engine` (trigger bumped typeVersion 1→2 on the radar deep-dive's finding; the old legacy-SSE `/sse` route is gone; backup `config/backup-pre-typebump-1783001244.json`). Bearer cred `S7Q1jSraHTmQXk29` (token NOT in repo/vault - with Shaheen; NOT in `/opt/n8n/.env` either, checked 2026-07-02). Built via the n8n REST API (not Chrome/manual import). **Full build steps, gotchas, demo queries, transport-upgrade log, and rotation procedure: `mcp-server-trigger-runbook.md`.**

## Connections
- Feeds into: Job Search Pipeline sheet (review surface), Google Drive drafts.
- Fed by: nothing. Independent of the Personal OS local automations.

## Known gotchas (from the doc, preserved)
- `time_range` must be the human label (`Past 24 hours`); `past_week` etc. are rejected.
- `remote` filter must stay EMPTY; work condition is verified downstream from the real description.
- `discover_new` returns only never-seen records per query: repeated identical test queries legitimately return `[]`. Vary keyword/location/time_range when testing.
- A 200 + empty array on a niche title is a legitimate zero-job day, not a failure.
- Anthropic concurrency: batching (1 item / 1000ms) + retry-on-fail handles 429s.
- SECURITY TODO (open): rotate the Bright Data API key exposed during setup; update `BRIGHTDATA_API_KEY` on the box and the n8n credential.

## Post-Run (first import session)
1. No people/companies generated at build time.
2. Update vault/projects/job-pipeline/status.md and vault/log.md.
3. Mark the sprint-board row Done only after validated end-to-end run.

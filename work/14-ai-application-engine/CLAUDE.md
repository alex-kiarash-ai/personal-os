# AI Application Engine (AI-directed job pipeline)

## Type
Automation (n8n workflow on the Hetzner box). A faithful CLONE of the BI Application Engine (work/03, workflow `9XuIEfxS71DEetVR`), retargeted to AI / automation roles and embedding the AI CV. Same two-reasoning-calls-wrapped-in-deterministic-gates architecture.

## Purpose
Daily 07:30 Stockholm: discover LinkedIn AI/automation jobs per location via Bright Data, score fit against the AI CV + AI-centrality with one Claude call, gate deterministically, write a tailored AI CV + cover letter with a second Claude call, QA-gate, render two PDFs via Gotenberg, upload to a per-job folder under the AI Drive folder, log every job + cost to the AI sheet. Review-ready drafts, no auto-submit. Runs ALONGSIDE the BI pipeline (does not replace it).

## What differs from the BI pipeline (the only changes; everything else is identical)
1. **Embedded CV** in `Build Match Request` + `Build Writer Request` code nodes → swapped from the combined master to `master_cv_ai.md` (AI-direction CV).
2. **Match system prompt** (`Build Match Request`) → scores fit against AI/automation roles. `target_role` ∈ {"ai", "neither"} (was powerbi/consultant/neither). `interest_score` = how central AI/agents/automation are to the role (now the headline signal).
3. **Gate** (`Stage 3 Gate`) → allowed `target_role` = ['ai'] (plus 'consultant' back-compat). `INTEREST_WEIGHT` left at 0.4 for launch (tuning knob; AI-centrality may warrant 0.5 later). `FIT_THRESHOLD` 70 unchanged.
4. **Writer prompt** (`Build Writer Request`) → AI positioning, leads with Building Alex + automation; data/BI is supporting credibility. (Model: claude-sonnet-4-6, mirroring the live BI pipeline and matching the model-routing rule since its 2026-07-08 correction. The old "migrate to gpt-4.1-mini" TODO is dead: the rule now follows production.)
5. **External IDs + schedule** → new sheet, new Drive folder, cron `30 7 * * *`.

## External IDs (bake into the clone)
- Spreadsheet "AI Job Search Pipeline": `11lvksV5NmLK7vWvt4oHIPTXZ1pwRVi67UrWVI3lrAHQ`
- Drive parent folder "AI Application Engine": `18HUzkLQtKCBd_VGMjBxS94jy8UAJIP4Z`
- Bright Data dataset: `gd_lpfll7v5hcqtkxl6l` (unchanged; discover_by=keyword, discover_new, limit_per_input=10)
- Gotenberg: `http://gotenberg:3000/forms/chromium/convert/html` (unchanged)

## Credentials (n8n) - ALL REUSED, no new OAuth
- `Bright Data Header Auth` - exists, validated
- `Anthropic account` - exists, validated
- `Google Sheets account` (OAuth2) - exists (created for the BI pipeline)
- `Google Drive account` (OAuth2) - exists
After cloning, the new nodes must point at these existing credential IDs (the clone script copies them from the live BI workflow, so they should carry over; verify in the UI).

## Sheet setup (ONE-TIME, on the copied sheet)
The sheet is a copy of the BI one, so all 4 tabs + headers exist. Two manual steps before first run:
1. Replace the `search_config` rows with the AI rows in `config/search-config-seed.md`.
2. Clear the data rows (keep headers) in `processed_jobs`, `run_log`, `needs_review` so the AI ledger starts clean.

## search_config (AI) - see config/search-config-seed.md
Locations locked by Shaheen 2026-06-16: Gulf (Dubai/Qatar/Saudi) on-site+hybrid · London remote · Stockholm hybrid · Europe remote. Titles: AI Automation Engineer, AI Engineer, n8n Developer, Automation Engineer, AI Consultant, Workflow Automation, LLM Engineer.
> KNOWN TUNING ITEM: the literal location "Europe" may return thin/empty Bright Data results. First tuning candidate is to swap the Europe rows for concrete remote hubs (Berlin, Amsterdam, Dublin). Verify on first test.

## Clone method
`config/clone-ai-engine.js` (Node, mirrors work/03 push patterns): fetch live workflow `9XuIEfxS71DEetVR` via n8n API → deep clone → rename "AI Application Engine" → swap CV text in the two Build nodes → patch match/writer system prompts → replace spreadsheet ID (`19puw…` → `11lvk…`) and Drive folder ID (`1o0z…` → `18HUz…`) everywhere → set schedule cron to `30 7 * * *` → POST as new workflow, `active:false`. n8n API key: `work/03-application-engine/config/n8n-api-key.txt`.

## Config knobs
`FIT_THRESHOLD=70`, `INTEREST_WEIGHT=0.4` in `Stage 3 Gate`. `cl_word_min/max` in `QA + Fill Templates`. `time_range="Past 24 hours"` in `Filter Active Rows`. Mirror any change here.

## Vault Structure
- Tier 1: vault/projects/ai-job-pipeline/status.md (create on first run)
- Reuses [[me/cv-sources]] (AI CV), [[projects/job-pipeline/infrastructure]] (shared Hetzner/Bright Data/Gotenberg stack).

## Known gotchas (inherited)
- `time_range` must be the human label ("Past 24 hours").
- `remote` BD filter stays EMPTY; work condition verified downstream from the description against the per-row allow-list.
- `discover_new` returns only never-seen records; repeated identical test queries return []. Vary keyword/location when testing.
- Anthropic concurrency: batching 1/1000ms + retry 4x/5s.
- Bright Data key rotation TODO still open (shared with BI pipeline).

## Post-Run (first import session)
1. New companies found → vault/business/.
2. Create vault/projects/ai-job-pipeline/status.md + update vault/log.md.
3. Routing table row 14 in root CLAUDE.md.
4. Sprint board row "AI Application Engine" → Done only after a validated end-to-end run.

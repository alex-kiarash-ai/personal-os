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

## Skills (bindings, 2026-07-11)
- Identical to #03: n8n-* skills MANDATORY for any workflow edit (n8n-workflow-patterns first); resume-ats-optimizer + resume-tailor advisory for writer-prompt work. See root CLAUDE.md "Skill Bindings".

## Vault Structure
- Tier 1: vault/projects/ai-job-pipeline/status.md (create on first run)
- Reuses [[me/cv-sources]] (AI CV), [[projects/job-pipeline/infrastructure]] (shared Hetzner/Bright Data/Gotenberg stack).

## Known gotchas (inherited)
- `time_range` must be the human label ("Past 24 hours").
- `remote` BD filter stays EMPTY; work condition verified downstream from the description against the per-row allow-list.
- `discover_new` returns only never-seen records; repeated identical test queries return []. Vary keyword/location when testing.
- Anthropic concurrency: batching 1/1000ms + retry 4x/5s.
- Bright Data key rotation TODO still open (shared with BI pipeline).

## P3 write-first reorder (2026-07-12) - bank discoveries BEFORE Claude

Identical mirror of #03's P3 change (full rationale + design: work/03-application-engine/CLAUDE.md §"P3 write-first reorder"), applied to this engine's own sheet (`11lvksV5NmLK7vWvt4oHIPTXZ1pwRVi67UrWVI3lrAHQ`). Backup: `scripts/n8n-backups/9x9M3EnEEeX3O8dy-pre-P3-20260712-1810.json`. 37 -> 41 nodes, GET-verified, active flag preserved.

- New Stage 2 flow: `Dedup Against Log -> Format Sourced Row -> Anything To Bank? -> [true] Bank Sourced Jobs -> Rehydrate Batch -> Build Match Request` ([false] = drain-only batch skips banking).
- Every new deduped job is banked to `processed_jobs` as `gate_status=sourced_unscored` + `payload_json` (full job) BEFORE any Claude call; banked rows drain back into later Match batches until a completed row supersedes them (append-only, no in-place updates - matches the engine's existing sheet pattern).
- Expected until 2026-08-01: runs still die at `Claude Match+Research` on the API cap, but discoveries are banked first; the backlog drains on the first post-cap run. Live-fire proof = the next 07:30 run.
- Untouched: trigger, gates, sanitizer, voice block, Writer nodes.

## Stage 5 network retry-on-fail hardening (2026-07-16)

This engine is where the failure surfaced: exec 1208 (07-16 07:30) died at `Upload CV PDF` on a transient `read ECONNRESET` from Google Drive, after both Claude calls + both PDF renders had already run. Root cause: no `retryOnFail` on any Stage-5 network node. Fixed identically on this engine and #03 (kept in lockstep): `retryOnFail=true, maxTries=4, waitBetweenTries=5000` on `Render CV PDF`, `Render Cover Letter PDF`, `Create Drive Folder`, `Upload CV PDF`, `Upload Cover Letter PDF`. REST API, backup-first (`scripts/n8n-backups/9x9M3EnEEeX3O8dy-pre-retry-20260716-132302.json`), GET read-back verified, active + `errorWorkflow` preserved. Today's failed job was banked `sourced_unscored` (P3) so the next 07:30 cron rehydrates it and completes upload under the retry net. Full rationale + trade-offs: work/03-application-engine/CLAUDE.md §"Stage 5 network retry-on-fail hardening" + [[projects/error-log]] 2026-07-16.

## Post-Run (first import session)
1. New companies found → vault/business/.
2. Create vault/projects/ai-job-pipeline/status.md + update vault/log.md.
3. Routing table row 14 in root CLAUDE.md.
4. Sprint board row "AI Application Engine" → Done only after a validated end-to-end run.

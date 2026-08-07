# AI Application Engine (AI-directed job pipeline)

## 2026-08-07 Anthropic split migration: opus-5 scores, sonnet-5 writes (SUPERSEDES kimi-k3)

Moved off Moonshot kimi-k3 back to Anthropic, Shaheen's call. **`Claude Match+Research` -> `claude-opus-5`**
(fit scoring is the judgment call), **`Claude Writer` -> `claude-sonnet-5`** (the soul.md voice block carries the
prose). Both call `api.anthropic.com/v1/messages` with `anthropic-version: 2023-06-01`.

**Why:** the Moonshot org went to a NEGATIVE balance (`cash_balance -4.37`, `available 0`) and every kimi-k3 call
returned HTTP 429 *"account is suspended due to insufficient balance"*. An account suspension wearing a rate-limit
status code, so retry/backoff/spacing do nothing: 60/60 failed at one call per 3s. The account had been recharged
8.34 USD on 08-05 and drained inside a day. **n8n discards the provider body on a thrown HTTP error**, so the
execution record shows only its canned "too many requests" text - the real reason is not visible there. Read the
body from a live probe before diagnosing a 429.

**Provider migration, not a string swap.** Per lane: the two `Claude *` HTTP nodes repointed to Anthropic with
`predefinedCredentialType`/`anthropicApi`; the two Build nodes rewritten from OpenAI `messages:[system,user]` +
`reasoning_effort` to a top-level Anthropic `system` BLOCK with a `cache_control` breakpoint +
`thinking:{type:'adaptive'}` + `output_config:{effort:'high'}` + user-only `messages`; the two Parse nodes moved
from `choices[0].message.content` to the TEXT blocks of `content[]` and to Anthropic usage fields
(`input_tokens`/`output_tokens`/`cache_creation_input_tokens`/`cache_read_input_tokens`), with `stop_reason`
handling for `max_tokens` and `refusal`. `max_tokens` stays 16384: on this family it caps thinking AND text together.

**The trap that would have failed silently:** adaptive thinking is ON BY DEFAULT on opus-5/sonnet-5, so
`content[0]` is a THINKING block. A `content[0].text` reader returns empty on every call and every job dies at the
gate as a parse error - an outage that looks like a model fault. The parse filters `type === 'text'` and joins.

**Prompt caching is back and it is the cost story:** system prompt + master CV is ~9.3K chars of identical prefix
per job, and Moonshot had no cache-write tier. From the second call in a run that prefix bills at ~0.1x (live probe:
2277 cache-write tokens, 12 uncached input). opus-5 $5/$25 per M, sonnet-5 $3/$15 ($2/$10 intro to 2026-08-31).

**Proven, not asserted:** both credentials probed live on 4 candidate models (200 OK); the exact generated body
shape probed against the real API on both models (200, cache write confirmed); the patched Parse nodes run offline
against healthy / thinking-first / refusal / truncated / n8n-error-item / fenced replies (35/35); Writer Voice Eval
re-run on sonnet-5 = **6/6 ALL PASS, 0 dashes, no AI tells**; independent read-back on all four lanes.

**V6 enforces BOTH models now.** `meta.model_routing.overrides[].models` pins each node by name, because V6 leg (a)
only inspects `checked_node` (`Build Writer Request`) and leg (b) skips voice-sync targets - the opus-5 scoring call
would otherwise have been enforced by nothing. Negative-tested: a deliberately wrong pin fails V6 naming the node.

Script + backups (gitignored, `.gitignore:80`): `work/03-application-engine/config/apply-anthropic-migration-2026-08-07.js`
(`--dry` / `--restore` / `--only=<id>`), `backup-before-anthropic-<id>-*.json`.

**Posture untouched:** #14 keeps its skip-and-survive posture (`onError: continueRegularOutput`, `retryOnFail:false`
- retry is INERT under onError, error-log 2026-08-07) plus the `Run Counter`/`Storm Verdict?`/`Stop On Storm`
tripwire. Verified preserved after the PUT: node count 36, canvas positions unmoved (the counter chain must stay
BELOW the pipeline, see the canvas-position law). The offline proof includes the n8n error-item shape, so the storm
counter and Stage 3 Gate skip path still behave exactly as before.
**Note the tripwire did its job here:** it is what turned a 100%-failure run into a loud ERROR instead of the silent
SUCCESS-with-zero-rows that exec 3703 produced. It reported the outage correctly; the fault was the dry account.

## Type
Automation (n8n workflow on the Hetzner box). A faithful CLONE of the BI Application Engine (work/03, workflow `9XuIEfxS71DEetVR`), retargeted to AI / automation roles and embedding the AI CV. Same two-reasoning-calls-wrapped-in-deterministic-gates architecture.

## Purpose
Tuesday & Thursday 15:30 Stockholm (was every-72h 07:30 until 2026-07-24): discover LinkedIn AI/automation jobs per location via Bright Data, score fit against the AI CV + AI-centrality with one Claude call, gate deterministically, write a tailored AI CV + cover letter with a second Claude call, QA-gate, render two PDFs via Gotenberg, upload to a per-job folder under the AI Drive folder, log every job + cost to the AI sheet. Review-ready drafts, no auto-submit. Runs ALONGSIDE the BI pipeline (does not replace it).

## 2026-08-07 REPAIR: live graph is now 36 nodes. A run can no longer report SUCCESS while producing nothing

Overnight relay run 45, `outputs/sessions/2026-08-06-n8n-engine-repair/`. Every value here was measured off the live API, an execution record or the sheet. Live fingerprint after everything: **36 nodes, active:true, `versionId a8606631-f4fb-43fd-853b-18e94de8d9f4`, `updatedAt 2026-08-07T08:48:07.505Z`**, cron `30 15 * * 2,4` intact, `limit_per_input=4`, QA jsCode sha256 `d303fb84be47b64f20630aac96e84625a23c8e9c022f656dfc0477626e5c25b3`.

**What the 08-06 fix below left open.** `onError: continueRegularOutput` was the right call for ONE refused job. It is the wrong outcome for a TOTAL outage: the run walks the whole pipeline, drafts nothing, and reports **SUCCESS**. A dead model lane became indistinguishable from a quiet day. That is what this repair closes.

**Two changes shipped, both read-back verified, backup-first:**

1. **[S1] Counter + storm tripwire, 4 nodes (32 -> 36): `Run Counter -> Append Run Summary -> Storm Verdict? -> Stop On Storm`**, hanging off BOTH triggers (array `[Run Counter, Read Search Config]`). **[S2] a new 12-column `run_summary` tab** on the AI sheet `11lvksV5NmLK7vWvt4oHIPTXZ1pwRVi67UrWVI3lrAHQ`: `date | exec_id | mode | sourced | scored | err_429_match | err_429_writer | gate_passed | qa_passed | drafted | verdict | note`. Every run writes exactly one row. Verdicts: `ok_drafts`, `zero_output`, `no_jobs`, `storm_error_match`, `storm_error_writer`, `counter_ran_early`. On a 100%-error model lane `Stop On Storm` throws on purpose so the run ends ERROR and the alert workflow fires.
2. **QA rule set D'**, converged with #03 so both engines run the same rule: `ALLOWED_EMPLOYER_TOKENS = ["uc ab","enento","building alex","menigo","self directed"]` as SUBSTRINGS, `independent` **dropped**, dates matched with `d.startsWith(r)` over 6 ranges with a `d !== 'present'` pass-through, `normExpDate` v2. Measured: 46 of 50 on this engine's corpus, zero regressions, the one genuine catch still caught.
   **CROSS-CORPUS RULE (new, do not skip it):** the FIRST attempt at this alignment was tuned on #03's corpus and would have broken **10 of this engine's 46 passing drafts**, because #14's writer DECORATES the employer value ("Self-directed, production AI systems on Claude + n8n") while #03's decorates the date line. The offline gate caught it before a byte shipped and the rule was rebuilt as a union. **A QA rule proven on one engine's corpus does not ship until it is proven on the other's.**

Plus: `Parse Match` upstream cross-ref wrapped in try/catch, `Append Run Log` retry 3x5s. CH-1..4 from the 08-06 fix below all confirmed still live.

**CANVAS-POSITION LAW (n8n 2.30.3, `executionOrder: v1`) - learned on THIS engine, at the cost of three fires.** Parallel branches off the same output execute in **canvas-position order, topmost first**. Connection-array order is IRRELEVANT, proven in both directions. The chain first sat at y=-2064 (the topmost point of the graph) and therefore ran FIRST, reporting zeros; at **y=0, below the pipeline's max y**, it runs LAST and its counts are real. **Do not move those 4 nodes up the canvas.** The `counter_ran_early` sentinel is the permanent tripwire if an n8n upgrade flips it back.

**Proven live, end to end: fire 3713.** Match returned 2 of 2 error-shaped items on HTTP 429 -> verdict `storm_error_match` -> run **ERROR** at `Stop On Storm` -> **Pipeline Error Alert exec 3714** -> Notion page `3b4b5342-d7f1-817d-adaf-f51f885498a5` + HQ metric `n8n_broken_today` + a storm row read back byte-equal from the sheet. Cost across all fires: **$0.00** (429s are free).
**Not yet proven live:** QA rule set D' on a real generated draft, and the counter chain firing from the **cron** path rather than a webhook. Blocked by `moonshot-429-0806` (Moonshot refusing every kimi call, re-confirmed 08-07 08:45Z). Natural proof = the **Tue 2026-08-11 15:30** cron.
**Deliberately NOT mirrored from #03:** the dedup guard (`Read Run Log` + `Dedup Guard`). #03 needed it because Bright Data re-served 39% of prior-day ids there; here `Parse Jobs` still feeds `Build Match Request` directly. Candidate change, not a done one. #03 also keeps the OLD loud 429 posture; that asymmetry is on purpose.
Backups (gitignored, `.gitignore:80`): `config/backup-before-repair-9x9M3EnEEeX3O8dy-2026-08-06T21-09-59-284Z.json` (32 nodes, pre-repair), `config/backup-before-dprime-...T08-42-03-087Z.json` (36, pre-D'), `config/backup-with-fixes-v4-...T08-48-08-095Z.json` (36, current live).

## 2026-08-06 429 resilience + volume cut (this engine ONLY, not mirrored to #03/#32)

Exec 3670 (08-06 15:30) sourced 150 jobs fine, then died at `Claude Match+Research` on **HTTP 429, Moonshot `engine_overloaded_error`, at item 13 of 150**. The 08-04 Bright Data "Customer is not active" block had cleared; this is a different failure. Same day, same cred, same model, same batching: #03 did 46 items in 113s and #32 did 2, both clean. **This engine is oversized, not misconfigured**: 15 active search rows vs #03's 5, so `limit_per_input=10` meant 150 jobs into a per-item reasoning call, and the 07-28 simplify deleted the banking layer so one transient error discarded all 150.

Two changes, live, independently GET-verified, active flag + node count (32) + model literals + URLs unchanged:
1. `Claude Match+Research` + `Claude Writer`: **`onError: continueRegularOutput`, `maxTries` 4 -> 5.** A 429'd job is skipped instead of killing the run. **Retry tuning alone cannot fix this**: n8n caps `maxTries` at 5 and `waitBetweenTries` at 5000ms and both nodes were already at 4/5000.
2. `BD Trigger Search`: **`limit_per_input` 10 -> 4** (URL query param, NOT a search_config column), so 15 x 4 = 60 jobs/run. Cuts depth per search, keeps all 15 searches. Also trims Bright Data spend ($0.00075/record).

**Why the skip path is safe (verified by running the live node code offline, 4/4 cases, not assumed):** `Parse Match` catches the missing `choices[0]`, sets `stage2_parse_error`; `Stage 3 Gate` adds `stage2_parse_error` + `missing_fit_score` + `target_role_missing` so `gate_status` is never `pass`; `Passed Gate?` forwards only `pass`. A skipped job **cannot** reach the writer or become a draft. Healthy control still passes.

Scripts + backups (gitignored, `.gitignore:80`): `config/apply-429-resilience-2026-08-06.js`, `config/apply-limit-per-input-2026-08-06.js`, each reversible in one value. **NOT mirrored to #03/#32 by Shaheen's call** (they work; mirror after the next #14 run proves this). **Unproven until Tue 2026-08-11 15:30** (a manual test today proves little: `discover_new` returns only never-seen records).

> DOC DRIFT, found 08-06, left as-is: live `Stage 3 Gate` runs `FIT_THRESHOLD = 50`, but item 3 of the differences list below still says 70. **Live 50 is the real value.**
> **RESOLVED 2026-08-07 - the SPEC was wrong, the instance was not.** Re-measured on the live API: `FIT_THRESHOLD = 50`, and there is no evidence it was ever 70 on this workflow. **Nothing was changed on the instance;** the "70 unchanged" line was copied from #03 when this engine was cloned and never matched reality. Item 3 and the Config knobs section below now record **50** as the real value. #03 genuinely runs 70 (live-verified the same day), so this is a real per-engine difference, not a typo to be normalized away: the lower bar is what lets a career-changer lane see roles the BI lane would reject.

## 2026-07-28 SIMPLIFY (Shaheen's call): live graph is now 32 nodes, dedup/ledger/review layer DELETED
Applied in lockstep with #03 via `scripts/simplify-engine.js` (2026-07-28 01:45): both engines **50 -> 32 nodes** (verified live). The 18-node dedup/bank/drain/ledger/`needs_review`/timeout layer was deleted, `Compute Costs` gutted to a run_log row builder (no cost maths), `Append Run Log` cut to 9 columns. Net: no dedup ledger (Bright Data `discover_new` only), no banking/drain, **no cross-lane dedup (this engine's `Read Sibling Log` -> #03 is gone, so both engines can now draft the same vacancy)**, no needs_review queue, no cost tracking. The F09 `consultant` match-schema edit SURVIVES (it lives in `Build Match Request`, not a deleted node). Full detail + node list: `work/03-application-engine/CLAUDE.md` §"2026-07-28 SIMPLIFY". Backup: `scripts/n8n-backups/9x9M3EnEEeX3O8dy-pre-simplify-2026-07-28T0145.json`. The remediation section below is now HISTORY.

## 2026-07-27 Remediation (F01-F22): took the graph to 49/50 nodes (SINCE REDUCED to 32 by the 07-28 simplify above)
Applied in lockstep with #03 (both engines 41 -> 49 nodes, active throughout). Everything below that describes the 41-node flow (the "P3 write-first reorder" 37->41 note, the differences list) predates it. The shape changes are identical to #03 - full walkthrough in `work/03-application-engine/CLAUDE.md` §"2026-07-27 Remediation" and the per-finding record `work/03-application-engine/remediation/STATUS.md`. New nodes here too: `Poll Gate`, `All Resolved?`, `Snapshot Ready Item?`, `Format Timeout Row`, `Append Timeout Review`, `CV One Page?`, `Read Sibling Log`, `Read Bank`, `Append Seen Id` (removed: `Snapshot Ready?`). **One #14-only finding: F09 added `consultant` to this engine's match schema** so client-facing automation/AI-consulting postings reach the gate's `['ai','consultant']` allow-list and get the consultant tone instead of the dead-code direct-engineering voice. This engine's `Read Sibling Log` points at #03's `seen_ids`; #03's points here. First live exercise = the first Tue/Thu 15:30 cron after 07-27; no runtime acceptance test has run yet.

## What differs from the BI pipeline (the only changes; everything else is identical)
1. **Embedded CV** in `Build Match Request` + `Build Writer Request` code nodes → swapped from the combined master to `master_cv_ai.md` (AI-direction CV).
2. **Match system prompt** (`Build Match Request`) → scores fit against AI/automation roles. `target_role` ∈ {"ai", "neither"} (was powerbi/consultant/neither). `interest_score` = how central AI/agents/automation are to the role (now the headline signal).
3. **Gate** (`Stage 3 Gate`) → allowed `target_role` = ['ai'] (plus 'consultant' back-compat). `INTEREST_WEIGHT` left at 0.4 for launch (tuning knob; AI-centrality may warrant 0.5 later). ~~`FIT_THRESHOLD` 70 unchanged.~~ **Superseded 2026-08-07: `FIT_THRESHOLD` is 50 here, live-verified, and always has been. #03 runs 70. This is a real per-engine difference, not drift to be normalized away.**
4. **Writer prompt** (`Build Writer Request`) → AI positioning, leads with Building Alex + automation; data/BI is supporting credibility. (Model: **kimi-k3** (Moonshot, `reasoning_effort:'high'`, flipped from `'max'` the same day after a measured comparison) since 2026-07-27, moved from claude-opus-4-8 when all four job lanes went to Kimi K3, Shaheen's call; still mirrors the live BI pipeline. This was a provider swap, NOT a string swap: the `Claude *` HTTP nodes now call `api.moonshot.ai/v1/chat/completions` via the `Kimi K3 (Moonshot header)` cred, OpenAI-format bodies, `max_tokens` raised to 16384. `Compute Costs` repriced to kimi-k3 $3/$0.30/$15. See root CLAUDE.md Model Routing + manifest `meta.model_routing`.)
5. **External IDs + schedule** → new sheet, new Drive folder, cron `30 15 * * 2,4` (Tue & Thu 15:30; changed 2026-07-24 from the every-72h `30 7 */3 * *`).

## External IDs (bake into the clone)
- Spreadsheet "AI Job Search Pipeline": `11lvksV5NmLK7vWvt4oHIPTXZ1pwRVi67UrWVI3lrAHQ`
- Drive parent folder "AI Application Engine": `18HUzkLQtKCBd_VGMjBxS94jy8UAJIP4Z`
- Bright Data dataset: `gd_lpfll7v5hcqtkxl6l` (unchanged; discover_by=keyword, discover_new, limit_per_input=10)
- Gotenberg: `http://gotenberg:3000/forms/chromium/convert/html` (unchanged)

## Credentials (n8n) - ALL REUSED, no new OAuth
- `Bright Data Header Auth` - exists, validated
- `Kimi K3 (Moonshot header)` (httpHeaderAuth, id `OffvMkWR01zcpqxo`) - the model credential since 2026-07-27; the `Claude Match+Research` + `Claude Writer` nodes call Moonshot through it.
- `Anthropic account 2 (AI engine, split 2026-07-06)` - exists, NO LONGER USED by the model nodes (kept for rollback).
- `Google Sheets account` (OAuth2) - exists (created for the BI pipeline)
- `Google Drive account` (OAuth2) - exists
After cloning, the new nodes must point at these existing credential IDs (the clone script copies them from the live BI workflow, so they should carry over; verify in the UI).

## Sheet setup (ONE-TIME, on the copied sheet)
The sheet is a copy of the BI one, so all 4 tabs + headers exist. Two manual steps before first run:
1. Replace the `search_config` rows with the AI rows in `config/search-config-seed.md`.
2. Clear the data rows (keep headers) in `processed_jobs`, `run_log`, `needs_review` so the AI ledger starts clean.

A fifth tab was added 2026-08-07: **`run_summary`** (`date | exec_id | mode | sourced | scored | err_429_match | err_429_writer | gate_passed | qa_passed | drafted | verdict | note`), one row per run. **Live tabs this engine actually touches: `search_config` (read), `run_log` (write), `run_summary` (write).** `processed_jobs` and `needs_review` are historical data only since the 07-28 simplify. Rows in `run_summary` are append-only and never cleared, including the three fire rows from the 08-06/07 repair (3711 `no_jobs`, 3712 `counter_ran_early`, 3713 `storm_error_match`) - they are the physical evidence of the ordering fix.

## search_config (AI) - see config/search-config-seed.md
Locations locked by Shaheen 2026-06-16: Gulf (Dubai/Qatar/Saudi) on-site+hybrid · London remote · Stockholm hybrid · Europe remote. Titles: AI Automation Engineer, AI Engineer, n8n Developer, Automation Engineer, AI Consultant, Workflow Automation, LLM Engineer.
> KNOWN TUNING ITEM: the literal location "Europe" may return thin/empty Bright Data results. First tuning candidate is to swap the Europe rows for concrete remote hubs (Berlin, Amsterdam, Dublin). Verify on first test.

## Clone method
`config/clone-ai-engine.js` (Node, mirrors work/03 push patterns): fetch live workflow `9XuIEfxS71DEetVR` via n8n API → deep clone → rename "AI Application Engine" → swap CV text in the two Build nodes → patch match/writer system prompts → replace spreadsheet ID (`19puw…` → `11lvk…`) and Drive folder ID (`1o0z…` → `18HUz…`) everywhere → set schedule cron to `30 7 * * *` → POST as new workflow, `active:false`. n8n API key: `work/03-application-engine/config/n8n-api-key.txt`.

## Config knobs
**`FIT_THRESHOLD=50`** (live-verified 2026-08-07; this line read 70 until then and was never true of this workflow - see the RESOLVED note at the top. **#03 runs 70; do not "fix" this to match it.**), `INTEREST_WEIGHT=0.4` in `Stage 3 Gate`. `cl_word_min/max` in `QA + Fill Templates`. `time_range="Past week"` (lowercase, case-sensitive; widened from `"Past 24 hours"` 2026-07-16 for the 72h cadence) in `Filter Active Rows`. `limit_per_input=4` on the `BD Trigger Search` URL (a query param, not a sheet column; #03 runs 10). Mirror any change here.
**QA whitelist (rule set D', 2026-08-07)** lives in the `QA + Fill Templates` code node: `ALLOWED_EMPLOYER_TOKENS` (5 substring tokens) + `ALLOWED_DATE_RANGES` (6 ranges, `startsWith` matched) + `normExpDate` v2. Byte-equivalent logic to #03's. **Any edit must be replayed offline against BOTH engines' recorded draft corpora before it ships** (harness: `outputs/sessions/2026-08-06-n8n-engine-repair/agent3c-crosscorpus-gate.js`); the two writers decorate different CV fields, so a rule that looks clean on one corpus can silently kill drafts on the other.

## Skills (bindings, 2026-07-11)
- Identical to #03: n8n-* skills MANDATORY for any workflow edit (n8n-workflow-patterns first); resume-ats-optimizer + resume-tailor advisory for writer-prompt work. See root CLAUDE.md "Skill Bindings".

## Vault Structure
- Tier 1: vault/projects/ai-job-pipeline/status.md (create on first run)
- Reuses [[me/cv-sources]] (AI CV), [[projects/job-pipeline/infrastructure]] (shared Hetzner/Bright Data/Gotenberg stack).

## Known gotchas (inherited)
- `time_range` is CASE-SENSITIVE: VALID `Past 24 hours` / `Past week` / `Past month` (lowercase); `Past Week` / `Past Month` capitalized are REJECTED with HTTP 400. Live value = `Past week`. See #03 gotchas + [[projects/error-log]] 2026-07-20 (the capital-W typo broke both engines' Stage 1 on 07-19).
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

## Trifecta
Gate: **draft-only**. Legs: private_data=true, untrusted_content=true, external_comm=true (agent-security Rule-of-Two, three-plan validation P3, 2026-07-17). All three legs true (AI-track clone of #03): private + untrusted job postings + outbound drafts. Draft + stage, Shaheen submits. Source of truth: the `trifecta` block in system/manifest.json + [[research/trifecta-map]]. Validator V12 fails the build if this gate stops matching the manifest.

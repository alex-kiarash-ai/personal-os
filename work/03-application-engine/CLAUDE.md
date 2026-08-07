# Application Engine (job-application pipeline rebuild)

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

**Posture untouched:** the loud posture set by the 08-07 repair (retry 4x5s, no `onError`, no `batchInterval`) is
preserved; the migration never writes `onError`/retry flags and asserts they survive. The QA rule set D', the dedup
guard and the counter/storm chain are untouched, node count still 38, canvas positions unmoved.
**Still unproven live:** QA rule set D' on a real generated draft. It was blocked on the Moonshot outage; that
blocker is now gone, so the natural proof is the **Tue 2026-08-11 15:00** cron.

## Type
Automation (n8n workflow on the Hetzner box - NOT a local Claude Code automation). This folder holds the regenerated workflow exports + the import runbook. The single source of truth for design is `C:\Users\Thinkpad\Desktop\Job Search\Job Applications\CV\LinkdIn Automation (1)\job_pipeline_documentation.md` (v1.17). (Path corrected 2026-07-25: the CV folder moved under `Desktop\Job Search\` on 07-21.)

## Purpose
Tuesday & Thursday 15:00 Stockholm (was every-72h 07:00 until 2026-07-24): discover LinkedIn jobs per city via Bright Data, score fit + automation-interest with one Claude call, gate deterministically, write tailored CV + cover letter with a second Claude call, QA-gate, render two PDFs via Gotenberg, upload to a per-job Google Drive folder, log every job + cost to the Google Sheet. Review-ready drafts; no auto-submit. Two reasoning calls wrapped in deterministic gates, not a chain of model verifiers.

## 2026-08-07 REPAIR: live graph is now 38 nodes. QA rule set D', a dedup guard, and a run_summary row per run

Overnight relay run 45, `outputs/sessions/2026-08-06-n8n-engine-repair/`. Every value here was measured off the live API, an execution record or the sheet. Live fingerprint after everything: **38 nodes, active:true, `versionId 96240ce7-ec6c-4290-9914-86cabaabbf04`, `updatedAt 2026-08-07T08:47:23.184Z`**, cron `0 15 * * 2,4` intact, `limit_per_input=10` unchanged, QA jsCode sha256 `3a47ebb650409f65e96056e37e3f60c5f3f4a398664f4b1de7ab86ec18c20f07`.

**Root cause of "the engine is broken": `QA + Fill Templates` was killing truthful drafts.** The `fabricated_experience` whitelist matched too literally and fired on the writer's own correct output. **18 of 19 real drafts died on it since 07-27, and 14 of 14 on the 08-06 Thursday cron** (exec 3668: sourced fine, 46 clean model calls, **$1.61 spent, zero rows written, run reported SUCCESS**). Not Bright Data, not Moonshot, not billing.

**Three changes shipped, all read-back verified, backup-first:**

1. **QA rule set D' (also on #14, byte-equivalent logic).** `ALLOWED_EMPLOYER_TOKENS = ["uc ab","enento","building alex","menigo","self directed"]` matched as SUBSTRINGS; the `independent` token **dropped** (it admitted "Independent Consulting Group of Berlin" and no measured draft needed it); dates matched with `d.startsWith(r)` over 6 whitelisted ranges (incl. the merged `jan2019jun2021`) with a `d !== 'present'` pass-through, because the master CV decorates its own date lines; `normExpDate` v2 tokenizes and drops range connectors. Measured on the real corpus: **1 pass in 19 -> 18 in 19**, zero reason drift, all fabrication controls still caught. Named accepted residual: an invented employer starting with "Self-directed" passes. It is a tripwire, not a proof; drafts are human-reviewed.
   **CROSS-CORPUS RULE (new, do not skip it):** a QA rule proven on ONE engine's draft corpus does not ship until it is proven on the OTHER's. The first version of this rule was tuned on #03's 19 drafts and would have broken **10 of #14's 46 passing drafts**, because the two writers decorate different fields (#03 the date line, #14 the company line). The gate caught it before a byte shipped.
2. **[S3] Dedup guard, 2 nodes.** `Parse Jobs -> Read Run Log -> Dedup Guard -> Build Match Request`. `Read Run Log` is a Sheets read of the whole `run_log` tab (`executeOnce`, `alwaysOutputData`, retry 4x5s, `onError: continueRegularOutput`); `Dedup Guard` drops any job whose `job_posting_id` is already drafted, **before the first paid call**, and stamps `_dedup_skipped` + `_dedup_mode`. **FAIL-OPEN by design:** a failed sheet read means process everything and say so in the run row, because a visible duplicate beats a lost pipeline day. Within-engine only; this does NOT restore cross-lane dedup with #14.
3. **[S4] `run_summary` tab + counter/storm chain, 4 nodes.** `Run Counter -> Append Run Summary -> Storm Verdict? -> Stop On Storm`, hanging off BOTH triggers (`[Run Counter, Read Search Config]`). Every run writes exactly one 12-column row, drafts or none. A 100%-error model lane ends the run in ERROR on purpose so the alert workflow fires. Sentinel verdict `counter_ran_early` guards the ordering law below.

Plus: `Parse Match` upstream cross-ref wrapped in try/catch (an error-shaped item no longer crashes it), `Append Run Log` retry 3x5s, and `remediation/apply-m3-qa.js` moved to D' so a rebuild cannot re-ship the broken rule.

**CANVAS-POSITION LAW (n8n 2.30.3, `executionOrder: v1`) - the most transferable thing learned here.** Parallel branches off the same output execute in **canvas-position order, topmost first**. Connection-array order is IRRELEVANT, proven in both directions across three fires. The counter chain sits at **y=0, below the pipeline's max y**, which is the only reason its counts are real. **Do not move those 4 nodes up the canvas.** If a future n8n upgrade flips this, the `counter_ran_early` sentinel row says so instead of silently reporting zeros.

**Proven live:** fire **3737** = dedup forward path (guard forwarded exactly 1 of 2, `_dedup_skipped:1`, the already-drafted job dropped pre-model), then Moonshot 429 -> throw -> run ERROR -> alert exec **3739**. Fire **3721** = counter runs last on this graph + a truthful summary row appended and read back byte-equal. Model spend across all fires: **$0.00** (429s are free).
**Not yet proven live:** QA rule set D' on a real generated draft. Blocked by `moonshot-429-0806` (Moonshot refusing every kimi call, re-confirmed 08-07 08:45Z). Natural proof = the **Tue 2026-08-11 15:00** cron.
**Deliberately NOT touched:** the two Kimi nodes keep the loud posture (retry 4x5s, no `onError`, no `batchInterval`), unlike #14's skip-and-survive posture. Asymmetry on purpose; reconcile only after Tuesday.
Backups (gitignored, `.gitignore:80`): `config/backup-before-repair-9XuIEfxS71DEetVR-2026-08-07T03-22-09-245Z.json` (32 nodes, pre-repair), `config/backup-before-dprime-...T08-42-03-087Z.json` (38, pre-D'), `config/backup-with-fixes-v2-...T08-43-35-348Z.json` (38, current live).

## 2026-07-28 SIMPLIFY (Shaheen's call): live graph is now 32 nodes, dedup/ledger/review layer DELETED
`scripts/simplify-engine.js` ran 2026-07-28 01:45 and stripped both engines to a lean `source -> score -> gate -> draft -> render -> log` flow: **50 -> 32 nodes** (verified live: #03 + #14 both 32, active). It DELETED 18 nodes per engine - the whole dedup/bank/drain/ledger/review layer the remediation + P3 had built: `Read Processed Log`, `Dedup Against Log`, `Format Sourced Row`, `Anything To Bank?`, `Bank Sourced Jobs`, `Rehydrate Batch`, `Read Bank`, `Append Seen Id`, `Read Sibling Log`, `Seen Ids Failed`, `Format/Append Processed Job`, both `needs_review` writer pairs (S3 + S5), and `Format/Append Timeout Review`. It also gutted `Compute Costs` (now just a run_log row builder, NO cost/token maths) and cut `Append Run Log` to 9 columns (`date, job_posting_id, company, location, rank_score, model, drive_folder_url, job_url, status`). **Net effect, state it plainly:** no dedup ledger (dedup now leans on Bright Data's `discover_new` only), no banking/drain, no cross-lane dedup, no needs_review queue (gate/QA/one-page failures dead-end unlogged), no per-job cost tracking; `run_log` is the sole sheet write. **CORRECTED 2026-08-07, the `discover_new` half of that sentence was measured FALSE:** `discover_new` is not a dedup mechanism. On 08-06 it **re-served 39% of the previous day's job ids**, and one posting (Voyado `4431208410`, run_log row 17) came back as new with a rewritten posted-date **six weeks** after it was drafted. From 07-28 to 08-07 this engine had **no dedup at all**. The `Read Run Log` + `Dedup Guard` pair added in the 08-07 repair is now the real mechanism; `run_log` is read as well as written. Cross-lane dedup with #14 is still gone. The remediation section below is now HISTORY - most of what it added (F03/F04 cost, F07 parse, F16 sanitizer-in-QA, F08/F10/F11 QA gates survive; F01-timeout, F03-columns, F18-mapping-on-deleted-nodes, F19, F20, P3 are gone). Backups: `scripts/n8n-backups/{id}-pre-simplify-2026-07-28T0145.json`. The two overnight `apply-audit-fixes-engines.js` (V2/Fix3/Fix8/Fix9/Fix10 prompt tweaks + `limit_per_input` 25->10) and `apply-fix4.js` batches ran the same night; confirm which persisted before quoting their in-node tweaks (engine `updatedAt` is 01:45 = the simplify).

## 2026-07-27 Remediation (F01-F22): took the graph to 49/50 nodes (SINCE REDUCED to 32 by the 07-28 simplify above)
The external senior-review plan (`Desktop\engines-03-14-remediation-plan.md`) was applied 2026-07-27 to BOTH engines, which went **41 -> 49 nodes** and stayed active throughout. Everything below that describes the 41-node flow (the Exports table, the stage walkthroughs, P3) predates it. Full per-finding record + rollback map: `work/03-application-engine/remediation/STATUS.md`. The load-bearing shape changes:
- **Sourcing loop rebuilt (F01/F02):** the per-item `Snapshot Ready?` IF is gone, replaced by `Poll Gate` + `All Resolved?` (the whole batch advances together) + `Snapshot Ready Item?`; a never-ready snapshot now writes a loud `stage1`/`snapshot_timeout` row to needs_review via `Format Timeout Row` -> `Append Timeout Review` instead of parsing into an empty successful run.
- **Ledger split (F19):** `Read Processed Log` now reads a compact `seen_ids` tab; a new `Read Bank` supplies payloads from a `bank` tab; a new `Append Seen Id` mirrors each completed row. `processed_jobs` stays as the full analytics ledger, off the hot read path. Backfilled #03 345+86, #14 1962+586. (These two new nodes are why the count is 49, not 47 - the remediation STATUS.md headline still says 47, written before F19 ran.)
- **Cross-lane dedup (F20, Option B):** a new `Read Sibling Log` reads the other engine's `seen_ids`; the first engine to source a job owns it, so a vacancy matching both search sets is never drafted twice. Fail-open.
- **Cost ledger reshaped (F03/F04):** stage-2 cost on the processed row, stage-4 cost on run_log + the S5 review row (gate-failed and QA-failed spend finally counted); a `RATES` map keyed by model incl. cache tokens.
- **QA hardened (F08/F10/F11/F16/F17):** employer+date whitelist derived from the master CV (F08), legal-suffix-normalized company-mention check (F10), a `CV One Page?` gate blocking multi-page uploads (F11), the dash sanitizer moved out of `Parse Writer` so QA is its sole owner (F16), Drive slug gains `job_posting_id` (F17).
- **Calls hardened (F05/F07/F12/F13/F14/F15):** cached system blocks (F05), a three-stage parse extractor (F07 parse-side; the assistant-prefill half was reverted - this model 400s on it), BD retry (F12), `limit_per_input` 10->25 (F13), score clamp (F14), match `max_tokens` ->2048 (F15).
- **Explicit column mapping (F18):** every append node maps columns by name; sheets gained columns to processed_jobs 12 / run_log 22 / needs_review 17.
- **Model (2026-07-27, separate from the remediation):** both model nodes now run Moonshot `kimi-k3` at `reasoning_effort:'high'`, not claude-opus-4-8 (see Credentials + Cost sections). No runtime acceptance test has run yet; first live exercise = the first Tue/Thu 15:00 cron after 07-27.

## Entry Points
- n8n Schedule Trigger (node "Tue & Thu 15:00 Stockholm"): cron `0 15 * * 2,4`, workflow timezone Europe/Stockholm (changed 2026-07-24 from the every-72h `0 7 */3 * *`)
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
- `Kimi K3 (Moonshot header)` (httpHeaderAuth, `Authorization: Bearer sk-...`, id `OffvMkWR01zcpqxo`, allowedDomains `api.moonshot.ai`) - the model credential since 2026-07-27; the `Claude Match+Research` + `Claude Writer` HTTP nodes now call `https://api.moonshot.ai/v1/chat/completions` through it. Created from Shaheen's "Kimi K3 personal" key. Value in the credentials-ledger pointer + his password manager only.
- `Anthropic account` (anthropicApi) - EXISTS, validated. NO LONGER USED by the model nodes (kept for rollback: reverting is a model-node swap back to this cred + the Anthropic body format).
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
- `run_summary` (added 2026-08-07, sheet `19puwN6wxFHI7iICrdafiFn1Diqq7qJTe5-5r0Y2XQFY`): `date | exec_id | mode | sourced | scored | err_429_match | err_429_writer | gate_passed | qa_passed | drafted | verdict | note` - exactly one row per run, whatever the outcome. **Live tabs the engine actually touches now: `search_config` (read), `run_log` (read + write), `run_summary` (write).** `processed_jobs` / `needs_review` remain as historical data only.

## Config knobs (doc §6)
`fit_threshold=70` and `interest_weight=0.4` live in the Stage 3 Gate code node (live-verified 70 on 2026-08-07; **note #14 runs 50, not 70** - do not mirror this one blind). `cl_word_min=100` / `cl_word_max=280` live in the QA + Fill Templates code node. `time_range="Past week"` (lowercase, current live value; widened from `"Past 24 hours"` on 2026-07-16 for the 72h cadence) lives in Filter Active Rows - it is CASE-SENSITIVE, see the gotcha below. `limit_per_input=10` is a query param on the `BD Trigger Search` URL, not a sheet column (#14 runs 4). Change them there; mirror any change into the doc.
**QA whitelist (rule set D', 2026-08-07)** also lives in the QA + Fill Templates code node: `ALLOWED_EMPLOYER_TOKENS` (5 substring tokens) + `ALLOWED_DATE_RANGES` (6 ranges, `startsWith` matched) + `normExpDate` v2. It is the single most breakage-prone knob in the engine, since a too-literal list silently kills every draft while the run stays green. **Any edit to it must be replayed offline against BOTH engines' recorded draft corpora before it ships** (harness pattern: `outputs/sessions/2026-08-06-n8n-engine-repair/agent3c-crosscorpus-gate.js`), and the regeneration path `remediation/apply-m3-qa.js` must be updated in the same session or the next rebuild reverts it.

## Skills (bindings, 2026-07-11)
- n8n work on this pipeline (nodes, expressions, Code-node JS, validation, the MCP server) is MANDATORY-gated on the n8n-* skills - see root CLAUDE.md "Skill Bindings". Consult n8n-workflow-patterns BEFORE touching workflow JSON; n8n-cli (+ `@n8n/cli` binary) for instance ops from shell.
- resume-ats-optimizer + resume-tailor (advisory): check writer/CV prompt upgrades against their ATS + tailoring checklists.

## Cost instrumentation
Compute Costs node: **kimi-k3 at $3/M input + $15/M output** ($0.30/M cached input; repriced 2026-07-27 when all four job lanes moved from Opus 4.8 to Moonshot kimi-k3, Shaheen's call; Opus was $5/$25, the 07-24 pricing) across stage2+stage4 tokens; Bright Data $0.00075/record (pay-as-you-go). The shared `_rates-lib.js` (master + the 3 injected copies) carries the `kimi-k3` rate; token fields now read Moonshot's `prompt_tokens`/`completion_tokens`/`prompt_tokens_details.cached_tokens` (Moonshot has no cache-write premium, so cache_write is null). NOTE on cost/latency: `reasoning_effort` is now `'high'` (flipped from `'max'` on 2026-07-27 after a measured side-by-side: high ~1.4k reasoning tokens + ~79s/call vs max ~6k + ~231s, near-identical draft quality, both pass voice + 0 dashes, at ~1/3 the latency and ~half the cost; max's only edge was a slightly sharper opening line). `max_tokens` was raised 2048/4096 -> 16384 (sized for max's worst-case reasoning burn, kept as headroom on high) and the model HTTP nodes carry a 10-min timeout. One-line reversible: set `reasoning_effort` back to `'max'` in the Build nodes. Every drafted job appends a run_log row; every gate/QA failure appends a needs_review row; every scored job appends processed_jobs (dedup ground truth). **Corrected 2026-08-07:** only the first clause survived the 07-28 simplify, which deleted the `needs_review` and `processed_jobs` writers. A gate or QA failure is now **counted** in the `run_summary` row (`gate_passed`, `qa_passed`, `drafted`, `verdict`) but still not written per job. Dedup ground truth is `run_log`, read by `Dedup Guard`.

## Writer Voice Eval (regression harness, added 2026-07-07, upgrade-scan item 5)
Separate ADDITIVE n8n workflow **"Writer Voice Eval"** (`grMqmGzzbTXTEdKr`, INACTIVE - the live Tue+Thu 15:00 cron `9XuIEfxS71DEetVR` is untouched). Reuses the writer nodes VERBATIM (Build Writer Request + Claude Writer + Parse Writer) so it exercises the EXACT production prompt, fed by a "Build Match Request" node of 6 seeded cases carrying every field the writer reads (job_title, company_name, job_location, description, target_role, fit/interest scores + rationales, matched_keywords, gaps, company_facts, work_condition_detected). Then two Code nodes: **Writer Metrics** (deterministic, per case: em/en dashes in cover+profile prose = 0 with CV dates excluded, no AI-tell phrases, cover word-count in [100,280], all structure fields present, JSON parses) and **Eval Summary** (total/passed/failed/pass_rate/verdict + labelled failures). No judge tokens.
- **Run:** n8n editor → open the workflow → **Execute workflow**. Do this after every generator run that re-syncs the voice block (`node scripts/generate-alex.js`; the soul-voice sync lives inside it since 2026-07-08, and the eval is a sync TARGET, so its writer stays in lockstep with the live engines).
- **Requires:** the n8n box **registered** for the free Community-edition key (done 2026-07-07) so the Evaluations feature area is available; the workflow itself uses standard nodes so it runs regardless.
- **First run (2026-07-07):** 4/6 pass. Caught 2/6 cover letters with dashes despite the no-dash rule and confirmed the live writer was `claude-sonnet-4-6` at that time (**the eval writer moved to `claude-opus-4-8` on 2026-07-24, then to Moonshot `kimi-k3` at `reasoning_effort:'high'` on 2026-07-27, always in lockstep with the two live engines**; the old gpt-4.1-mini wording was never applied in production). Re-test after any model swap = run this eval; it passed for kimi-k3 on the 07-27 rollout.
- **Dash-sanitizer added (2026-07-07, Shaheen's go):** the **Parse Writer** node of #03, #14 AND the eval now runs a deterministic pass over the prose fields - `deDashProse` (em-dash -> comma; en-dash -> comma with numeric ranges protected) on cover_letter/profile/role_line, `deEm` (em-dash -> comma only, date en-dashes kept) on experience/skills. Applied via the REST API (backup-first in scripts/n8n-backups/, syntax-checked, GET-verified; both engines stayed active, 37->37 nodes). Re-ran the eval: **6/6 ALL PASS** (was 4/6). The eval now grades the SHIPPED post-sanitize output, so a dash there = a sanitizer edge-case miss (not a routine writer slip).
- Build script pattern (backup-first via API, verbatim node reuse): the writer node copy + metrics were created via the REST API, tested by executing in the editor (the public API can't trigger runs).

## Outcome loop (added 2026-07-20, agent-architecture decision run item 6.3)
The engines are the SOURCE side of Alex's outcome loop: they already log variant identifiers to the Job Search Pipeline Sheet (step 8). Those variant features + the outcome states (from email-triage classifications and Notion rows) feed the Tier 2 outcome table `vault/projects/job-pipeline/outcomes/` via the deterministic zero-token collector `scripts/alex-outcome-loop.js` (runs nightly in the vault-backup chain; see its README for the row schema and the `add` / `ingest-sheet` ingest paths). The loop resolves which CV/letter variants actually drew responses so the writers can favor them next cycle.
- **Built-ready writer block:** `work/03-application-engine/outcome-winners.block.md` (marker-wrapped, `<<<OUTCOME_WINNERS_START/END>>>`, same idempotent-marker shape as the SOUL_VOICE sync). It is regenerated on every collector run but is **OFF from the live n8n push** for now — injecting an empty block into production is pointless.
- **Activation trigger (do NOT fire before):** a real winner exists (a variant value with ≥ 5 resolved outcomes) AND the 60-day measurement shows the loop is read/acted on (honesty rail). Then wire it into the generator's n8n step beside the voice sync, with the same backup-first + GET read-back verification, and re-run the Writer Voice Eval to prove the added block did not break the voice.

## Vault Structure
- Tier 1: vault/projects/job-pipeline/status.md (existing)
- Tier 2: vault/projects/job-pipeline/infrastructure.md (existing) + vault/projects/job-pipeline/outcomes/ (outcome loop, 2026-07-20)

## Vault Reads / Writes
Reads: job-pipeline status + infrastructure pages. Writes: status.md after import/first run; vault/log.md per session.

## Notion Integration
None new, by design: the review surface is the Google Sheet (doc decision 1.5, "no push digest"). The Progress Tracker row "Job-application pipeline (n8n)" tracks build status; mark it Done only after the first validated end-to-end run with Google OAuth in place.

## MCP Server (added 2026-07-01, from Alex AI Radar decision #1)
Separate, additive n8n workflow "Application Engine (MCP)" (`CnhvoIVLSc6cUQZG`, active) exposes this pipeline to Shaheen's own Claude/Cursor over MCP via a native **MCP Server Trigger** node. The live Tue+Thu 15:00 cron (`9XuIEfxS71DEetVR`) is untouched. Three read-only tools, each backed by an active worker sub-workflow reading the Job Search Pipeline Sheet:
- `pipeline_status` (worker `k4p4TUoGrAuFt3Gg`) - today's jobs/drafts/cost from run_log.
- `search_jobs` (worker `K4OGYfB5g77VU2Jr`) - filter already-scored jobs by `{location,keyword,min_fit}`. **Read-only over run_log history, NO Bright Data crawl / no spend** (a live paid search would be a separate spend-gated tool).
- `needs_review_list` (worker `0AAbgjjezs16BCCX`) - the gate/QA-failure queue, `{limit}`.

Endpoint (streamable HTTP since 2026-07-02, bearer-gated): `https://n8n.shaheenkiarash.com/mcp/app-engine` (trigger bumped typeVersion 1→2 on the radar deep-dive's finding; the old legacy-SSE `/sse` route is gone; backup `config/backup-pre-typebump-1783001244.json`). Bearer cred `S7Q1jSraHTmQXk29` (token NOT in repo/vault - with Shaheen; NOT in `/opt/n8n/.env` either, checked 2026-07-02). Built via the n8n REST API (not Chrome/manual import). **Full build steps, gotchas, demo queries, transport-upgrade log, and rotation procedure: `mcp-server-trigger-runbook.md`.**

## Connections
- Feeds into: Job Search Pipeline sheet (review surface), Google Drive drafts.
- Fed by: nothing. Independent of the Personal Ops System local automations.

## Known gotchas (from the doc, preserved)
- `time_range` is CASE-SENSITIVE and must be an exact Bright Data label. VALID: `Past 24 hours`, `Past week`, `Past month` (lowercase w/m - verified against the live BD trigger 2026-07-20). REJECTED with HTTP 400 `Invalid input provided`: `Past Week` / `Past Month` (capitalized) and `past_week`. Live value = `Past week` (widened 2026-07-16 for the 72h cadence; the capital-W typo in that change silently broke Stage 1 - `BD Trigger Search` 400 - on BOTH engines 2026-07-19, fixed 2026-07-20; see [[projects/error-log]]).
- `remote` filter must stay EMPTY; work condition is verified downstream from the real description.
- `discover_new` returns only never-seen records per query: repeated identical test queries legitimately return `[]`. Vary keyword/location/time_range when testing. **CORRECTED 2026-08-07: true as a TESTING note, false as a DEDUP guarantee.** Measured on 08-06: `discover_new` re-served **39% of the prior day's ids**, plus a posting from six weeks earlier carrying a rewritten posted-date. Never treat it as "this job is new"; that is `Dedup Guard`'s job now.
- A 200 + empty array on a niche title is a legitimate zero-job day, not a failure.
- Anthropic concurrency: batching (1 item / 1000ms) + retry-on-fail handles 429s.
- SECURITY TODO (open): rotate the Bright Data API key exposed during setup; update `BRIGHTDATA_API_KEY` on the box and the n8n credential.

## P3 write-first reorder (2026-07-12) - bank discoveries BEFORE Claude

Context: both engines CAP-DEAD until 2026-08-01 (Anthropic monthly cap; every run dies at `Claude Match+Research` with HTTP 400 "You have reached your specified API usage limits"). The failure landed AFTER paid Bright Data discovery but BEFORE `Append Processed Job`, so every discovery burned into the void (audit flag a5): 13 jobs on 07-11 + 4 on 07-12 on this engine alone, ledger frozen at 259 rows both days. Applied via the REST API, backup-first (`scripts/n8n-backups/9XuIEfxS71DEetVR-pre-P3-20260712-1810.json`), GET-verified, active flag preserved. 37 -> 41 nodes. Mirrored identically to #14.

**New Stage 2 flow:** `Dedup Against Log -> Format Sourced Row -> Anything To Bank? -> [true] Bank Sourced Jobs -> Rehydrate Batch -> Build Match Request` (the `[false]` branch = drain-only batch, skips banking straight to Rehydrate Batch; no junk rows).

- **Bank:** every NEW deduped job is appended to `processed_jobs` with `gate_status=sourced_unscored` plus a `payload_json` column (the full job object; column auto-created via autoMapInputData + `handlingExtraData=insertInNewColumn`) BEFORE any Claude call. The bank row doubles as mark-seen, so re-runs never re-source or re-pay.
- **Drain:** `Dedup Against Log` no longer treats `sourced_unscored` rows as done - their jobs (rebuilt from `payload_json`) rejoin every batch for Match until a completed row exists for that id. **Mechanism chosen: completed row APPENDED, bank row superseded** - append-only, because the whole engine has no update-row nodes anywhere and the sheet pattern is append-only; "done" = the id has any row with `gate_status != sourced_unscored`.
- **Edges (by design):** a bank row without payload_json is skipped by the drain (and would re-bank with payload if ever re-sourced); the internal `_banked` flag is stripped by Rehydrate Batch and never reaches the sheet or Claude; `Format Processed Row` needed no change (missing payload_json just leaves the cell empty).
- **Expected until 2026-08-01:** runs still die at Match on the cap, but AFTER banking - the ledger accumulates `sourced_unscored` rows daily and the whole backlog drains into Match on the first post-cap run. Live-fire proof = the next 07:00 run.
- **Companion change:** the Pipeline Error Alert (`QlGy1BFzdKF852uR`) now detects the cap signature and pushes a `quota/anthropic_api` red metric to alex_metrics (see docs/n8n/pipeline-error-alert/).
- **Untouched:** trigger, gates, sanitizer, voice block, Writer nodes - no other behavior changed.

## Stage 5 `cl_pdf` fix + cap lifted (2026-07-15)

The Anthropic cap that had both engines dying at `Claude Match+Research` (see P3 above) LIFTED ~07-13; #03's daily runs now complete both Claude calls and reach Stage 5. That exposed a separate blocker: **`Render Cover Letter PDF` was `disabled`**, so `cl_pdf` was never rendered and `Upload Cover Letter PDF` hard-failed *"no binary field 'cl_pdf'"*. Re-enabled via the REST API 2026-07-15 (backup `scripts/n8n-backups/9XuIEfxS71DEetVR-pre-cl-reenable-20260715-143512.json`, GET-verified, active preserved, `docs/n8n/03-application-engine/workflow.json` re-synced). This **SUPERSEDES the 07-14 "Rebind PDFs broken-pairing" diagnosis** in [[projects/error-log]] - that root cause was wrong (07-07 exec 474 proves `Rebind PDFs` carries both PDFs fine when the node is enabled) and its proposed Rebind rewrite would not have worked. **`Rebind PDFs` needs no change.** #14's render nodes were never disabled. Live-fire proof = next 07:00 cron reaching `Append Run Log`.

## Stage 5 network retry-on-fail hardening (2026-07-16)

After #14 died at `Upload CV PDF` on a transient `read ECONNRESET` (exec 1208, 07-16) with no retry anywhere on the Drive/Gotenberg leg, all 5 Stage-5 network nodes now carry `retryOnFail=true, maxTries=4, waitBetweenTries=5000`: `Render CV PDF`, `Render Cover Letter PDF` (Gotenberg HTTP), `Create Drive Folder`, `Upload CV PDF`, `Upload Cover Letter PDF` (Google Drive). Applied to BOTH engines (`9XuIEfxS71DEetVR` #03 + `9x9M3EnEEeX3O8dy` #14, kept identical) via the REST API, backup-first (`scripts/n8n-backups/{id}-pre-retry-20260716-132302.json`), GET read-back verified, active + `errorWorkflow` preserved. A transient TCP reset from Google/Gotenberg now auto-retries instead of burning a run that already spent Bright Data discovery + both Claude calls. Trade-off: an Upload retry after a server-side-success-then-reset can leave a duplicate draft PDF in the job's Drive folder (acceptable vs a lost paid run); the Render retries are fully idempotent. The public-API PUT dropped the un-preservable settings keys `binaryMode`/`timeSavedMode`/`callerPolicy`/`availableInMCP` (benign - binary storage is instance-level via `N8N_DEFAULT_BINARY_DATA_MODE`; the load-bearing `errorWorkflow`/`timezone`/`executionOrder` stayed). See [[projects/error-log]] 2026-07-16.

## Post-Run (first import session)
1. No people/companies generated at build time.
2. Update vault/projects/job-pipeline/status.md and vault/log.md.
3. Mark the sprint-board row Done only after validated end-to-end run.

## Trifecta
Gate: **draft-only**. Legs: private_data=true, untrusted_content=true, external_comm=true (agent-security Rule-of-Two, three-plan validation P3, 2026-07-17). All three legs true: private CV + untrusted job postings + outbound-destined drafts. Alex drafts + stages, Shaheen submits. Source of truth: the `trifecta` block in system/manifest.json + [[research/trifecta-map]]. Validator V12 fails the build if this gate stops matching the manifest.

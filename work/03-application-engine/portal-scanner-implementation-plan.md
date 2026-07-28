# Portal Scanner - Implementation Plan (post-review)

Status: **PLAN APPROVED FOR EXECUTION when Shaheen greenlights, still NOT BUILT.** This is the
build-ready companion to `portal-scanner-spec.md`. It supersedes the spec's build order where they
disagree (the spec's field list and its "one small edit" dedup framing were both corrected here).

Provenance: output of a three-specialist adversarial design review + master synthesis, 2026-07-26,
run via `/prompting` as a research-team commission. Every node-level claim was verified against the
live workflow JSON (`docs/n8n/03-application-engine/workflow.json`, `docs/n8n/14-ai-application-engine/workflow.json`),
not memory. No em-dashes or en-dashes anywhere, per the improvement brief's rule.

Design record + decisions + kill criteria: [[research/company-portal-scanning]]. Do NOT touch the live
crons (`9XuIEfxS71DEetVR` #03, `9x9M3EnEEeX3O8dy` #14) while building.

---

## 1. Executive verdict

The portal scanner is architecturally sound as a **new banker**: since the 2026-07-12 P3 write-first
reorder, everything downstream of `processed_jobs` is source-agnostic, so Match / Gate / Writer / QA /
Render need zero change. The thesis survives.

But "new banker, zero downstream change" is true for the FLOW and false for CORRECTNESS as the spec is
written. Three verified breaks are baked into the spec's own normalized shape, and the "one small edit"
cross-source dedup is actually the load-bearing edit to the live hot path. The lane is worth building
only as a **tightly-scoped v1** (Tier A ATSes, small Nordic/remote startups), in **cap-aware order**,
and the honest priority call from two independent specialists is that a **ghost-job / legitimacy gate is
higher ROI** for his actual market. Build the cheap go/no-go detector first; it decides whether the
portal lane is even viable.

**One-line recommendation:** run the Phase 0 detector and Phase 1 normalize test (both cheap, both feed
either build). If the detector shows a healthy scrapable-with-jobs count, build the ghost-job gate first,
then the portal lane as scoped below. If the count is low, build only the ghost-job gate and pause the
portal lane.

---

## 2. How this plan was produced (the debate trail, compact)

- **Agent 1 (senior n8n eng)** validated the thesis against the live node graph. Found: the drain
  rebuilds the job from `payload_json` inside `Dedup Against Log` (not `Rehydrate Batch`, which just
  re-emits); the spec emits `job_url` but the pipeline reads `url`; empty `work_conditions` silently
  disables the gate's work-condition check; the dedup is id-only and creates a re-drain loop; his real
  ATS mix is broader and messier than the doc admits (SuccessFactors, iCIMS, and a large agency slice
  with no scrapable portal).
- **Agent 2 (n8n eng, stress-test)** confirmed all three field findings on both engines, found the
  `autoMapInputData` ragged-column banking hazard, argued the earliness edge is marginal for a
  human-in-the-loop drafter and the ghost-job gate is the higher-ROI transplant, and flagged that
  spending a live Opus call on a duplicate during the capped month is unacceptable.
- **Master (Alex) between rounds** verified every load-bearing claim directly in the JSON, corrected the
  soft-key scope (drop location for the startup seed, add country only when scaling to enterprise),
  corrected the P8 attribution (the consultant-schema gap is on #14, not #03), and downgraded the
  "portal widens the P14 race" claim (the scanner injects no engine snapshots).
- **Agent 3 (senior n8n eng, 10y)** quality-checked the synthesis and wrote the phased plan. Found the
  direction-(i) staleness leak, the `source`-as-ragged-column hazard, the n8n Switch/Merge/HTTP plumbing
  gotchas, and the unbounded drain loop.
- **Master final pass** fixed Agent 3's dedup rule (cross-source, not portal-id-only, or the earliness
  case duplicates), dropped the leaky scanner-side cold-suppress from v1, and resequenced P2/P3 as
  measurement prerequisites. This document is the result.

---

## 3. Confirmed breaks (verified against live code)

| # | Break | Evidence | Fix lives in |
|---|---|---|---|
| B1 | Pipeline reads `job.url` / `j.url`, spec emits `job_url` -> silent blank `run_log.job_url` + `needs_review.url` for every portal job | `Parse Match` L326 `url: job.url`, `Compute Costs` L810 `job_url: j.url` | mapper (D2) |
| B2 | Empty `work_conditions` -> `allowed.length` 0 -> gate work-condition check SKIPPED -> on-site portal role passes a remote-only search | `Stage 3 Gate` L340 `if (allowed.length && wc && wc !== 'unclear' && !allowed.includes(wc))` | mapper (D2) |
| B3 | Dedup keys purely on exact `job_posting_id`; a `portal:{ats}:{id}` bank row whose LinkedIn twin completes under a different id never clears from `drainable` and re-scores every run at Opus $5/$25 | `Dedup Against Log` L254 `done`/`drainable`/`inRun` all id-keyed; `for (const id of done) drainable.delete(id)` clears by id only | live Dedup edit (D1, Phase 4) |
| B4 | Banking uses `autoMapInputData` + `insertInNewColumn`; any 7th key on a portal row silently creates a ragged column (P13 hazard). `source` must NOT be a top-level column | `Format Sourced Row` L907 emits exactly 6 keys; `Bank Sourced Jobs` L965 autoMap | mapper (D2, G4) |
| B5 | One company can list 200 roles; at Opus 4.8 that is ~$6-8/run/company before a draft, no natural per-company cap | portal boards return whole list in one GET; no `limit_per_input` equivalent | prefilter + `max_roles` cap (D3) |
| B6 | Real ATS mix skews Teamtailor (Nordic, needs Bright Data) + Workday + SuccessFactors + iCIMS (not in the enum) + a large staffing-agency slice with ZERO scrapable portal | vault acks: Bjak/BLP (Ashby), Appfire (Greenhouse), Dexter Health (join), Recrescere/Spidersilk/VFX (Teamtailor), Mondelez (Workday), BRF (SuccessFactors), Danone (iCIMS), Robert Half/Morson/Lawrence Harvey/SoTalent/Templeton (agencies) | scope v1 (D5) + ghost-job gate (D10) |

Ground-truth field shape (from `Parse Jobs` L210, the authority): the mapper must match field-for-field:
`job_posting_id, job_title, company_name, job_location, seniority, employment_type, description, url,
job_posted_date, work_conditions, origin_location, origin_country`. The spec's list is wrong on `job_url`
(is `url`) and `posted_date` (is `job_posted_date`, and nothing reads it).

---

## 4. Resolved design rulings (the contract the plan implements)

- **D1 - Cross-source dedup, scoped by seed and by source.**
  - The load-bearing guard is in the **live `Dedup Against Log`**, not the scanner. The scanner-side
    cold-suppress is DROPPED from v1: it is leaky (the daily 06:30 scan cannot see a twin that completes
    at Tue 15:00) and, once the live Dedup does cross-source suppression, it saves only a cheap Sheets
    append. Revisit only if sheet bloat becomes real.
  - **Suppression is CROSS-SOURCE, keyed off the id prefix.** Suppress an incoming or draining job
    against a completed row ONLY when the completed row's source differs from the job's source
    (`portal:` prefix vs LinkedIn-numeric). This suppresses the LinkedIn twin of a completed portal job
    (the earliness case) AND the portal twin of a completed LinkedIn job, but NEVER soft-suppresses a
    LinkedIn job against another completed LinkedIn row (no hot-path regression). This corrects Agent 3's
    "portal-id-only" rule, which would have let the earliness-case duplicate through.
  - **Soft key by seed.** v1 seed = small Nordic/remote startups on Ashby/Greenhouse/Lever. For that
    seed, soft key = `normalize(company) | normalize(title)`, computable from the existing
    `processed_jobs` columns (`company_name`, `job_title`) with NO schema change and NO backfill. Multi-city
    title collapse is an enterprise pattern, negligible for startups. When the seed later expands to
    enterprise/multi-city (Tier B/C, deferred), add a forward-only `soft_key` column
    (`= normalize(company)|normalize(title)|country`) to `Format Processed Row` + `Format Sourced Row`.
  - `normalize()` MUST be tested against the real `job_title` corpus BEFORE the design is locked
    (Phase 1). Untested normalize = the loop stays open.
- **D2 - Mapper contract.** Emit `url` (not `job_url`); emit NON-EMPTY `work_conditions` (from the seed
  company's geography/track, so the gate has an allow-list); omit `seniority`/`employment_type`/`job_posted_date`
  (nothing downstream reads them); put `source` and every field Match/Gate/Writer reads INSIDE
  `payload_json` (that blob IS the job after drain); the bank row is EXACTLY the 6-key shape.
- **D3 - Cost guards.** Per-company `max_roles` cap (new `company_portals` column, default 15), applied
  by the prefilter, ordered deterministically (posted-date desc, else first-N). Prefilter runs BEFORE
  banking. Title filter stricter than the `search_config` substring.
- **D4 - Track.** Default single-track per company, chosen at seed time. `both` opt-in only (it doubles
  the Opus match cost per job).
- **D5 - v1 scope.** Tier A = Ashby + Greenhouse + Lever ONLY. Seed = small Nordic/remote startups on
  those three (where "only on their board" exclusivity is real), NOT enterprises, NOT agencies.
- **D6 - Detector measures scrapable-WITH-JOBS**, not merely detectable ATS. Go/no-go metric = seed
  companies returning >= 1 prefilter-passing role.
- **D7 - P8 is #14-only.** #03 already wires `powerbi|consultant` end to end. Portal-to-BI ships first;
  portal-to-AI waits for P8 landing on #14.
- **D8 - Prerequisite ordering.** P14 (wave race) is engine-internal; the scanner injects no snapshots
  so it creates no new waves, but it fattens the drainable set an existing race would double-process, so
  fix P14 before SCALING the bank. P1 (poll-timeout swallow) blocks only the Tier C Bright Data path;
  v1 is Tier A, so P1 is NOT a v1 blocker. Brief P2 (caching) + P3 (cost-ledger truth) gate the cost
  KILL-CRITERIA, so they land before the measurement window, not before the first drain.
- **D9 - Cap timing.** Build everything now (`active:false`, no live Opus). Do NOT run the first live
  drain until the Anthropic monthly cap resets 2026-08-01. The bank-only scanner runs FREE for Tier A
  during July and accumulates a backlog safely; guard the first post-cap run (two backlogs, LinkedIn +
  portal, drain into one run) with a tight `max_roles` and a first-run drain cap.
- **D10 - Honest priority.** Recommend the ghost-job / legitimacy gate as the higher-ROI sibling, built
  first or in parallel. It hits existing LinkedIn volume, needs no ATS integration, and attacks the
  agency/repost problem the portal lane structurally cannot reach. See section 7.

---

## 5. The phased implementation plan

Build discipline for every live-node touch: `GET /workflows/{id}` -> save to
`scripts/n8n-backups/{id}-pre-{change}-{ts}.json` -> mutate -> `PUT` -> `GET` again and diff the mutated
fields (Verify-after-write, a standing order). Base URL `https://n8n.shaheenkiarash.com/api/v1`, header
`X-N8N-API-KEY` from `work/03-application-engine/config/n8n-api-key.txt`. Consult `n8n-workflow-patterns`
before any workflow JSON, `n8n-node-configuration` per node, `n8n-code-javascript` for every Code node,
`n8n-validation-expert` on any validation error. Preserve `active`, `errorWorkflow`, `timezone`,
`executionOrder` on every PUT (the public-API PUT can drop the active flag, hard-verify it).

### PHASE 0 - ATS detector (offline, no n8n) - the honest go/no-go
- **0.1** Build `scripts/portal-detector.js` (offline Node, zero n8n, zero Claude). Input: a hand-curated
  seed of small Nordic/remote startups hiring Power BI / AI / data roles. For each: fetch `careers_url`,
  follow redirects, sniff HTML / iframe-src / redirect chain for Tier A signatures only
  (`boards.greenhouse.io`, `greenhouse.io`, `jobs.lever.co`, `api.lever.co`, `ashbyhq.com`). Write
  `ats_type` + `ats_slug`. Unknown -> skip (custom/Teamtailor are out of v1). Output a candidate TSV in
  the `company_portals` column order (section 5, Phase 2.1).
- **0.2** For each DETECTED company, actually hit its Tier A JSON endpoint and count jobs AFTER a
  first-pass title prefilter (reuse the BI `search_config` keyword lists). Endpoints:
  - Greenhouse `GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true`
  - Lever `GET https://api.lever.co/v0/postings/{slug}?mode=json`
  - Ashby `GET https://api.ashbyhq.com/posting-api/job-board/{slug}`
- **GO/NO-GO:** count of seed companies returning >= 1 prefilter-passing role. GO if ~8-10+ clear it.
  NO-GO (pause the portal lane, pivot to the ghost-job gate) if fewer than ~5 clear it. Record the count
  + per-company breakdown in [[research/company-portal-scanning]].
- **STOP.** No n8n until the go decision is recorded.

### PHASE 1 - Lock normalize() against the live title corpus (offline)
- **1.1** Pull the current `processed_jobs` tab, extract every distinct `job_title` + `company_name`.
  Candidate normalizer:
  ```js
  const normalize = (s) => String(s || '').toLowerCase()
    .replace(/\((remote|hybrid|on-?site)\)/g, '')
    .replace(/\b(senior|junior|lead|principal|sr|jr)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  ```
- **1.2** Run it over the real corpus. Verify twins collapse to the same key AND two genuinely different
  roles at one company do NOT collapse. Tune the strip-list against what LinkedIn actually appends.
- **GATE:** normalize() is LOCKED only when twins-match AND distinct-roles-differ on the real corpus. If
  distinct roles collide, add `origin_country` to the key now (forward-only) rather than ship a lossy key.

### PHASE 2 - `company_portals` sheet + Tier A scanner (bank-only, active:false, BI engine only)
- **2.1** Create the `company_portals` tab on the BI sheet
  `19puwN6wxFHI7iICrdafiFn1Diqq7qJTe5-5r0Y2XQFY` (single shared tab, single scanner). Headers row 1:
  `company | ats_type | ats_slug | careers_url | track | max_roles | active | last_scanned | last_status | notes`
  - `ats_type` in {greenhouse, lever, ashby} (v1); `track` in {bi, ai, both} default single (D4);
    `max_roles` default 15 (D3); `last_status` = ok / http_4xx / empty / error.
  - Seed from the Phase 0 output (only companies that cleared the go metric). Verify: read the tab back.
- **2.2** Build the "Portal Scanner" workflow via `POST /workflows`, `active:false`, timezone
  Europe/Stockholm, same `errorWorkflow` as the engines. Graph:
  ```
  Schedule Trigger (daily 06:30 Europe/Stockholm)
    -> Read company_portals (Sheets read; cred Google Sheets account)
    -> Filter Active Rows (active === true)
    -> Switch on ats_type (n8n-nodes-base.switch)
         greenhouse -> HTTP GET boards-api.greenhouse.io/v1/boards/{{slug}}/jobs?content=true
         lever      -> HTTP GET api.lever.co/v0/postings/{{slug}}?mode=json
         ashby      -> HTTP GET api.ashbyhq.com/posting-api/job-board/{{slug}}
         (each HTTP node: neverError + alwaysOutputData; retryOnFail 4x/5s, so one dead slug
          does not abort the whole scan)
    -> per-branch Map to normalized shape (3 Code nodes, runOnceForAllItems; each ATS has a
       DIFFERENT response shape, so one mapper per branch)
    -> Merge (mode: append, all 3 branches)
    -> Prefilter + Cap (Code, runOnceForAllItems): stricter-than-substring title/location match on
       search_config keywords, then per-company max_roles cap ordered by posted-date desc
    -> Stamp Liveness (Sheets update last_scanned/last_status on company_portals; batch, one range
       update, Verify-after-write)
    -> Format Bank Rows (Code): the EXACT 6-key shape
    -> Bank To processed_jobs (Sheets append; ONE append call with the row array, BI sheet only)
  ```
- **2.3** Per-ATS mapper output (matches `Parse Jobs` field-for-field, with D2 fixes):
  ```js
  {
    job_posting_id: `portal:${ats}:${atsJobId}`,   // never collides with LinkedIn ids
    job_title, company_name, job_location,
    description,                                    // full ATS description text
    url,                                            // NOT job_url (B1)
    work_conditions,                                // NON-EMPTY, from the seed company's geography (B2)
    origin_location, origin_country,
    source: `portal:${ats}`                         // stays INSIDE payload_json only (B4/G4)
    // seniority, employment_type, job_posted_date: OMITTED (nothing reads them)
  }
  ```
- **2.4** Format Bank Rows emits ONLY:
  ```js
  { job_posting_id, date: <today>, company_name, job_title,
    gate_status: 'sourced_unscored',
    payload_json: JSON.stringify(fullNormalizedJob) }   // no 7th key
  ```
- **2.5** Bank To processed_jobs = Sheets append, autoMap + insertInNewColumn (same as live
  `Bank Sourced Jobs`), one append call per run, BI sheet only.
- **2.6** Run `n8n-validation-expert` on the JSON. GET the created workflow back, confirm node count +
  connections + `active:false`. Hand-execute once (Manual Trigger) against the seed.
- **GATE:** prove ONE real portal job banks a correctly-shaped `sourced_unscored` row: 6 columns,
  `payload_json` parses, contains `url` + non-empty `work_conditions`. Do NOT let it drain to Claude
  yet (cap-gated to 2026-08-01). This whole phase is bank-only, ~$0 for Tier A, so it can RUN in July.

### PHASE 3 - Prerequisites on the live engines
- **3.1 (brief P2 + P3)** Land prompt caching + cost-ledger truth on both engines. Gates the cost
  kill-criteria (gate-failed/QA-failed portal tokens must be logged before "did the lane inflate spend"
  is answerable). Backup-first, GET-verified, both engines. Must land before the Phase 5 measurement
  window, not before the first drain.
- **3.2 (P14)** Run the wave-race test (two active search rows, one snapshot delayed past a poll cycle).
  If confirmed, apply the hold-all aggregate-before-IF fix. Prerequisite for cron activation / scaling,
  not for the Phase 2 bank-only build. Backup-first, both engines.
- **3.3 (P8, #14 only)** Add `consultant` to the #14 match output schema. Until it lands, the portal
  lane feeds the BI engine ONLY. Backup-first on `9x9M3EnEEeX3O8dy`, GET-verified.
- **3.4 (P1)** Deferred. Only blocks the Tier C Bright Data path, which v1 does not include.

### PHASE 4 - Cross-source dedup on the live engines (the cron-activation blocker)
The one edit to the live hot path. Backup-first, GET-verified, BOTH engines in lockstep.
- **4.1** Edit `Dedup Against Log` (L254):
  - Build `doneSoftKeysBySource`: for every COMPLETED row (`gate_status != 'sourced_unscored'`), record
    `normalize(company_name)|normalize(job_title)` -> the row's source (derive source from the
    `job_posting_id` prefix: `portal:` vs LinkedIn-numeric).
  - When admitting an incoming NEW job or draining a banked job, compute its soft key and source. Suppress
    it ONLY if `doneSoftKeysBySource` has that soft key under a DIFFERENT source. This suppresses the
    LinkedIn twin of a completed portal job (earliness case) and the portal twin of a completed LinkedIn
    job, but never soft-suppresses LinkedIn-vs-LinkedIn (hot-path behavior unchanged).
  - For a suppressed banked portal orphan, also skip re-draining it (it stays as harmless
    `sourced_unscored` clutter; no tombstone write needed).
  - Paste the LOCKED `normalize()` from Phase 1 verbatim.
- **4.2** Add a first-run drain cap: bound the number of drained items per run (config const at the top
  of the node), so the two July backlogs do not drain into one giant Opus run on 2026-08-01. The current
  drain loop is unbounded (verified L254).
- **4.3** Backup both engines (`{id}-pre-softkey-dedup-{ts}.json`), PUT, GET-diff the `Dedup Against Log`
  jsCode, confirm node count unchanged (edit-in-place), active/errorWorkflow/timezone/executionOrder
  preserved.
- **Rollback:** PUT the backup JSON back, GET-verify the jsCode reverts. One command per engine.
- **GATE:** a simulated portal orphan whose cross-source soft-key twin is completed stops re-draining
  (no repeated Opus call), AND a LinkedIn twin of a completed portal job is suppressed, AND two distinct
  LinkedIn jobs are unaffected.

### PHASE 5 - Cron activation + measurement (only after 2026-08-01)
- **5.1** Only after Phase 2 proven + 3.1/3.2 landed + Phase 4 landed + cap reset. Guard the first
  post-cap run (tight `max_roles`, Phase 4.2 drain cap on). Flip the scanner `active:true` (PUT,
  GET-verify the flag).
- **5.2 Deferred widen (NOT v1):** both engines (after P8), then Tier B (Workday/Workable/join), then
  Tier C (Bright Data + P1). Each behind its own go/no-go. Phase 2 auto-grow (LinkedIn >= 4.0 ->
  auto-add to `company_portals`) is LAST, only after earliness is proven.
- **5.3 Measurement window + kill criteria** (30-60 days, from the concept brief):
  - (a) **Earliness:** count portal jobs that completed BEFORE their LinkedIn twin appeared (via the
    cross-source soft key). Near zero -> no edge.
  - (b) **Upkeep:** ATS-slug churn causing repeated `http_4xx`/`empty` liveness flags exceeding the time
    saved.
  - (c) **Spend:** did portal jobs lift the >= 4.0 draft count WITHOUT inflating Opus spend (measurable
    only because P3 landed in 3.1)?
  - Any of (a)/(b)/(c) fails -> pause with one `active=false` on the scanner (cron-isolated). Record in
    [[research/company-portal-scanning]].

---

## 6. n8n plumbing gotchas (call-outs the builder will hit)

- **Code node modes:** the Prefilter+Cap and mapper nodes need `runOnceForAllItems` (default) to see the
  whole batch for the per-company cap and cross-item logic. `runOnceForEachItem` breaks it.
- **Switch + Merge:** each `ats_type` branch has a different response shape (Greenhouse `.jobs[]`, Lever
  bare array, Ashby `.jobs[]`), so one mapper per branch, then `Merge` in **mode `append`** (not
  `combine`) or the batch loses items.
- **HTTP hardening:** `neverError` + `alwaysOutputData` + `retryOnFail` (4x/5s) on each HTTP node so a
  404 on one dead slug does not abort the whole scan (mirrors the live `Poll Fetch`).
- **Sheets quota:** batch the liveness stamp (one range update) and bank in one append call per run; the
  default write quota is 60/min/user.
- **Credential reuse:** pin `Google Sheets account`; Tier A needs no auth header (public GETs), so no new
  credential.
- **Read Processed Log** already pulls the whole growing tab every run (P13.2). A daily portal backlog
  makes P13.2's compact seen_ids view more urgent once the bank scales; not a v1 blocker for a small seed.

---

## 7. The higher-ROI sibling: ghost-job / legitimacy gate

Two independent specialists landed here, so it is in the plan as an explicit decision, not a footnote.

- **Why higher ROI:** it hits the EXISTING LinkedIn volume immediately (no ATS integration, no seed
  curation, no earliness assumption to prove), and it attacks the agency/repost problem the portal lane
  structurally cannot reach (staffing agencies have no scrapable portal).
- **Where it slots:** a deterministic Stage-1.5 Code node between `Dedup Against Log` and
  `Build Match Request` on the hot path of both engines. Checks: repost-age heuristic, agency-domain
  flag, cross-source duplicate count (REUSES the Phase 1 `normalize()` and the Phase 4 soft-key
  structure). A flagged posting routes to `needs_review` with reason `likely_ghost` BEFORE any Opus
  spend, so it also cuts cost on junk.
- **Recommended ordering:** Phase 0 detector -> Phase 1 normalize (both feed either build) ->
  **ghost-job gate** -> Phase 2 portal bank-only (free in July) -> Phase 3/4 prerequisites -> Phase 5
  portal cron after 2026-08-01. If Phase 0 returns a low count, drop the portal lane and keep only the
  ghost-job gate. The portal lane is a bet on earliness; the ghost-job gate is a certainty on existing
  volume. Sequence the certainty first.

---

## 8. Open decisions for Shaheen

1. **Ghost-job gate first, portal lane first, or both in the recommended order?** (Recommendation: both,
   ghost-job first, gated on the Phase 0 count.)
2. **Curate the Phase 0 seed now?** The whole plan is downstream of a real seed of small Nordic/remote
   startups. Naming ~15-20 target companies is the first concrete step and it is Shaheen-side.
3. **Accept the v1 soft-key false-positive** (same-title-different-team at one company collapses), knowing
   it is bounded for a startup seed and that country is added to the key only when scaling to enterprise?
4. **Confirm the cap-timing:** build in July (bank-only, free), first live drain after 2026-08-01. No
   live Opus call spent on a duplicate to "prove the flow" while capped (prove on Sonnet or by re-draining
   an already-scored job).

---

## 9. Close-Out / propagation to do WHEN BUILT (not now)
Trigger the session the lane goes live: `system/manifest.json` + `node scripts/generate-alex.js` (take
the write-lock); routing table (root CLAUDE.md); `docs/n8n/portal-scanner/` export + README;
`docs/projects/`; the plain-English guide (13.7 running-changes + the T07 catalog table, T03 redraw only
if a whole layer moves, which it does not); `ALEX-OS-master.md` (§2 + §3 + §11);
`vault/projects/job-pipeline/status.md` + `infrastructure.md`; flip `portal-scanner-spec.md` from
NOT-YET-BUILT to a runbook; `vault/index.md` + `vault/log.md`. Trifecta unchanged (draft-only; a new
untrusted-content source, still no auto-submit; the `trifecta` block in `system/manifest.json` already
carries `untrusted_content=true`).

# Portal Scanner - Build Spec (SUPERSEDED 2026-07-27, BUILT AS A STANDALONE LANE)

> **SUPERSEDED.** This spec describes the ADDITIVE variant that would have fed #03 + #14 directly.
> Shaheen chose the standalone full-clone instead (2026-07-26), and it was built and gate-proven on
> 2026-07-27: n8n `5tPXbhdpp6PfF56V` (Portal Scanner) + `sxEYRyeHH7i1mHzb` (Portal Application Engine),
> both INACTIVE, on their own sheet and Drive folder. The live engines were never edited.
> **Current runbook + the 1.5% pass-rate finding: `vault/projects/portal-scanner/status.md`.**
> Kept for the field-shape and endpoint reference only; its "one small edit to #03" framing does NOT
> describe what was built.

Status: **SPEC APPROVED 2026-07-26, build pending Shaheen's go.** Additive sourcing lane for #03 + #14.
Design record + rationale + career-ops comparison: [[research/company-portal-scanning]]
(`vault/research/company-portal-scanning.md`). Do not touch the live crons (`9XuIEfxS71DEetVR` #03,
`9x9M3EnEEeX3O8dy` #14) while building this.

## What it is
A new, independent n8n workflow ("Portal Scanner") that discovers jobs directly from company career
pages via their ATS's public JSON API (Bright Data fallback for bespoke/Teamtailor portals),
prefilters by title/location, and banks matches into the EXISTING `processed_jobs` tabs of both
engine sheets as `gate_status=sourced_unscored` + `payload_json`. The existing Tue/Thu engines then
drain and score them via the P3 `Rehydrate Batch` path. **No changes to Match/Gate/Writer/Render.**

## Why this shape (the P3 gift)
Everything downstream of `processed_jobs` is source-agnostic since the 2026-07-12 P3 write-first
reorder (see this folder's CLAUDE.md, "P3 write-first reorder"). The scanner only has to produce the
normalized job object and append it to the bank. It is a new *banker*, not a new pipeline.

## Skills (MANDATORY at build time)
- `n8n-workflow-patterns` FIRST (Switch fan-out + Merge + HTTP + scheduled-task patterns), then
  `n8n-node-configuration` for per-node params, `n8n-code-javascript` for the mapper/prefilter Code
  nodes, `n8n-validation-expert` if validation errors appear. Per root CLAUDE.md Skill Bindings.
- Build via the n8n REST API, backup-first, GET read-back verified (the house pattern; see
  `config/*.js` and the P3/retry precedents). Verify-after-write is a standing order.

## New surfaces
1. **New Sheet tab `company_portals`** (add to BOTH engine sheets, or one shared tab read by the
   scanner - decide at build; simplest is one tab on the BI sheet `19puwN6wxFHI7iICrdafiFn1Diqq7qJTe5-5r0Y2XQFY`
   read by the single scanner). Headers, row 1:
   `company | ats_type | ats_slug | careers_url | track | active | last_scanned | last_status | notes`
   - `ats_type` in {greenhouse, lever, ashby, recruitee, smartrecruiters, personio, workday, workable, join, teamtailor, custom}
   - `ats_slug` = the company's identifier on that ATS (or tenant/site for Workday)
   - `track` in {bi, ai, both} - which engine bank(s) to feed
   - `last_status` = ok / http_4xx / empty / error (liveness, written each scan)
2. **New workflow "Portal Scanner"** (separate, additive, `active:false` until proven).
3. Nothing else new. Reuses `Bright Data Header Auth`, `Google Sheets account` creds.

## Workflow shape
```
Schedule Trigger (daily 06:30 Europe/Stockholm)   # cheap HTTP; runs daily, Tue/Thu engines drain it
  -> Read company_portals (Google Sheets)
  -> Filter Active Rows (active == true)
  -> Switch on ats_type
       greenhouse  -> HTTP GET boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true
       lever       -> HTTP GET api.lever.co/v0/postings/{slug}?mode=json
       ashby       -> HTTP GET api.ashbyhq.com/posting-api/job-board/{slug}
       recruitee   -> HTTP GET {slug}.recruitee.com/api/offers/
       smartrec    -> HTTP GET api.smartrecruiters.com/v1/companies/{slug}/postings
       personio    -> HTTP GET {slug}.jobs.personio.de/xml           (XML -> JSON)
       workday     -> HTTP POST {tenant}.wdN.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs  (JSON body)
       workable    -> HTTP GET public widget endpoint
       join        -> HTTP GET join.com public postings
       teamtailor  -> Bright Data fallback (scrape careers_url, parse JSON-LD)  [Tier C]
       custom      -> Bright Data fallback (scrape careers_url)                 [Tier C]
  -> per-branch Map to normalized shape (Code node)
  -> Merge (all branches)
  -> Prefilter (Code node): keep only rows whose title/location match the track keyword lists
  -> Stamp last_scanned/last_status back to company_portals (liveness, Verify-after-write)
  -> Append to processed_jobs (BI and/or AI sheet per row.track) as
       gate_status=sourced_unscored, payload_json={full normalized job}, source="portal:{ats_type}"
```

## Normalized job shape (must match what Parse Jobs emits)
Read `Parse Jobs` (stage1) + `Bank Sourced Jobs` (P3) on the live workflow before building, and emit
the SAME fields the drain rehydrates: `job_posting_id` (use `portal:{ats}:{ats_job_id}` to avoid
colliding with LinkedIn ids), `company_name`, `job_title`, `description`, `job_url`, `job_location`,
`origin_location`, `origin_country`, `work_conditions`, `posted_date`. Anything the Match/Gate reads
must be present or safely defaulted.

## The three hard parts (address at build)
1. **ATS detection / seeding.** Build a small assisted detector: fetch each `careers_url`, sniff for
   ATS signatures (`greenhouse.io`, `boards.greenhouse.io`, `jobs.lever.co`, `ashbyhq.com`,
   `myworkdayjobs.com`, `teamtailor.com`, `recruitee.com`, `smartrecruiters.com`, `personio`,
   `workable.com`, `join.com`) in HTML / redirects / embedded iframe src, write `ats_type` + `ats_slug`.
   Unknown -> `custom` (Bright Data fallback) and a `notes` flag. This detector is the FIRST buildable
   piece and the honest gate on the whole lane (see "Suggested build order").
2. **Cross-source dedup.** Add a soft dedup key `company + normalize(title) + location` to the engines'
   `Dedup Against Log` so a portal job and its later LinkedIn twin aren't both scored. Portal usually
   wins the race, so the LinkedIn copy is the one suppressed. (This is the one small edit to the live
   engines; do it backup-first, GET-verified, both engines in lockstep, per the retry/P3 precedent.)
3. **Cost control.** The Prefilter Code node is load-bearing: a single company can list 200 roles.
   Reuse the `search_config` keyword + location lists so only plausible roles bank. Without it, Claude
   (Opus 4.8, $5/$25) spend balloons on junk.

## Company seed (manual, then auto-grow)
- **Phase 1 (manual):** curate a Nordic/remote seed with Shaheen (target firms hiring Power BI / AI).
  Detect each one's ATS, fill `company_portals`.
- **Phase 2 (auto-grow):** a deterministic step (nightly, zero-token, mine `run_log`) auto-adds any
  company whose LinkedIn jobs scored >=4.0 to `company_portals` (detect ATS, `active=true`). The
  scoring history builds the watch list. Wire only after Phase 1 proves the lane.

## Bright Data fallback (Tier C)
Teamtailor + `custom`. Reuse `Bright Data Header Auth`. Scrape `careers_url`, parse the job list
(Teamtailor pages carry JSON-LD `JobPosting` blocks). This costs per record (unlike Tier A/B), so keep
Tier C rows few and high-value. Same 400/empty-array handling discipline as the live BD trigger (see
CLAUDE.md gotchas: a 200 + empty array is a legitimate zero-job scan, not a failure).

## Verify-after-write / liveness
Every scan stamps `last_scanned` + `last_status` on the `company_portals` row (Verify-after-write
standing order). A non-200 or empty JSON = flag the row (`http_4xx` / `empty`), don't silently drop.
Repeated failures -> a `human-actions` row (the ATS slug probably changed).

## Suggested build order (each a stopping point)
1. **ATS detector only** (offline script or tiny workflow) run over the manual seed. See how many
   target companies are actually API-scrapable BEFORE committing. This is the honest go/no-go.
2. **Scanner over Tier A only** (Greenhouse/Lever/Ashby/Recruitee/SmartRecruiters/Personio), banking
   to ONE engine, `active:false`, hand-executed. Prove one real portal job flows through to a draft.
3. Add the soft cross-source dedup to both live engines (backup-first).
4. Widen to both engines + Tier B (Workday/Workable/join) + Tier C (Bright Data fallback).
5. Activate the daily cron. Then Phase 2 auto-grow.

## Close-Out / propagation to do WHEN BUILT (not now)
On real build: new project/lane -> update `system/manifest.json` (+ `node scripts/generate-alex.js`),
the routing table (#03/#14 rows or a new lane note), docs/n8n export for the new workflow,
docs/projects, the plain-English guide (13.7 + the relevant table) and the ALEX-OS-master.md
(§2 generated-surface / §3 catalog), vault/projects/job-pipeline/status.md + infrastructure.md, and
this spec flips from "NOT YET BUILT" to a runbook. Trifecta stays draft-only (unchanged; a new source
of untrusted content, still no auto-submit).

# Portal Scanner (standalone company-portal job lane)

> **[2026-07-27] MODEL: Portal Application Engine (`sxEYRyeHH7i1mHzb`) now runs Moonshot `kimi-k3` at `reasoning_effort:'high'`** (moved off claude-opus-4-8 with the other 3 job lanes, Shaheen's call; rolled out at `'max'`, flipped to `'high'` the same day after a measured comparison, ~79s vs ~231s/call at near-identical draft quality). Model nodes call `api.moonshot.ai/v1/chat/completions` via the `Kimi K3 (Moonshot header)` cred (`OffvMkWR01zcpqxo`); `max_tokens` 16384; 10-min HTTP timeout; repriced $3/$0.30/$15. The Scanner `5tPXbhdpp6PfF56V` makes no model call and is untouched. This makes the "~2x Opus cost" framing below stale, kimi-k3 is ~Sonnet-priced. Contract: manifest `meta.model_routing` + validate-alex V6. Detail: [[job-pipeline/status]].

## Type
New STANDALONE automation (its own n8n workflow(s) on the Hetzner box, its own Google Sheet + Drive
folder, its own cloned pipeline). Shaheen's decision 2026-07-26: build the portal-scanning capability as
a completely self-contained project that produces end-to-end drafts WITHOUT touching the live #03 / #14
engines. This is the "Option B / full clone" variant from the design review (the heavier of the three, ~2x
Opus cost + maintenance vs the new-banker integration, chosen so the live job engines are never edited).

**HARD BOUNDARY (never violate):** this project does NOT edit, feed, or read-mutate `9XuIEfxS71DEetVR`
(#03), `9x9M3EnEEeX3O8dy` (#14), their Google Sheets, their Drive folders, or their crons. It reuses only
shared CREDENTIALS (Anthropic, Bright Data, Google Sheets/Drive OAuth) and shared infra (Gotenberg), which
is not "touching" those projects. Everything else is its own.

## Source of the design
- The approved implementation plan: `work/03-application-engine/portal-scanner-implementation-plan.md`
  (the 3-agent adversarial review + master synthesis, 2026-07-26). Read it before building any phase.
- Design record + decisions + kill criteria: [[research/company-portal-scanning]].
- The build spec it extends: `work/03-application-engine/portal-scanner-spec.md`.
- Note: the plan's Phases 3-4 (edits to the live engines) DO NOT APPLY here by construction. The
  cross-source-dedup and P8/P14 prerequisites in that plan were about integrating with #03/#14; this
  standalone clone owns its own dedup and its own gate schema, so those become internal design choices,
  not edits to existing projects.

## Purpose
Discover jobs directly from company career pages via their ATS public JSON API (Tier A: Greenhouse, Lever,
Ashby for v1), prefilter by title/location, and run them through THIS project's own cloned
Match -> Gate -> Writer -> QA -> Render -> Drive pipeline to produce review-ready CV + cover-letter drafts.
No auto-submit (draft-only, the Trifecta gate is inherited from the clone source). Seed = small Nordic /
remote startups on those ATSes, where "only on their own board" exclusivity is real.

## BUILD STATE 2026-07-28: LIVE. Both workflows ACTIVE and both fired for real on 2026-07-28.
> **Supersedes the 2026-07-27 "both workflows exist and are INACTIVE" line below.** API-verified
> 2026-07-28: Scanner `5tPXbhdpp6PfF56V` active:true, cron `13 15 * * 2,4`, first execution
> 2026-07-28T13:13:00Z `success`; Portal Application Engine `sxEYRyeHH7i1mHzb` active:true, cron
> `43 15 * * 2,4`, first execution 13:43:00Z `success`. Phase 4 activation therefore HAS happened.
> **The engine now has its own registry row, #32** (`work/32-portal-application-engine/CLAUDE.md`),
> split out 2026-07-28 by command-layer review F-9 so both workflows carry their own `n8n` id + cron
> and come under validator V6 leg (c) and the daily active-flag watcher. This project is now STAGE 1
> of 2: detect, prefilter, BANK. Draining and drafting belong to #32.

| Thing | Id |
|---|---|
| Sheet "Portal Job Pipeline" | `1hmLHyW0Yu6ZV8MpiKrECo2OACk4eC3Eb5xWR73HIeiU` |
| Drive folder | `1FUjKlw-sGvXrApvZ6hSu190m72x1YKDr` |
| n8n "Portal Scanner" (12 nodes) | `5tPXbhdpp6PfF56V` |
| n8n "Portal Application Engine" (34 nodes) | `sxEYRyeHH7i1mHzb` |

Proven: 67 jobs banked free from 9 companies, all 67 drained, 1 draft rendered end to end to Drive
(Xebia CEE, fit=74, $0.0595 on sonnet). **Pass rate 1.5% vs #03's ~11%** - see the status page, this is the
number that decides whether the lane is worth activating. Phase 4 activation is NOT done, by design.
Full detail + the recommended prefilter/dedup fixes: vault/projects/portal-scanner/status.md.

## Phased build (each phase a hard stopping point; mirrors the plan, retargeted to standalone)
- **Phase 0 - ATS detector (offline, IN PROGRESS 2026-07-26).** `portal-detector.js` over a Shaheen-approved
  seed. Measures scrapable-WITH-JOBS (hit the endpoint, count jobs after a title prefilter), not merely
  "detectable". GO/NO-GO on the count before any n8n/Sheets/Drive infra is created. Seed candidates:
  `seed-candidates.md` (awaiting Shaheen's approval).
- **Phase 1 - normalize() test (offline).** Prove the title normalizer against a real title corpus before
  the internal dedup design is locked. Since this clone has its OWN ledger, the corpus is bootstrapped
  (seed from #03's public title patterns as reference only, never reading #03's live data).
- **Phase 2 - scanner workflow + own sheet (n8n, active:false, bank-only).** New "Portal Scanner" workflow
  + new Google Sheet `Portal Job Pipeline` with its own `company_portals` + `processed_jobs` +
  `run_log` + `needs_review` tabs. Banks `sourced_unscored` + `payload_json` into ITS OWN sheet.
- **Phase 3 - cloned pipeline (n8n, active:false).** Clone Match / Gate / Writer / QA / Render / Drive /
  log from #03 into a NEW workflow pointed at THIS project's sheet + a NEW Drive parent folder. Its own
  cross-source dedup (soft key, cross-source aware) lives inside its own Dedup node. Prove one portal job
  flows to a rendered draft cheaply (on claude-sonnet-4-6 or a re-drain, not a full-price Opus test run).
- **Phase 4 - activation + measurement.** Activate the daily scanner cron + the pipeline whenever Shaheen
  chooses (no date gate, see the Cost note). 30-60 day measurement window against the kill criteria
  (earliness, upkeep, spend).

## Cost note (NOT a cap gate - corrected 2026-07-26)
There is NO active Anthropic cap. `system/quota-state.json` shows `anthropic_api.state = "ok"` since
2026-07-15 (the monthly cap lifted early ~2026-07-13; the "capped until 2026-08-01" line in the stale
#03/#14 docs was cleared in the 2026-07-15 deep-audit). The first draft of this file wrongly carried that
phantom date. The REAL constraint is cost: the full-clone (Option B) runs a SECOND copy of the expensive
Opus Match + Writer calls, so it roughly doubles Opus spend vs the shared approach. So build everything
`active:false` and PROVE the pipeline cheaply (claude-sonnet-4-6 or a re-drain of an already-scored job),
not by burning full-price Opus test runs. First live drain is Shaheen's call on the ~2x cost, not a date.

## Registration status: DONE (2026-07-28)
Registered in `system/manifest.json` as **#31 (scanner, `5tPXbhdpp6PfF56V`, cron `13 15 * * 2,4`)** with
the drain half split out as **#32 (`sxEYRyeHH7i1mHzb`, cron `43 15 * * 2,4`)**; routing table and docs
regenerated. `first_fire` corrected 2026-07-29 -> **2026-07-28** (a future date passes every check,
because V9 and C13 both branch on `first_fire` being null; the real date came from the executions API,
not a guess). The historical note below is kept for the reasoning it records.

**Historical (pre-2026-07-28):** NOT yet in `system/manifest.json` / the routing table. Deferred deliberately: `generate-alex.js` syncs the
voice block into the LIVE #03/#14 workflows, which would violate the "don't touch existing projects"
boundary. Formal registration (manifest entry num=31 + generator run) happens AFTER the Phase 0 go/no-go
and with Shaheen's explicit ok for the generator's engine-touch (or via a confirmed no-n8n generator mode).
Prepared manifest entry lives in the status page.

## Skills (bindings)
- n8n work (Phases 2-3) is MANDATORY-gated on the n8n-* skills: `n8n-workflow-patterns` FIRST, then
  `n8n-node-configuration`, `n8n-code-javascript`, `n8n-validation-expert`. Build via the n8n REST API,
  backup-first, GET read-back verified (Verify-after-write). n8n API key: `work/03-application-engine/config/n8n-api-key.txt`.
- Writer/CV prompt work: resume-ats-optimizer + resume-tailor (advisory). Job-posting analysis:
  job-description-analyzer (advisory).

## Trifecta
Gate: **read-only**. Legs: private_data=**false**, untrusted_content=**true** (portal job postings are a
new untrusted-content source), external_comm=**false**.

**Reclassified 2026-07-29 (was all-three-true + `draft-only`).** That declaration was inherited wholesale
when this project was cloned from #03, and it described the WHOLE lane rather than this workflow. It is
now split honestly: the drafting half is [[work/32-portal-application-engine]], which genuinely carries
all three legs and keeps `draft-only`. Verified against the live workflow `5tPXbhdpp6PfF56V` (12 nodes)
before changing the declaration:
- **No private data.** It reads a company-portal list from its own sheet, hits public ATS JSON, and
  prefilters on a hardcoded title/location keyword list. No CV, no profile, no people data. The only
  string that looks like one is a code COMMENT in `Map + Prefilter + Cap` ("disciplines that are not this
  CV") explaining why certain titles are excluded.
- **Untrusted content, yes.** Job postings arrive straight from third-party ATS APIs. This is the leg
  that is real, and it is why the gate is not `null`.
- **No external comm.** Its only writes are its own Google Sheet and an Alex HQ liveness stamp, both
  Shaheen's own infra. No Gmail node, no send path, no model call. Same reasoning that makes #02
  morning-brief `read-only` while it writes HQ tiles: storing to your own surfaces is not emitting to a
  third party.

**Why understating it would have been worse than overstating it:** a gate is a claim about what the
mitigation has to defend. Declaring `draft-only` here implied a human review step defuses an outbound
channel that does not exist, which quietly moves attention away from the leg that IS live (untrusted
third-party content entering the lane) and, if this project ever DID gain a send path, would have found
the trifecta already reading "handled". A declaration that is true of a neighbouring project is not true
here. Source of truth: the `trifecta` block in `system/manifest.json` + [[research/trifecta-map]].
Validator V12 fails the build if this section stops naming the declared gate.

## Vault
- Tier 1: vault/projects/portal-scanner/status.md
- Reuses [[me/cv-sources]] (CVs) + [[research/company-portal-scanning]] (design).

## Close-Out / propagation (WHEN a phase ships something real)
Per the root Change-Propagation standing order: manifest.json + generator (once registration is unblocked),
routing table, docs/n8n/portal-scanner export, docs/projects, the plain-English guide (13.7 + T07), the
ALEX-OS-master doc, status.md + vault/log.md + vault/index.md. Nothing propagates during the offline
Phase 0/1 build except the status page + log.

## Filename law (STANDING ORDER, Shaheen 2026-08-20, every lane, every producer)

His words: *"NEVER AGAIN when you prduce a new CV for any compay, mention the company name in the
file name itself. Nver again. fix this! Only my name and CV or a cover letter."*

Only two filenames may ship: **`Shaheen_Kiarash_CV.{pdf,docx}`** and
**`Shaheen_Kiarash_Cover_Letter.{pdf,docx}`** (the live engines' `Shaheen_Kiarash_CoverLetter.pdf`
also passes). No company, no role, no lane, no date, no version. Those belong in the FOLDER name and
the ledger row, which never leave this machine. The filename travels with the attachment: a
per-company name tells the recruiter this is one of many tailored versions and, on a forward, names
the target. Enforced by `node scripts/outputs-ledger.js validate` (exit 2), which the Monday recovery
sweep C12 calls; files dated before 2026-08-20 are grandfathered as already-sent history.

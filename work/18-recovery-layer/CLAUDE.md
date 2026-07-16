# Recovery Layer (18)

## Type
Automation (local, zero-token deterministic checker). Scheduled weekly + on-demand.

## Purpose
Alex's third layer (Import → Update → **Recovery**). Proves every change actually propagated, and
keeps the system verifiably healthy. The [[research/alex-recovery-layer|Change Propagation standing
order]] is edge-triggered: it fires per change and, if a session dies mid-propagation (context loss,
quota), the miss is permanent and invisible. This is the **level-triggered** layer (Kubernetes/
Terraform style): a scheduled sweep re-checks the WHOLE system against a desired-state manifest,
forgiving of missed events. It **detects, never auto-repairs** (IaC warning); judgment stays with
Shaheen and the monthly LLM /lint. Design + evidence: [[research/alex-recovery-layer]] (pieces 1-2).

## Entry Points
- **Scheduled:** `PersonalOS-recovery-check`, Monday 07:30 (shares the Alex Radar sweep slot). Pure PowerShell, no `claude` call, zero tokens.
- **On-demand:** `powershell -File work/18-recovery-layer/check.ps1` any time.
- **Baseline:** `check.ps1 -Init` after real structural changes (records CLAUDE.md hashes + log high-water into state/).
- **Test:** `check.ps1 -DryRun` runs the sweep and writes the report but does NOT push to Alex HQ.
- **n8n active-flag watcher (sibling, daily):** `PersonalOS-n8n-active-check`, daily 08:10 -> `scripts/n8n-active-check.ps1` (also zero-token, `-DryRun` to skip the HQ push). Reads the manifest's LIVE projects that map to an n8n workflow id (#3/#12/#14/#15/#16/#17), GETs each, asserts `active==true`, and pushes RED `recovery/n8n_active` + exit 1 if any expected-active workflow is OFF. A total-API outage is amber + exit 0 (transient, never a false RED). **Why it exists (BUG-01, 2026-07-16 diagnostic audit):** n8n's activate/deactivate does NOT bump `updatedAt`, so a silently deactivated LIVE workflow (the 2026-07-10 dual-engine class) is invisible to any timestamp check - you must read the flag itself, and the weekly sweep is too infrequent to catch a same-day miss. The still-open class fix is a shared PUT-with-active-hard-restore helper so no ad-hoc n8n REST write can drop the flag in the first place.

## Tools Used
PowerShell 5.1 (Get-ChildItem/Get-FileHash/Get-ScheduledTask/Invoke-RestMethod), the n8n-free local filesystem, Alex HQ push webhook. No LLM, no MCP, no network except the one HQ push.

## Infrastructure (as built 2026-07-04)
- **Manifest** `system/manifest.json` at the repo root (moved out of this folder 2026-07-08, refactor amendment A2: a system-wide registry must not live inside one numbered project) - since 2026-07-06 (audit steps 3+5) **THE project registry**, not just the checker's input. Per project: num, name, title, state (LIVE/ON-DEMAND/EVENT/DORMANT/PARKED/RETIRED + revisit dates), trigger, one_liner, docs, schedule_jobs[], hq_project, work_dir, commands[], status_md, `cadence` object (**upgrade P4, 2026-07-12: replaced the old cadence_days integer** - `{expected_hours: N|null, label, note?}`, the staleness window + render class HQ and the checks age against), `first_fire`/`first_fire_kind` (the date a project first produced for real; null = never fired, kind live|drill), n8n id + `meta.unnumbered` (voice, alex-costs, modeling) + the allowlists. **`hq_project` is also consumed (2026-07-07):** it's THE project→Alex-HQ metric-slug map that `work/16-alex-hq/scripts/build-projects.mjs` reads to render the HQ Automation Health board FROM this registry (so every registered project shows, not just producers); set it to the exact slug a producing project pushes under, null if it pushes none. Edited BY HAND when anything project-level changes; then run **`node scripts/generate-alex.js`** (the unified generator, since 2026-07-08; it absorbed generate-surfaces.ps1), which regenerates the root CLAUDE.md routing table AND the docs/projects/README table between markers (never hand-edit those) plus the other generated docs. /new writes its registry entry first. This is the source of truth the sweep validates disk against AND the source the human-facing tables are generated from - one edit, no propagation drift.
- **Checker** `check.ps1` - the sweep. Exit **0 clean / 2 drift / 1 checker-error** (Terraform `-detailed-exitcode` convention). Writes `vault/projects/recovery/last-sweep.md` (human report the Monday brief reads) and pushes `recovery/integrity` to Alex HQ (green clean / amber drift, value_num = distinct-finding count). Log: `outputs/logs/recovery-check.log`. **Hardened 2026-07-04 (QA review [[research/recovery-layer-qa-review]]):** repo root derived from `$PSScriptRoot` (survives a restore to any path/machine); the whole sweep is wrapped in a **fail-loud** try/catch that pushes RED integrity (value_num -1) + exit 1 on a checker error, so it can never sit stale-green while dead; the HQ push is best-effort (a bad token/network never fails the sweep).
- **State** `state/baseline.json` (CLAUDE.md hashes + last_init from `-Init`) + `state/log-highwater.json` (monotonic log line count). Gitignored (local runtime state).

## The checks (17 total - C1-C17, all deterministic, grow from real misses per the design)
1. **quad completeness** - each manifest project has its work dir, work CLAUDE.md, status.md, and every declared command file.
2. **orphan commands** - every `.claude/commands/*.md` is owned by a project or the utility allowlist (caught `/venture-sync`).
3. **orphan work folders** - every `work/` dir (not just `NN-*`) is a manifest project or in the `meta.known_work_folders` allowlist (`voice`, the on-demand voice loop); catches a rogue non-numbered folder.
4. **orphan vault projects** - every `vault/projects/*` is registered or a known extra (caught `modeling` + stale `market-pulse`/`opportunity-scout`).
5. **wiki-link resolution** - every `[[link]]` resolves. `vault/archive/` + `vault/sources/` are valid *targets* (real files); excluded as *sources* are index.md, log.md, the checker's own last-sweep.md, archive/, sources/, and immutable dated records (`history/`, `standups/`). **Path-style links** (`[[a/b]]`) require the full relpath OR a *unique* basename (so `[[people/name]]` resolves per the People Protocol, but `[[x/status]]` does NOT resolve via any `status.md`); bare `[[name]]` uses basename. Code-span links (examples) are stripped; cross-tree links to real `work/`/`sources/`/`outputs/` files resolve. Report ranks top distinct unresolved targets by count.
6. **routing rows** - a real `| NN |` routing-table row carries the project's work_dir (not just any prose mention; zero-pad tolerant).
7. **scheduler ↔ Task Scheduler** - every documented `PersonalOS-*` job is registered and vice versa. Ephemeral `PersonalOS-retry-*` one-shots (the close-out lib's self-scheduled retries, 2026-07-06) are excluded - they come and go by design.
8. **dependent staleness (hash-based)** - flags a project whose work CLAUDE.md hash changed since the last `-Init` but whose status.md hash did NOT (a real propagation gap). Mtime-immune, so a mass write (privacy scrub) or a git clone can't false-positive or mask it. Resolution: propagate for real, then re-run `-Init`.
9. **log monotonicity** - `vault/log.md` line count must never drop (append-only; guards data loss).
10. **manifest hash self-check** - a work CLAUDE.md changed since the last `-Init` → the manifest entry needs review (the manifest can't silently drift).
11. **index ↔ disk** - each manifest project's status page is catalogued in `vault/index.md` (a registered project missing from the catalog is caught; the design's named piece-2 check).
12. **outputs naming (2026-07-11, the amended-Ledger build [[research/output-structure-review]])** - outputs/ top-level dirs must be manifest keys or the declared exemptions; calls `node scripts/outputs-ledger.js validate` (exit 2 = drift) so the exemption list has ONE home. Detect-only here; healing = the nightly reconcile in vault-backup.ps1. Guards the backup whitelist against silent folder-name drift (the interview triple-name class).
13. **first-fire aging (C13, upgrade P4, 2026-07-12)** - a LIVE/EVENT registry row (numbered + unnumbered) with `first_fire: null` may age at most 14 days from its status.md frontmatter `created:` date (manifest states_doc rule). Past that = amber until it fires (a documented drill counts, `first_fire_kind: drill`) or is re-stated with a reason. ON-DEMAND/DORMANT/PARKED/RETIRED exempt. The generator's V9 warns on the same condition; also ambers a null-first_fire LIVE/EVENT row whose status.md has no `created:` date to age against.
16. **cadence-vs-schedule (C16, upgrade P4, 2026-07-12)** - manifest `cadence.label` vs the `- Frequency:` text in scheduler/schedule.md, per project carrying schedule_jobs (deterministic label->pattern map: daily/weekdays/weekly/monthly/always-on; a project passes when ANY of its schedule.md entries matches). Labels with no frequency expectation (expected_hours null) are skipped. 14. **passphrase attestation (C14, upgrade P10, 2026-07-12, closes audit c14)** - `state/passphrase-attested.txt` carries a yyyy-MM-dd first line, written by Shaheen AFTER confirming the vault-backup passphrase is in his password manager. Missing file, malformed date, or >90 days old = amber (the 90-day re-check doubles as the rotation-review prompt, the c15 fold). The check never reads the passphrase itself. All three branches synthetic-proven at build; the PS 5.1 TryParseExact overload trap (explicit culture/styles required) was caught live by the fail-loud wrapper and fixed.
15. **PAT expiry window (C15, upgrade P10, 2026-07-12, closes audit c17)** - the GitHub backup PAT expires ~2027-07-01 (`$patExpiry` constant in check.ps1, updated on rotation); amber inside 60 days, louder past expiry. The credential itself is never read.
17. **skills-symlink restore guard (C17, deep-audit BUG-16 fix, 2026-07-15)** - every `.agents/skills/<name>` (committed content) must have a resolving `.claude/skills/<name>` link. The link layer is gitignored (junctions on Windows), so a restore that skips the rebuild leaves MANDATORY skills silently unloadable. Amber lists the missing pairs; rebuild with `cmd /c mklink /J`.
**C8 tuning (b14) assessed 2026-07-12, deliberately UNCHANGED:** the hash-based check caught three real propagation gaps in one day (the #10 D7 edit, the #08/#21 P6 rider edits) with zero false positives; the "mass-write noise" class died with the mtime version. Weakening a working check to save -Init runs would be the QC's over-engineering trap.

**Not this sweep's job:** semantic/content drift (stale prose, superseded claims, duplicate topics). That is the **monthly gated /lint** (Phase 3): the checker nominates a shortlist, the LLM judges only that, Shaheen decides. Deterministic checks are ~10,000x cheaper than LLM judgment, so the script gates the judge.

## Notion Integration
None by design. Recovery reports via exit codes + the Alex HQ integrity metric + the brief, not a database (design: zero-token, exit-code driven).

## Vault Structure
- Tier 1: `vault/projects/recovery/status.md` (phases, checker state) + `vault/projects/recovery/last-sweep.md` (rewritten every run).
- Tier 2: `vault/projects/recovery/{github-backup-plan,vault-backup-plan,recovery-layer-plan}.md` (the three phase runbooks).

## Vault Reads
The whole tree structure (read-only): work/, .claude/commands/, vault/projects/, all vault/**/*.md for links, CLAUDE.md routing table, scheduler/schedule.md. Never modifies anything it checks.

## Vault Writes
Only its own report (`vault/projects/recovery/last-sweep.md`) + status.md + log.md. Detect-only everywhere else.

## Connections
- **Extends:** [[projects/error-log]] (reactive → preventive), /lint (gets a gate + a schedule), the run-health rollout (scripts/lib/close-out.ps1, already on every wrapper).
- **Feeds:** [[projects/alex-hq/status|Alex HQ]] (`recovery/integrity` metric), [[projects/morning-brief/status|Morning Brief]] (Monday drift lines from last-sweep.md), [[projects/alex-ai-radar/status|Alex Radar]] (shares the Monday sweep + first-Monday retro cadence).
- **Sibling phases:** [[projects/recovery/github-backup-plan]] (Phase 0), [[projects/recovery/vault-backup-plan]] (Phase 1).

## Post-Run (mandatory)
1. `last-sweep.md` rewritten (automatic).
2. `recovery/integrity` pushed to Alex HQ (automatic).
3. New real drift → surface to Shaheen; register/fix or retire-to-archive; NEVER auto-repair.
4. Structural change made → re-run `check.ps1 -Init` to re-baseline.
5. status.md + log.md updated on any change to the layer itself.

## Close-Out Extras
Beyond the universal list, a recovery run verifies: the sweep wrote last-sweep.md this run; the integrity metric pushed (or logged why not); exit code matches the report (0/2/1); nothing outside last-sweep.md/status.md/log.md was modified (detect-only invariant).

## Open items
- **QA hardening DONE 2026-07-04** ([[research/recovery-layer-qa-review]], 3-agent review): 5 must-fixes applied - de-hardcoded `$repo`, fail-loud try/catch, stopped self-polluting via last-sweep.md, true log line-count (`.Count` not `Measure-Object -Line`), archive/ kept as valid link targets. Findings verified all true positives; fail-loud path self-tested (throw → RED + exit 1).
- **Check-list should-fixes DONE 2026-07-04** (item 2 of the QA board): (a) C5 now matches the real `| NN |` routing-table row carrying the work_dir, not any prose mention (0*-tolerant of zero-padded row numbers); (c) C6 strips fenced + inline code before matching, so `[[links]]` shown as examples don't count; (e) C3 now scans ALL `work/` dirs against the manifest + a `meta.known_work_folders` allowlist (`voice`, the on-demand voice loop), so a rogue non-`NN` folder is caught while legit tooling is registered; **plus** cross-tree links to real files under `work/`/`sources/`/`outputs/` now resolve (were false positives). Re-sweep after: routing 0, links 26→20.
- **Final check-list pass DONE 2026-07-05** (from the items 3+4 QA, [[research/recovery-gc-qa-review]]): (b) C6 path-style links now require the full relpath or a *unique* basename (surfaced 11 real `[[application-engine/status]]` wrong-form links, rewritten to canonical `job-pipeline/status` - not suppressed); (d) **C11 index↔disk** implemented (manifest project ↔ index.md catalog); (f) **C8 is now hash-based** (status.md + CLAUDE.md hashes vs the -Init baseline), mtime-immune, so the privacy-scrub mass write / a git clone can neither false-positive nor mask it - this retired the mtime version AND the 3 "reviewed current" status.md stamps it had forced. Board reached an HONEST CLEAN (0 findings).
- **Still deferred:** the #03/#14 **naming consolidation** (canonical vault name = routing name, retiring the alias pages) - bigger refactor; the aliases hold the links today. C7 remains machine-coupled by design.
- **Phase 3 LIVE 2026-07-06 (audit step 8):** the gated monthly /lint is scheduled - job `PersonalOS-lint-monthly`, first Monday 10:00, wrapper `scripts/run-lint.ps1` (checker runs FIRST as the nomination pass; exit 1 aborts the LLM pass; /lint judges only the shortlist, writes vault/projects/recovery/lint-YYYY-MM.md, proposes only). Companion probe added same day: `PersonalOS-auth-check` (Sun 19:30, scripts/auth-check.ps1 → HQ infra/auth_ok) so headless-auth expiry is caught before the Monday train.
- **Deprecation/GC protocol (design piece 4):** supersede-never-delete tombstones + `vault/archive/` move + strike-through routing row, for the orphan-project findings (modeling, market-pulse, opportunity-scout). Candidacy is a dumb 90-day date compare; judgment stays human.
- **Grow the check list** from real misses logged in [[projects/error-log]] (design: medium-confidence v1).
- **Log-archive procedure (BUG-19 note, 2026-07-15):** C9 (log monotonicity) high-water only ever grows (`[math]::Max`). If `vault/log.md` is ever intentionally archived or split by year, run `check.ps1 -Init` right after to reset the high-water; otherwise C9 ambers every Monday until re-baselined. Append-only is still the rule; this is only for a deliberate archival.
- **n8n-side drift** (live workflow vs runbook export) via a REST diff - a spike, not assumed (design unknown).
- Optional dedicated Alex HQ "integrity" glance tile (metric already flows in the recovery drill-down).

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

## Tools Used
PowerShell 5.1 (Get-ChildItem/Get-FileHash/Get-ScheduledTask/Invoke-RestMethod), the n8n-free local filesystem, Alex HQ push webhook. No LLM, no MCP, no network except the one HQ push.

## Infrastructure (as built 2026-07-04)
- **Manifest** `manifest.json` — the curated desired-state registry: one entry per project (num, name, work_dir, commands[], status_md, cadence_days, n8n id, claude_md_sha) + `meta.utility_commands` allowlist + `meta.known_extra_projects_no_work_folder` (recovery, alex-costs). Edited BY HAND when a project is added / retired / renamed. This is the source of truth the sweep validates disk against.
- **Checker** `check.ps1` — the sweep. Exit **0 clean / 2 drift / 1 checker-error** (Terraform `-detailed-exitcode` convention). Writes `vault/projects/recovery/last-sweep.md` (human report the Monday brief reads) and pushes `recovery/integrity` to Alex HQ (green clean / amber drift, value_num = drift count). Log: `outputs/logs/recovery-check.log`.
- **State** `state/baseline.json` (CLAUDE.md hashes + last_init from `-Init`) + `state/log-highwater.json` (monotonic log line count). Gitignored (local runtime state).

## The checks (v1 — 10, all deterministic, grow from real misses per the design)
1. **quad completeness** — each manifest project has its work dir, work CLAUDE.md, status.md, and every declared command file.
2. **orphan commands** — every `.claude/commands/*.md` is owned by a project or the utility allowlist (caught `/venture-sync`).
3. **orphan work folders** — every `work/NN-*` dir is in the manifest.
4. **orphan vault projects** — every `vault/projects/*` is registered or a known extra (caught `modeling` + stale `market-pulse`/`opportunity-scout`).
5. **wiki-link resolution** — every `[[link]]` resolves to a vault page (Obsidian basename/path style; index.md + log.md excluded as navigation; prose placeholders ignored; soul.md allowed).
6. **routing rows** — each manifest project's work_dir appears in the CLAUDE.md routing table.
7. **scheduler ↔ Task Scheduler** — every documented `PersonalOS-*` job is registered and vice versa.
8. **dependent staleness** — flags a project whose work CLAUDE.md is >7 days newer than its status.md (propagation may be stale).
9. **log monotonicity** — `vault/log.md` line count must never drop (append-only; guards data loss).
10. **manifest hash self-check** — a work CLAUDE.md changed since the last `-Init` → the manifest entry needs review (the manifest can't silently drift).

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
- **Phase 3:** the gated monthly /lint (checker shortlist → LLM judge). Aligns with the Radar first-Monday retro.
- **Deprecation/GC protocol (design piece 4):** supersede-never-delete tombstones + `vault/archive/` move + strike-through routing row, for the orphan-project findings (modeling, market-pulse, opportunity-scout). Candidacy is a dumb 90-day date compare; judgment stays human.
- **Grow the check list** from real misses logged in [[projects/error-log]] (design: medium-confidence v1).
- **n8n-side drift** (live workflow vs runbook export) via a REST diff — a spike, not assumed (design unknown).
- Optional dedicated Alex HQ "integrity" glance tile (metric already flows in the recovery drill-down).

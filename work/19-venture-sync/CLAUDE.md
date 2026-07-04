# Venture Sync (19)

## Type
Automation (local, command-driven vault ingestion). On-demand. **Currently DORMANT** (built + configured, not yet run against live venture repos).

## Purpose
Mirror high-value markdown from each external venture's own repo into `vault/ventures/{name}/docs/`, generate a synthesis `brief.md` per venture, and scaffold `projects/{name}.md` pages from auto-discovered sub-initiatives. **Read-only mirror**: the source of truth stays in each venture's repo; the vault gets a synced, frontmatter-stamped copy so Alex can reason over venture context without leaving the vault. Registered as project #19 on 2026-07-04 by the recovery layer (it had been an unregistered command, the first sweep's orphan-cmd finding).

## Entry Points
- **Command:** `/venture-sync` (spec = `.claude/commands/venture-sync.md`, 199 lines). Modes: full sync · `<venture>` (one) · `--discover-only` (propose project list, write nothing) · `--briefs-only` (regenerate briefs, no re-mirror).
- **Schedule:** none registered. The command doc's "weekly Monday" line is aspirational; there is no `PersonalOS-venture-sync` Task Scheduler job. Activate + schedule when the ventures go live (then add to scheduler/schedule.md + /cron-setup).
- **Suggested by /lint** when a synced doc's `git_sha` is >14 days behind source.

## Config
`vault/ventures/_sync-config.md` — YAML whitelist of `{code_path, sync_files, project_source}` per venture. Currently 5 ventures: **brandmodal, alphastar, insightai, finance-us, stemplicity** (all `~/Desktop/{name}`). Auto-skips sysprompts/boilerplate (CLAUDE.md, AGENTS.md, README.md, oversized CHANGELOG). Edit this file to add/drop docs; do NOT hardcode paths in the command.

## Tools Used
Local filesystem (read external repos, write vault), git (read `git_sha` of source), the command's own LLM synthesis for `brief.md`. No MCP, no n8n. Read-only against the venture repos.

## Notion Integration
None.

## Vault Structure
- Tier 1: `vault/projects/venture-sync/status.md` (this project's status; dormant until first run).
- Tier 2: `vault/ventures/{name}/docs/` (synced, read-only, frontmatter-stamped) + `vault/ventures/{name}/brief.md` (synthesis). All gitignored (external venture content, may be private).
- Config: `vault/ventures/_sync-config.md`.

## Vault Reads
The external venture repos named in `_sync-config.md` (read-only); soul.md (voice for brief synthesis).

## Vault Writes
`vault/ventures/{name}/docs/*` + `brief.md` + scaffolded `vault/projects/{name}.md`. Never edits a synced doc (edit the source instead). Never touches a venture's repo.

## Connections
- **Feeds:** venture context into the vault for any Alex reasoning; scaffolds new `projects/{name}.md` pages.
- **Related:** [[me/situation]] (STEMPLICITY is Shaheen's live venture); /lint (staleness nudge); [[projects/recovery/status]] (registered here after the sweep).

## Status (2026-07-04)
- **DORMANT.** Command + config exist; no `vault/ventures/{name}/docs/` output yet, so it has not been run against live repos. `code_path`s point to `~/Desktop/{name}` folders whose existence is unverified.
- Registered in the manifest (#19) + routing table so the recovery checker stops flagging the command as an orphan.

## Post-Run (when first activated)
1. New venture → `vault/ventures/{name}/`, scaffold `projects/{name}.md`.
2. Update `vault/projects/venture-sync/status.md` (last sync, per-venture git_sha).
3. `vault/index.md` for any new project pages; `vault/log.md` per run.

## Open items
- **Activate:** verify the 5 `code_path`s exist, run `/venture-sync --discover-only` first, then a real sync; flip status to active.
- **Schedule:** register `PersonalOS-venture-sync` (weekly) + scheduler/schedule.md entry once active (the command doc's schedule claim is corrected to reflect that it is NOT yet scheduled).
- Decide whether the scaffolded `projects/{name}.md` pages should be full manifest projects or stay vault-only.

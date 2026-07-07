# /alex-hq - Push Local Metrics + Show HQ Summary

Spec: work/16-alex-hq/CLAUDE.md (read it first). Status + IDs: vault/projects/alex-hq/status.md.

## What this command does
1. **Harvest local-only metrics** (the ones only this ThinkPad can see):
   - `infra.mcp_tools`: count `mcp__` tool names available (or `claude mcp list`)
   - `infra.vault_pages`: `Glob vault/**/*.md` count (+ people/business/research sub-counts as value_text)
   - `infra.scheduled_jobs_active`: `schtasks /query` count of enabled Personal OS jobs (see vault/projects/cron-paths.md for names)
   - `recovery.hours_since_last_push`: `git log -1 --format=%ct origin/main` → hours since the last GitHub backup push (added 2026-07-02, Recovery Phase 0; amber-worthy if > 30h since the job runs daily 21:30)
   - `infra.n8n_up_today` + `infra.n8n_broken_today`: run `python work/16-alex-hq/scripts/n8n_liveness.py` - it queries the n8n REST API and prints a JSON **array** of TWO ready-to-push events: `n8n_up_today` (active workflows that ran today, over active count) and `n8n_broken_today` (workflows broken RIGHT NOW = latest run errored, OR an expected-daily workflow gone silent >26h; red with the offenders named). Merge BOTH array elements into the step-2 events push verbatim. If it exits non-zero (API unreachable), SKIP both - never push a fabricated 0. (up_today added 2026-07-04; broken_today added 2026-07-06 - it's the number behind the "Broken n8n today" HQ card, and the Pipeline Error Alert workflow pushes the same key RED the instant a guarded workflow throws.)
1b. **Refresh the static data JSONs** (volume-mounted at /app/public/data, no rebuild ever needed; skip gracefully if SSH is unavailable):
   - Brain graph (v1.2): `node work/16-alex-hq/scripts/build-graph.mjs`
   - To-Do card (2026-07-06): `node work/16-alex-hq/scripts/build-todos.mjs` — parses the sprint vault snapshot (vault/projects/sprint-tracker/status.md board table + newer "New row" update lines) into todos.json (open items only)
   - Gym + plants cards (2026-07-06): `node work/16-alex-hq/scripts/build-life.mjs` — parses vault/me/gym.md (Start date) + vault/me/plants.md (watering table) into life.json. If this session synced fresher Life Ops sheet data, update those vault pages FIRST, then build.
   - Project roster (2026-07-07): `node work/16-alex-hq/scripts/build-projects.mjs` — reads the project registry (work/18-recovery-layer/manifest.json) into projects.json so the Automation Health board shows EVERY registered project (not just the ones pushing telemetry). Add a project to the registry → it appears on HQ on the next harvest, no HQ edit. Non-reporting projects render an honest idle ticket; live metrics merge on by `hq_project` slug.
   - n8n drill-down list: written by the step-1 `n8n_liveness.py` run as n8n-workflows.json (no extra command)
   - Ship all five: `scp work/16-alex-hq/app/public/data/graph.json work/16-alex-hq/app/public/data/todos.json work/16-alex-hq/app/public/data/life.json work/16-alex-hq/app/public/data/n8n-workflows.json work/16-alex-hq/app/public/data/projects.json n8n:/opt/alex-hq-data/`
2. **Push** them: `POST https://n8n.shaheenkiarash.com/webhook/alex-push` with header `X-Alex-Token: $(cat work/16-alex-hq/config/alex-hq-token.txt)`, body `{"events": [...]}` per the contract in the spec. NEVER print or log the token.
3. **Fetch** `GET https://n8n.shaheenkiarash.com/webhook/alex-hq-summary` (same header) and present the summary in Alex voice: per-project status colors, stale projects (last_ts older than its cadence), red/amber first.
3b. **HQ inbox check (two-way notes; full runbook = work/16-alex-hq/CLAUDE.md "Inbox Contract").** GET `/webhook/alex-inbox` (same token header). If `count_new` > 0: voice notes get scp'd from n8n:/opt/alex-inbox-audio/ + transcribed with local Whisper; every note filed per the standing vault protocols; then POST `/webhook/alex-inbox-mark` (`{"marks":[{"id":N,"filed_to":"...","note":"<final text - REQUIRED>"}]}`); remote+local audio deleted after a voice mark. Report "HQ notes: N filed → destinations". Unreachable → one line, continue.
4. Optional arg `status`: skip the push, just fetch + present.

## Post-run
- vault/projects/alex-hq/status.md: last_run + row count
- vault/log.md: `## [YYYY-MM-DD HH:MM] alex-hq | pushed N local metrics, M rows / K projects, health: ...`
- Flag any project whose data is stale or red in the output; suggest the fix, don't auto-fix.

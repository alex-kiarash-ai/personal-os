# /alex-hq - Push Local Metrics + Show HQ Summary

Spec: work/16-alex-hq/CLAUDE.md (read it first). Status + IDs: vault/projects/alex-hq/status.md.

## What this command does
1. **Harvest local-only metrics** (the ones only this ThinkPad can see):
   - `infra.mcp_tools`: count `mcp__` tool names available (or `claude mcp list`)
   - `infra.vault_pages`: `Glob vault/**/*.md` count (+ people/business/research sub-counts as value_text)
   - `infra.scheduled_jobs_active`: `schtasks /query` count of enabled Personal OS jobs (see vault/projects/cron-paths.md for names)
   - `recovery.hours_since_last_push`: `git log -1 --format=%ct origin/main` → hours since the last GitHub backup push (added 2026-07-02, Recovery Phase 0; amber-worthy if > 30h since the job runs daily 21:30)
   - `infra.n8n_up_today`: run `python work/16-alex-hq/scripts/n8n_liveness.py` — it queries the n8n REST API and emits ONE ready-to-push metric event (active workflows that ran today, over active count, Europe/Stockholm day). Include its JSON line verbatim in the step-2 events push. If it exits non-zero (API unreachable), SKIP it — never push a fabricated 0. (Added 2026-07-04; before this it was a one-shot push that went stale after its 26h cadence.)
1b. **Refresh the Brain graph** (v1.2): `node work/16-alex-hq/scripts/build-graph.mjs` then `scp work/16-alex-hq/app/public/data/graph.json n8n:/opt/alex-hq-data/graph.json` (volume-mounted, no rebuild needed). Skip gracefully if SSH is unavailable.
2. **Push** them: `POST https://n8n.shaheenkiarash.com/webhook/alex-push` with header `X-Alex-Token: $(cat work/16-alex-hq/config/alex-hq-token.txt)`, body `{"events": [...]}` per the contract in the spec. NEVER print or log the token.
3. **Fetch** `GET https://n8n.shaheenkiarash.com/webhook/alex-hq-summary` (same header) and present the summary in Alex voice: per-project status colors, stale projects (last_ts older than its cadence), red/amber first.
3b. **HQ inbox check (two-way notes; full runbook = work/16-alex-hq/CLAUDE.md "Inbox Contract").** GET `/webhook/alex-inbox` (same token header). If `count_new` > 0: voice notes get scp'd from n8n:/opt/alex-inbox-audio/ + transcribed with local Whisper; every note filed per the standing vault protocols; then POST `/webhook/alex-inbox-mark` (`{"marks":[{"id":N,"filed_to":"...","note":"<final text — REQUIRED>"}]}`); remote+local audio deleted after a voice mark. Report "HQ notes: N filed → destinations". Unreachable → one line, continue.
4. Optional arg `status`: skip the push, just fetch + present.

## Post-run
- vault/projects/alex-hq/status.md: last_run + row count
- vault/log.md: `## [YYYY-MM-DD HH:MM] alex-hq | pushed N local metrics, M rows / K projects, health: ...`
- Flag any project whose data is stale or red in the output; suggest the fix, don't auto-fix.

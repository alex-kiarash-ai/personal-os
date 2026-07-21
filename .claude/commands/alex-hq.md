# /alex-hq - Push Local Metrics + Show HQ Summary

Spec: work/16-alex-hq/CLAUDE.md (read it first). Status + IDs: vault/projects/alex-hq/status.md.

## What this command does
1. **Deterministic harvest + build + ship + push + verify (ONE script, NOT the model):**
   `python scripts/hq_harvest_push.py`. This is the whole number path. **Do NOT count MCP tools,
   scheduled jobs, vault pages, or n8n liveness yourself, and do NOT scp by hand** - the script
   does all of it from real sources, ships the 5 JSONs with a box-mtime read-back, POSTs the push,
   and read-back-verifies the infra metrics. It exits non-zero + prints RED lines on a hard failure
   (push rejected / ship stale / read-back mismatch). Surface those RED lines; do not paper over them.
   **Why a script (2026-07-21):** the old flow asked the (headless, terse) model to count its own
   `mcp__` tools - but tools went DEFERRED in the harness (~07-17), so the model saw none and pushed
   `mcp_tools=0/"unknown"`; the scheduled-jobs count drifted to 0; and the scp silently stopped,
   freezing every box data file at 07-20 06:47. None of that is model work. The script owns it now.
   What the script gathers and pushes:
   - `infra.mcp_tools` - CONNECTED MCP servers via `claude mcp list` (was tool-name counting; switched
     to servers because deferred tools can't be self-counted). value_text names how many need re-auth.
   - `infra.scheduled_jobs_active` - enabled `PersonalOS-*` Windows scheduled tasks (schtasks).
   - `infra.vault_pages` - `vault/**/*.md` count + people/business/research sub-counts.
   - `infra.n8n_up_today` + `infra.n8n_broken_today` - from `n8n_liveness.py` (also writes
     n8n-workflows.json). `up_today` = **scheduled workflows ON-CADENCE** over the cadence-monitored count
     (each measured against a window derived from its own trigger: daily 26h, 72h engines ~82h, Tue/Thu
     LinkedIn ~144h; + the daily health webhook), NOT all 16 active. Silence-aware: a scheduled workflow
     that quietly stops firing is flagged broken within its own window - the webhook/MCP workflows have no
     cadence and are error-tested only (idle by design).
   - The 5 static JSONs (graph, todos, life, projects, n8n-workflows), built + scp'd to
     `/opt/alex-hq-data/` (volume-mounted, no rebuild) + mtime-verified fresh on the box.
   - `alex-hq.run_status` heartbeat + `human-actions.open_count` (Waiting-on-you strip).
   - **Life data note:** if this session synced fresher Life Ops sheet data, update vault/me/gym.md +
     vault/me/plants.md FIRST, then run the script (build-life.mjs reads the vault).
1c. **SELF-HEAL (every HQ update CHECKS + FIXES, not just displays):** `python scripts/hq_self_heal.py`.
   Zero-token, deterministic. It re-derives ground truth for each metric and, per the risk class in
   `system/hq-heal-map.json`: **AUTO-SAFE** mismatches (MCP count, stale box JSONs, n8n metric) are
   re-derived + re-pushed + read-back-verified automatically; **PROPOSE** (a live workflow redeploy/
   reactivation, a stuck-flag clear) and **HUMAN-ONLY** (phone/OAuth) items are queued to
   `human-actions.jsonl` with a diagnosis, never auto-run (Shaheen's autonomy boundary). Every action ->
   `system/heal-log.jsonl`; the printed "self-heal: N healed, M proposed ..." line is the audit surface.
   Surface any HEALED/PROPOSED/ESCALATED lines in the output; the morning brief also reports them.
   Home: recovery-layer (#18), the FIX half of the detect-only checker.
2. **(covered by step 1)** The push + the read-back verify are inside the script. NEVER print the token.
3. **Fetch + present.** GET `https://n8n.shaheenkiarash.com/webhook/alex-hq-summary` (header
   `X-Alex-Token: $(cat work/16-alex-hq/config/alex-hq-token.txt)`) and present the summary in Alex
   voice: per-project status colors, stale projects (last_ts older than its cadence), red/amber first.
3a. **Quota mirror (upgrade P3, 2026-07-12):** if the summary carries `projects.quota.metrics.anthropic_api` with status red and a ts newer than `system/quota-state.json`'s anthropic_api.detected, update quota-state.json (state=capped, detected=that ts, keep/derive reset_date = first of next month). This is how an n8n-side cap detection reaches the local wrapper gate without a new channel.
3b. **HQ inbox check (two-way notes; full runbook = work/16-alex-hq/CLAUDE.md "Inbox Contract").** GET `/webhook/alex-inbox` (same token header). If `count_new` > 0: voice notes get scp'd from n8n:/opt/alex-inbox-audio/ + transcribed with local Whisper; every note filed per the standing vault protocols; then POST `/webhook/alex-inbox-mark` (`{"marks":[{"id":N,"filed_to":"...","note":"<final text - REQUIRED>"}]}`); remote+local audio deleted after a voice mark. Report "HQ notes: N filed → destinations". Unreachable → one line, continue.
4. Optional arg `status`: skip the push, just fetch + present.

## Post-run
- vault/projects/alex-hq/status.md: last_run + row count
- vault/log.md: `## [YYYY-MM-DD HH:MM] alex-hq | pushed N local metrics, M rows / K projects, health: ...`
- Flag any project whose data is stale or red in the output; suggest the fix, don't auto-fix.

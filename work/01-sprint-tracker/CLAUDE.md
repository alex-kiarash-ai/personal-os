# Sprint Tracker

## Type
Automation

## Purpose
Reads the Notion Progress Tracker board (the master list of automations to build), generates a daily standup summary (Done / In Progress / Next / Planned / Blocked with counts), and tracks build velocity over time. It is the heartbeat of the Personal OS build-out: one glance tells Shaheen what shipped, what's moving, and what's stuck.

## Entry Points
- **Scheduled:** weekdays at 9:00 AM via system scheduler (`claude -p "Run /sprint-tracker"`)
- **On-demand:** `/sprint-tracker`

## Tools Used
- Notion MCP (`notion-search`, `notion-fetch`, `notion-create-pages`, `notion-update-page`)
- No Chrome, no Gmail, no Calendar.

## Notion Integration
**No new database.** This automation reads and writes the existing **Progress Tracker** DB:
- db_id: `462c1e60-a70c-4fd4-815f-2a58b1f8f573`
- data_source_id: `0c239613-7e4e-410c-b064-266fa31a9da4`
- parent_page_id: `37bb5342-d7f1-81a4-8bf1-d5642d7c3e85` (Personal OS page)
- Schema: Task (title), Status (Planned/Next/In Progress/Blocked/Done), Project (Job Pipeline/Modeling/STEMPLICITY/Personal OS), Order (number), Notes (text)
- Views: Board (by Status), Build Order (by Order), Default table

**Gotcha:** `notion-fetch` on the database or data source returns schema and views only, NOT rows. **Primary read path: fetch each row by page ID** from the snapshot table in `vault/projects/sprint-tracker/status.md` (every known row has its Notion page ID stored there). Use `notion-search` scoped to the data source ONLY to discover rows not yet in the snapshot (new tasks added by hand in Notion); semantic search caps at 25 results and is not guaranteed complete, so never rely on it as the sole row listing. Any newly discovered row gets its page ID added to the snapshot.

Each run also creates one **standup page** under the Personal OS parent page, titled `Standup YYYY-MM-DD`, with the full summary as content.

## Vault Structure
- **Tier 1:** `vault/projects/sprint-tracker/status.md` — DB IDs, schema, current board snapshot, last run.
- **Tier 2:** `vault/projects/sprint-tracker/standups/YYYY-MM-DD.md` — one standup per run.
- **Tier 2:** `vault/projects/sprint-tracker/velocity.md` — append-only counts table, one row per run; velocity = Done delta between runs.

## Vault Reads
- soul.md (voice + priority filtering: rent-moving work first, job pipeline > modeling > STEMPLICITY)
- vault/projects/sprint-tracker/status.md (IDs + previous snapshot)
- vault/projects/{name}/status.md of any automation on the board (for "what's blocking" context)

## Run Checks (every standup, before writing output)

1. **Missed-run detection.** Compare today's date against the last row in velocity.md. If one or more weekdays were skipped, the standup MUST open with "Missed N run(s) since YYYY-MM-DD" and the velocity row gets a note `(covers N missed days)`. Never silently absorb a gap; a dead schedule must be visible in the first standup after it dies. If the gap is 3+ weekdays, also suggest checking `schtasks /query /fo csv | findstr PersonalOS` and `outputs/logs/sprint-tracker.log`.
2. **Contract enforcement.** Cross-check the Routing Table in the project root CLAUDE.md against board rows. Every automation in the table must have a row on the board. If one is missing, create the row (Status per its actual state, Project select, next Order number, content body) and flag it in the standup as a contract violation by /new.
3. **Stale-task flagging.** The snapshot table in status.md carries a `Since` date per row (when the current Status was first observed). On status change, reset Since to today. Any row sitting In Progress, Next, or Blocked for 5+ weekdays gets called out in the standup with its age and, if known from vault project pages, what it's waiting on.

## Vault Writes
- New standup file in standups/
- Append row to velocity.md (with missed-day note when applicable)
- Refresh board snapshot in status.md: Status, `Since` (reset on status change), `Page ID` (add for new rows), last_run
- vault/log.md entry; vault/index.md if new pages

## Connections
- **Feeds into:** /status (morning overview), every future automation's "mark Done" step lands here.
- **Fed by:** every automation built via /new. **Contract: /new Step 5 MUST set the automation's row to Done on this board on first successful build.** If no row exists, /new creates one (Project select, next Order number, content body).

## Post-Run (mandatory)
1. No people/companies expected; create vault/people/ or vault/business/ pages only if board notes mention new ones.
2. Add [[wiki links]] between standup, status, and project pages.
3. Update Notion (standup page; row statuses only if instructed).
4. Update vault/index.md (first run / new pages only).
5. Update vault/log.md.
6. Sprint board: this automation marked itself Done on first build (2026-06-10).
7. **Alex HQ metrics push** (build #16 contract, work/16-alex-hq/CLAUDE.md). Push BOTH events in one call: `velocity` feeds the weekly tile; `run_status` green clears any red left by the scheduled wrapper. Never let a push failure fail the run; never print or log the token:
   `curl -s -m 10 -X POST https://n8n.shaheenkiarash.com/webhook/alex-push -H "Content-Type: application/json" -H "X-Alex-Token: $(cat work/16-alex-hq/config/alex-hq-token.txt)" -d '[{"project":"sprint","metric_key":"velocity","value_num":{velocity},"headline":"Done {done} of {total} · velocity +{n}","status":"{amber if missed runs, else green}"},{"project":"sprint","metric_key":"run_status","value_num":1,"headline":"run clean {YYYY-MM-DD}","status":"green"}]' || true`

## Close-Out Extras (Close-Out Gate)
Beyond the universal gate ([[research/alex-close-out-gate]]), this run is not COMPLETE until:
- `vault/projects/sprint-tracker/velocity.md` has a new row for this run (with the `(covers N missed days)` note when a gap was detected).

## Scheduled Wrapper (hardened 2026-07-02, after the 06-26/29/30 blackout)
- **scripts/run-sprint-tracker.ps1** no longer fails silent. It dot-sources the shared close-out mechanism `scripts/lib/close-out.ps1` (folded onto it 2026-07-03 for a single implementation) and calls `Invoke-CloseOutCheck -Project 'sprint'` after the run: detects blank output / wrapper crash / not-logged-in / usage-session-limit / non-zero exit, logs `FAILED: {reason}` to outputs/logs/sprint-tracker.log, pushes `sprint/run_status` RED to Alex HQ with the reason, and exits 1. Success exits 0 (the green push happens inside the /sprint-tracker post-run above). Testable: `-ClaudeCmd {stub}` swaps the claude binary, `-DryRun` logs the would-be push instead of sending. Stub-verified 2026-07-03: a clean run exits 0; a session-limit-with-exit-0 run exits 1 + RED (the exact 06-30 incident).
- **Task Scheduler retry ladder:** `PersonalOS-sprint-tracker` now has RestartCount 4 / RestartInterval 90min / ExecutionTimeLimit 1h (was 0 restarts / 72h). A 9:00 quota fail self-retries at 10:30, 12:00, 13:30, 15:00, so the 1pm session-limit reset is covered without moving the slot. Login failure still needs a human (`claude /login`), but every failed attempt lands RED on the HQ health board, so it can never be silently dark again. If /cron-setup ever re-creates this task, re-apply the retry settings (documented in scheduler/schedule.md).

## Implementation Notes (as built, 2026-06-10)
- First run executed manually during build. Board had 7 seeded rows; "Sprint Tracker" row added as row 8 (Status Done, Project Personal OS, Order 0 so it tops the Build Order view as shipped infrastructure).
- Velocity baseline started at 1 Done (this automation). Counts: Done 1, In Progress 1, Next 1, Planned 5, Blocked 0.
- Standup voice: Alex (soul.md). Lead with the single highest-leverage item, then counts, then stalls. No corporate standup-speak.
Ye
# Sprint Tracker

## Type
Automation

## Purpose
Reads the Progress Tracker (the master list of automations to build), generates a daily standup summary (Done / In Progress / Next / Planned / Blocked with counts), and tracks build velocity over time. It is the heartbeat of the Personal Ops System build-out: one glance tells Shaheen what shipped, what's moving, and what's stuck.

**Read mode (Shaheen's call 2026-07-18): cache-mode is the ACCEPTED design, not a degradation.** The core reads the local snapshot table in status.md (cache fallback), not a live Notion board query - the integration token was never restored to `config/notion-token.txt`, and with #01 PARKED there's no reason to. This is deliberate: counts still compute; only the shipped/reconciled velocity split needs the live read, which nobody is watching while #01 is paused. If #01 is ever un-parked, restoring the token (Setup below) re-enables the live read. Docs must not claim a live board read while the token is absent.

## Entry Points
- **Scheduled:** weekdays at 9:00 AM via system scheduler (`claude -p "Run /sprint-tracker"`)
- **On-demand:** `/sprint-tracker`

## Tools Used
- **`node scripts/sprint-tracker-core.js`** (rebuilt 2026-07-10) - the zero-token deterministic core: reads the board, computes counts/velocity/stale/missed-run/contract, writes velocity.md + board-state.json + last-run.json + decisions-pending.md, pushes HQ green. Reads the board via the Notion REST API (paginated, `scripts/lib/notion-board.js`) with the integration token at `work/01-sprint-tracker/config/notion-token.txt`; falls back to parsing the status.md snapshot table when the token is absent. Runs with NO Claude tokens, so a quota blackout can't make the tracker dark.
- Notion MCP (`notion-create-pages`, `notion-update-page`) - the OPTIONAL Claude prose pass only, to write the standup page. Reading the board no longer goes through the MCP.
- No Chrome, no Gmail, no Calendar.

## Notion Integration
**No new database.** This automation reads and writes the existing **Progress Tracker** DB:
- db_id: `462c1e60-a70c-4fd4-815f-2a58b1f8f573`
- data_source_id: `0c239613-7e4e-410c-b064-266fa31a9da4`
- parent_page_id: `37bb5342-d7f1-81a4-8bf1-d5642d7c3e85` (Personal Ops System page)
- Schema: Task (title), Status (Planned/Next/In Progress/Blocked/Done), Project (Job Pipeline/Modeling/Personal Ops System), Order (number), Notes (text)
- Views: Board (by Status), Build Order (by Order), Default table

**Read path (rebuilt 2026-07-10): paginated Notion REST, not the MCP.** `scripts/lib/notion-board.js` queries `POST /v1/data_sources/{data_source_id}/query` with cursor pagination (Notion-Version 2025-09-03; falls back to `/v1/databases/{db_id}/query` at 2022-06-28), returning ALL rows in one deterministic pass - no 25-result cap, no hand-maintained page-ID list. Credentials: a Notion internal-integration token shared to this DB, at `work/01-sprint-tracker/config/notion-token.txt` (gitignored, MANUAL one-time setup - see Setup below). If the token is absent the core falls back to parsing the status.md snapshot table (degraded: counts still work, but the honest shipped/reconciled velocity split needs the live read). The old fetch-each-row-by-ID path (a workaround for the MCP's schema-only `notion-fetch` + the 25-cap search) is retired; the snapshot table now serves only as that cache fallback + a human view.

**Setup (one-time, manual):** create a Notion internal integration at notion.so/my-integrations, share it to the Progress Tracker DB (`...` → Connections → add the integration), and save its secret to `work/01-sprint-tracker/config/notion-token.txt`. Until this exists the core runs in cache mode.

Each run also creates one **standup page** under the Personal Ops System parent page, titled `Standup YYYY-MM-DD`, with the full summary as content.

## Vault Structure
- **Tier 1:** `vault/projects/sprint-tracker/status.md` - DB IDs, schema, current board snapshot, last run.
- **Tier 2:** `vault/projects/sprint-tracker/standups/YYYY-MM-DD.md` - one standup per run.
- **Tier 2:** `vault/projects/sprint-tracker/velocity.md` - append-only counts table, one row per run; velocity split into shipped vs reconciled.
- **Machine state (core-owned, 2026-07-10):** `board-state.json` (the Since/status ledger, replaces the hand-maintained page-ID snapshot as the diff source), `last-run.json` (the computed summary the prose pass reads instead of re-querying Notion), `decisions-pending.md` (stale rows the morning brief surfaces as keep/drop). `status-history.md` holds the archived per-day narrative; status.md keeps only the rolling summary + the current snapshot table.

## Vault Reads
- soul.md (voice + priority filtering: rent-moving work first, job pipeline > modeling)
- vault/projects/sprint-tracker/status.md (IDs + previous snapshot)
- vault/projects/{name}/status.md of any automation on the board (for "what's blocking" context)

## Run Checks (every standup, before writing output)

**All three are implemented deterministically in `scripts/sprint-tracker-core.js` (zero tokens), not in prose.** The core reads `board-state.json` (the Since/status ledger) as the previous state and diffs the live board against it. Velocity is reported as an honest split: **shipped** (rows that transitioned into Done from a non-Done status = real work) vs **reconciled** (rows created straight to Done = backfill); the HQ tile shows `shipped` in live mode. The prose pass only narrates what the core computed.

1. **Missed-run detection.** Compare today's date against the last row in velocity.md. If one or more weekdays were skipped, the standup MUST open with "Missed N run(s) since YYYY-MM-DD" and the velocity row gets a note `(covers N missed days)`. Never silently absorb a gap; a dead schedule must be visible in the first standup after it dies. If the gap is 3+ weekdays, also suggest checking `schtasks /query /fo csv | findstr PersonalOS` and `outputs/logs/sprint-tracker.log`.
2. **Contract enforcement.** Cross-check the Routing Table in the project root CLAUDE.md against board rows. Every automation in the table must have a row on the board. If one is missing, create the row (Status per its actual state, Project select, next Order number, content body) and flag it in the standup as a contract violation by /new.
3. **Stale-task flagging.** The snapshot table in status.md carries a `Since` date per row (when the current Status was first observed). On status change, reset Since to today. Any row sitting In Progress, Next, or Blocked for 5+ weekdays gets called out in the standup with its age and, if known from vault project pages, what it's waiting on.

## Vault Writes
- **Core (deterministic, every run):** append row to velocity.md (with the shipped/reconciled split + missed-day note), refresh the board-state.json ledger (Since reset on status change), write last-run.json + decisions-pending.md, push HQ green.
- **Prose pass (optional):** new standup file in standups/, refresh the status.md rolling summary, vault/log.md entry; vault/index.md if new pages. It does NOT touch velocity.md, the ledger, or the HQ push (the core owns those).

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
7. **Alex HQ metrics push** (build #16 contract) is done by the **core** (`sprint-tracker-core.js`, both `velocity` + `run_status` in one POST, token read from `work/16-alex-hq/config/alex-hq-token.txt`, never logged). The prose pass must NOT re-push. On an interactive `/sprint-tracker` (no wrapper), run the core first (`node scripts/sprint-tracker-core.js`) so the push happens, then narrate.

## Close-Out Extras (Close-Out Gate)
Beyond the universal gate ([[research/alex-close-out-gate]]), this run is not COMPLETE until:
- `vault/projects/sprint-tracker/velocity.md` has a new row for this run (with the `(covers N missed days)` note when a gap was detected).

## Scheduled Wrapper (rebuilt 2026-07-10: deterministic-core-first)
- **scripts/run-sprint-tracker.ps1** runs the zero-token **core FIRST** (`node scripts/sprint-tracker-core.js`), which is the must-succeed part: it computes and writes the numbers and pushes `sprint/velocity` + `sprint/run_status` GREEN to Alex HQ with NO Claude tokens. A 9:00 quota/auth blackout can therefore no longer make the tracker dark - the exact failure class behind the 06-26/29/30 and 07-06 incidents is designed out. If the CORE fails (Notion API error, bug), that's a real failure: the shared `Invoke-CloseOutCheck` (`scripts/lib/close-out.ps1`) logs `FAILED`, pushes `sprint/run_status` RED, schedules the retry, and exits 1.
- **Then the Claude prose pass** (`claude -p "Run /sprint-tracker --prose-only"`) runs SECOND and is OPTIONAL: it reads `last-run.json` and writes the standup narrative + "one thing" lever + the Notion standup page. If it dies on the cap/login, the run is logged **PARTIAL** (numbers written, HQ already green) and the wrapper still exits 0 - degraded, never dark.
- Testable: `-ClaudeCmd {stub}` swaps the claude binary; `-DryRun` runs the core with `--dry-run` (no writes/no push) and skips the prose pass. Verified 2026-07-10: dry-run exits 0 with correct counts; a forced core failure exits 1 + RED (dry-run push logged).
- **Retry (corrected 2026-07-06):** the 2026-07-02 RestartCount 4 / 90min ladder on `PersonalOS-sprint-tracker` was proven a no-op for this failure class - Task Scheduler only restarts on LAUNCH failures, never on a wrapper that runs and exits 1 (the 07-06 quad failure: four exit-1 limit fails, zero restarts). The working retry now lives in the shared lib: on failure `Invoke-CloseOutCheck` registers a one-shot task `PersonalOS-retry-run-sprint-tracker-{n}` (+90 min, attempts 2-5, auto-deletes), so a 9:00 quota fail still self-retries at ~10:30/12:00/13:30/15:00 past the 1pm reset. The task settings stay (they cover launch failures). Login failure still needs a human (`claude /login`), but every failed attempt lands RED on the HQ health board, so it can never be silently dark again.

## Implementation Notes (as built, 2026-06-10)
- First run executed manually during build. Board had 7 seeded rows; "Sprint Tracker" row added as row 8 (Status Done, Project Personal Ops System, Order 0 so it tops the Build Order view as shipped infrastructure).
- Velocity baseline started at 1 Done (this automation). Counts: Done 1, In Progress 1, Next 1, Planned 5, Blocked 0.
- Standup voice: Alex (soul.md). Lead with the single highest-leverage item, then counts, then stalls. No corporate standup-speak.
Ye
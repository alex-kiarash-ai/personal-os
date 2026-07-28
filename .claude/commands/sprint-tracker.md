# /sprint-tracker - Daily Standup from the Progress Board

Spec: work/01-sprint-tracker/CLAUDE.md (read it first). Voice: Alex (soul.md) - lead with the single highest-leverage item, no corporate standup-speak.

> **STATE: #01 is PARKED (Shaheen 2026-07-16, until re-enabled). `PersonalOS-sprint-tracker` is Disabled
> in Task Scheduler.** And the numbers below come from a LOCAL CACHED SNAPSHOT, not a live board:
> cache mode is the **accepted design since 2026-07-18** (the Notion integration token was never
> restored), not a degraded fallback. **Say so in the standup.** Velocity derived from a board nobody has
> read live since 07-16 must not be presented with the confidence of board-derived velocity; the standing
> rule is to flag every unverified value. The 2026-07-14 deep-audit already found this once (DRIFT-1:
> "the velocity split is 'unavailable' in cache mode, so the '+1 = a real ship' line is human-asserted,
> not board-computed"); this file simply never absorbed the answer.

**Architecture (2026-07-10): the numbers are computed by the zero-token core; this command only NARRATES them.** Do not re-query the board, recompute velocity, re-append velocity.md, or re-push HQ - the core owns all of that.

## Steps
1. **Run the core** (skip only if invoked as `--prose-only`, i.e. the scheduled wrapper already ran it):
   `node scripts/sprint-tracker-core.js`
   It reads the board (paginated Notion REST via the integration token where one exists; **in practice it runs from the local cached snapshot, which has been the accepted mode since 2026-07-18**), computes counts / velocity (shipped vs reconciled) / stale / missed-run / contract, writes velocity.md + board-state.json + last-run.json + decisions-pending.md, and pushes `sprint/velocity` + `run_status` green to Alex HQ.
2. **Read `vault/projects/sprint-tracker/last-run.json`** - the computed summary: `counts`, `velocity` (delta, shipped, reconciled), `missed_runs`, `stale[]`, `contract_missing[]`.
3. **Write the standup** `vault/projects/sprint-tracker/standups/YYYY-MM-DD.md` (Alex voice, [[wiki links]]):
   - Open with a missed-run warning if `missed_runs > 0`.
   - **The one thing:** the single highest-leverage lever, priority-filtered by soul.md (Job Pipeline > learning > Modeling). Pull blocker context from `vault/projects/{name}/status.md`.
   - **Board:** counts + the honest velocity (shipped vs reconciled, not the raw Done delta). **State the source:** if the core ran from cache, say the numbers are cache-derived and give the snapshot date. Never present cache-derived velocity as board-derived.
   - **Stale (5+ wd):** from `stale[]`, each with what it waits on.
   - **Contract:** if `contract_missing[]` is non-empty, flag it as a /new step-5 miss; else "clean".
4. **Create the Notion standup page** "Standup YYYY-MM-DD" under the Personal Ops System parent (ID in vault/projects/notion-parent-id.md), same content.
5. **Refresh the status.md rolling summary** (top 2-3 update blocks + last_run). The long narrative lives in `status-history.md`; the machine snapshot lives in `board-state.json`. Do NOT re-append velocity or re-push HQ.

## Post-Run
- vault/log.md entry: `## [YYYY-MM-DD HH:MM] sprint-tracker | standup narrated, velocity shipped {n}`.
- vault/index.md only if new page types were created.
- Do NOT change row statuses on the board; the tracker reports, automations self-report Done via /new.
- The HQ push, the velocity row, and decisions-pending.md are already done by the core. This pass adds narrative only.

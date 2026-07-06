# /sprint-tracker - Daily Standup from the Progress Board

Spec: work/01-sprint-tracker/CLAUDE.md (read it first).

## Steps
1. Read vault/projects/sprint-tracker/status.md for DB IDs and the previous board snapshot.
2. Read the live board. notion-fetch on the DB returns schema only, not rows; read rows via notion-search scoped to the Progress Tracker, or fetch known page IDs. Compare against the previous snapshot to detect status changes.
3. Build the standup:
   - Counts per status: Done, In Progress, Next, Planned, Blocked.
   - What changed since last run (rows that moved).
   - Velocity: Done count delta vs previous run, appended to vault/projects/sprint-tracker/velocity.md.
   - One "today's lever" line, priority-filtered by soul.md (priority order: Job Pipeline > Modeling > STEMPLICITY).
4. Write vault/projects/sprint-tracker/standups/YYYY-MM-DD.md (Alex voice, [[wiki links]]).
5. Create a Notion page "Standup YYYY-MM-DD" under the Personal OS parent page (ID in vault/projects/notion-parent-id.md) with the same content.
6. Refresh the snapshot + last_run in vault/projects/sprint-tracker/status.md.

## Post-Run
- vault/log.md entry: `## [YYYY-MM-DD HH:MM] sprint-tracker | standup generated, velocity {n}`.
- vault/index.md only if new page types were created.
- Do NOT change row statuses on the board; the tracker reports, automations self-report Done via /new.
- **Alex HQ metrics push** (build #16 contract, work/16-alex-hq/CLAUDE.md). Push BOTH events in one call: `velocity` feeds the weekly tile; `run_status` green clears any red left by the scheduled wrapper (scripts/run-sprint-tracker.ps1 pushes run_status red on a dead run). Never let a push failure fail the run; never print or log the token:
  `curl -s -m 10 -X POST https://n8n.shaheenkiarash.com/webhook/alex-push -H "Content-Type: application/json" -H "X-Alex-Token: $(cat work/16-alex-hq/config/alex-hq-token.txt)" -d '[{"project":"sprint","metric_key":"velocity","value_num":{velocity},"headline":"Done {done} of {total} · velocity +{n}","status":"{amber if the standup opens with missed runs, else green}"},{"project":"sprint","metric_key":"run_status","value_num":1,"headline":"run clean {YYYY-MM-DD}","status":"green"}]' || true`

# /personal-crm - Personal CRM Sync + Monday Follow-Ups

Spec: work/05-personal-crm/CLAUDE.md (read it first; the Draft Gate is non-negotiable).

## Modes
- `/personal-crm` — full run: sync contacts, enrich, score, build follow-up list, stage eligible drafts.
- `/personal-crm sync` — DB sync only, no follow-up list, no drafts.

## Steps
1. Read vault/projects/personal-crm/status.md for DB IDs and the row→pageID map. Read soul.md (email voice) and vault/me/goals.md (score weighting).
2. **Sync.** Read every vault/people/*.md (skip _example-contact). Upsert each into the Personal CRM DB, matching by Name via the pageID map to avoid duplicates. Update score/status/tags/notes.
3. **Enrich (timeboxed).** Gmail search_threads + Calendar list_events, last 90 days, to fill missing emails and real Last Contact dates, and to find new contacts worth tracking. New people → new DB row + vault/people/ page. Leave fields blank if nothing surfaces; do not dig.
4. **Follow-up list.** Select rows due this week (Follow-Up Date on-or-before end of this week) OR Warm/Active rows past their cadence. Write to status.md + a new history snapshot.
5. **Draft gate (HARD).** Draft ONLY if ALL: real email on file · Status Active/Warm · NOT tagged personal/family · NOT tagged do-not-contact/sensitive. Draft in soul.md voice via Gmail `gmail_create_draft` (NEVER Chrome, NEVER auto-send). Log each draft. Anyone who fails a gate but would be a good follow-up goes in the list as "needs your call" with the reason.

## Notion
- DB: Personal CRM (id in status.md). Read rows by page ID; notion-search only to discover rows not in the map.
- Always write full readable context to each row's page content, not just properties.

## Post-Run
- New people → vault/people/, new companies → vault/business/, with [[wiki links]].
- Update status.md (snapshot, drafts staged, last_run) + new history file.
- vault/log.md: `## [YYYY-MM-DD HH:MM] personal-crm | synced N, follow-ups M, drafts D`.
- vault/index.md only if new page types.
- Do NOT mark the sprint row again (Done at build).
- **Alex HQ metrics push** (build #16 contract, work/16-alex-hq/CLAUDE.md). Never let a push failure fail the run; never print or log the token:
  `curl -s -m 10 -X POST https://n8n.shaheenkiarash.com/webhook/alex-push -H "Content-Type: application/json" -H "X-Alex-Token: $(cat work/16-alex-hq/config/alex-hq-token.txt)" -d '{"project":"crm","metric_key":"followups_due","value_num":{due this week},"headline":"{2-3 sample names}","status":"{amber if any follow-up overdue >1 week, else green}"}' || true`

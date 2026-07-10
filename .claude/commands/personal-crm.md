# /personal-crm - Personal CRM Sync + Monday Follow-Ups

Spec: work/05-personal-crm/CLAUDE.md (read it first; the Draft Gate is non-negotiable).

## Modes
- `/personal-crm` - full run: sync contacts, enrich, score, build follow-up list, stage eligible drafts.
- `/personal-crm sync` - DB sync only, no follow-up list, no drafts.

## Steps
1. Read vault/projects/personal-crm/status.md for DB IDs and the row→pageID map. Read soul.md (email voice) and vault/me/goals.md (score weighting).
1b. **HQ inbox check + phone actions (Inbox Contract, work/16-alex-hq/CLAUDE.md).** GET `/webhook/alex-inbox` with the X-Alex-Token header (token work/16-alex-hq/config/alex-hq-token.txt, never printed). `count_new` 0 or unreachable → continue, never fail the run. For any note matching a CRM contact, run the verb grammar: `send <name>` (send the existing staged, gate-passed draft on that thread - the only mail-dispatching action, never auto-composes), `close <name>` (Status→Cold, drop from follow-ups), `snooze <name> to <date>` (set Follow-Up Date), `draft <name>` (stage a fresh nudge only if it passes the hard gate). Execute, then POST `/webhook/alex-inbox-mark` with `filed_to: "crm/<action>"` + the required `note`. Voice notes: scp + local Whisper transcribe per the contract, then delete audio both ends. Report "HQ notes: N filed → actions".
2. **Sync.** Read every vault/people/*.md (skip _example-contact). Upsert each into the Personal CRM DB, matching by Name via the pageID map to avoid duplicates. Update status/tags/notes/email.
3. **Enrich (thin backfill).** #07 email-triage already writes Last Contact + Email on every sweep, so this is a backfill for contacts #07 never sees (Calendar-only attendees, LinkedIn-only names). Gmail search_threads + Calendar list_events, last 90 days, to fill a missing email or real Last Contact date and find new contacts. New people → new DB row + vault/people/ page. Leave blank if nothing surfaces; do not dig.
4. **Deterministic score + cadence.** For each row compute + store **Days Since Contact** (today − Last Contact) and **Msgs 90d** (Gmail thread count last 90d). Map to a base band 0-6; add a goal-importance overlay 0-4 from goals.md (job-hunt + Alex-product + active-interview weigh up); **Relationship Score = base + overlay** (1-10), write the one-line **Score Basis**. Set **Cadence Days** by Status (Active 14, Warm 30, New/prospect-in-job-hunt 7, Cold none; active-interview override 7). If Follow-Up Date is empty, auto-set it = Last Contact + Cadence Days.
5. **Follow-up list.** Select rows due this week (Follow-Up Date on-or-before end of this week) OR Active/Warm rows past cadence (Days Since Contact > Cadence Days). Write to status.md + a new history snapshot.
6. **Draft gate (HARD).** Draft ONLY if ALL: real email on file · Status Active/Warm · NOT tagged personal/family · NOT tagged layoff (the do-not-contact/sensitive set). **Refresh-in-place:** `list_drafts` the thread first; if an unsent Alex draft exists, delete the stale one(s) and stage ONE current draft, never a duplicate. Draft in soul.md voice via Gmail `gmail_create_draft` (NEVER Chrome, NEVER auto-send). A staged draft >14d unsent → surface as an HQ "send/bin" decision card, stop re-staging. Log each draft. Anyone who fails a gate but would be a good follow-up goes in the list as "needs your call" with the reason.

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

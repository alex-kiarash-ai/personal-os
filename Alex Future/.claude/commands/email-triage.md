# /email-triage - Classify Inbox + Draft Replies in Shaheen's Voice

Spec: work/07-email-triage/CLAUDE.md (read it first; privacy rule + draft gate are non-negotiable).

## Modes
- `/email-triage` - interactive (default).
- `/email-triage scheduled` - batch to outputs/ (used by the 9/13/17 schedule).

## Steps
1. Read vault/projects/email-triage/status.md (DB IDs), soul.md + vault/me/writing-style-notes.md (voice), vault/projects/personal-crm/status.md (CRM IDs + gate).
1b. **HQ inbox check (two-way notes, build #16; full runbook = work/16-alex-hq/CLAUDE.md "Inbox Contract").** GET `/webhook/alex-inbox` with the X-Alex-Token header (token file work/16-alex-hq/config/alex-hq-token.txt, never printed). `count_new` 0 or unreachable → continue, never fail the run. Voice notes: scp the audio from n8n:/opt/alex-inbox-audio/, transcribe with local Whisper, transcript = note text. File each note per the standing vault protocols (event → Calendar, person → People Intake, goal → me/, etc.), then POST `/webhook/alex-inbox-mark` with `{"marks":[{"id":N,"filed_to":"...","note":"<final text - REQUIRED>"}]}`; delete the remote+local audio after a voice mark. Report "HQ notes: N filed → destinations" in the run output.
2. Pull unread email (Gmail search_threads, ~last 24h). Classify each: **Act Now / Read Later / Archive** (rules in spec; recruiter/client/prospect = Act Now while job-hunt + STEMPLICITY are live).
3. For each sender, look up the CRM (notion-search) + vault/people/ for context. Unknown senders that matter → new CRM row (Status New) + a one-line vault/people/ page. **Intel only - never paste the email body into the vault.**
4. For Act Now items needing a reply, draft in voice (soul.md + writing-style-notes). Respect the CRM draft gate (no personal/family, no do-not-contact/sensitive contacts; newsletters/no-reply = Archive, never drafted).
5. **Interactive:** show one at a time (classification + sender context + draft). Approve → gmail_create_draft. Edit → stage the edit AND append the change pattern to vault/me/writing-style-notes.md (create if missing). Skip → Draft Status Skipped.
   **Scheduled:** write all proposed drafts to `outputs/email-triage/YYYY-MM-DD/HHMM-drafts.md`; Draft Status Pending. Never stage to Gmail without a human.
6. Log every email to the Email Triage board (Subject, Sender, Classification, Draft Status, Date; intelligence in page content, NOT raw body).

## Post-Run
- New senders → vault/people/ (intel only) + CRM rows. New companies → vault/business/.
- writing-style-notes.md updated on any edit.
- email-triage/status.md (counts, last run, pending pointer) + history snapshot (counts only) + vault/index.md (new pages) + vault/log.md.
- Do NOT re-mark the sprint row (Done at build).
- **Alex HQ metrics push** (build #16 contract, work/16-alex-hq/CLAUDE.md). Never let a push failure fail the run; never print or log the token:
  `curl -s -m 10 -X POST https://n8n.shaheenkiarash.com/webhook/alex-push -H "Content-Type: application/json" -H "X-Alex-Token: $(cat work/16-alex-hq/config/alex-hq-token.txt)" -d '{"project":"email-triage","metric_key":"act_now","value_num":{act now count},"headline":"run {N}: {act} act now, {read} read later","status":"{amber if act_now > 0, else green}"}' || true`

# /email-triage - Sort + Classify Inbox + Draft Replies in Shaheen's Voice

Spec: work/07-email-triage/CLAUDE.md (read it first; privacy rule + draft gate are non-negotiable). Categorization, dedup, learning, noise-killer and job-loop details all live there.

## Modes
- `/email-triage` - interactive (default): review drafts one at a time.
- `/email-triage scheduled` - headless (the 9/13/17 schedule): stages every gated reply straight into Gmail as an unsent, threaded draft. Never sends. No outputs/ file.
- `/email-triage backfill` - one-time: sweep the WHOLE current inbox into topic buckets (label + archive, read and unread). Run once.

## Steps
1. Read vault/projects/email-triage/status.md (DB IDs + label id map), work/07-email-triage/config/sender-rules.json (deterministic gate), soul.md + vault/me/writing-style-notes.md (voice), vault/projects/personal-crm/status.md (CRM IDs + gate).
1b. **HQ inbox check (two-way notes, build #16; runbook = work/16-alex-hq/CLAUDE.md "Inbox Contract").** GET `/webhook/alex-inbox` with the X-Alex-Token header (token file work/16-alex-hq/config/alex-hq-token.txt, never printed). `count_new` 0 or unreachable → continue, never fail the run. Voice notes: scp audio from n8n:/opt/alex-inbox-audio/, transcribe with local Whisper, file per the vault protocols, POST `/webhook/alex-inbox-mark`, delete audio both ends. Report "HQ notes: N filed → destinations".
2. **Pull new mail (label dedup, not timestamp):** `search_threads("in:inbox -label:alex/triaged")`. That is the only "new" query - no boundary math. (Backfill mode instead pages `search_threads("in:inbox")` - everything.)
3. **Categorize - deterministic gate FIRST, LLM only for the rest:**
   - Apply `sender-rules.json` (first match wins) → matched threads get their topic label with **zero reasoning**.
   - Unmatched threads → classify topic (Finance/Travel/Work/Social-Archive/Job Applications/AI & Learning/Airbnb/Promotions) + triage class (Act Now/Read Later/Archive). Topic is orthogonal to triage class - keep both. Note recurring unmatched senders as sender-rule candidates.
   - `label_thread(threadId, [topicLabelId, "Label_11"])` - apply topic + `alex/triaged`. Keep INBOX (stays in inbox while unread).
4. **Sender context + CRM enrichment:** notion-search + vault/people/ for each real sender. Unknown senders that matter → new CRM row (Status New) + one-line vault/people/ page. For senders that MATCH an existing CRM row, enrich it: set **Last Contact** = the message date when newer, fill **Email** if it was blank. **Intel/enrichment only** - never score, never set cadence, never draft CRM follow-ups (that is #05's Monday job), never the email body.
5. **Draft gated Act Now replies (voice: soul.md + writing-style-notes):**
   - **Interactive:** show one at a time (class + context + draft). Approve → create_draft. Edit → stage it AND append the pattern to writing-style-notes.md. Skip → Skipped.
   - **Scheduled:** create_draft with `replyToMessageId` = latest message id in the thread → unsent, threaded Gmail draft. Skip threads that already have an unsent Alex draft (`list_drafts`). NEVER send. Draft Status = Pending. **No outputs/ file.**
   - On every stage, snapshot `{threadId, staged_body, ts}` to `state/staged-drafts.json` (for the learning loop).
6. **Read-sweep (archive on read):** `search_threads("in:inbox is:read label:alex/triaged")` → `unlabel_thread(threadId, ["INBOX"])` so read mail files into its bucket. Inbox stays = unread only. (Backfill: archive ALL, read or unread.)
7. **Sent-sweep (learning loop):** `search_threads("in:sent newer_than:3d")` → match by threadId to state/staged-drafts.json → diff staged vs actually-sent → if changed, append the *pattern* (not the email) to writing-style-notes.md. Prune matched + >7d ledger entries.
8. **Noise tally (idea 4):** increment state/sender-tally.json for each Archive/Promotions sender. Any sender ≥ suppress_threshold (5) → add to a **suppression candidate list** in the run output (+ morning brief). Never auto-unsubscribe - surface for Shaheen's one-tap yes; on approval, add to sender-rules.json + suppress inbox delivery.
9. **Job-loop (idea 5):** recruiter reply / interview invite (CRM score over threshold, or job-domain + interview keywords) → 🎯 Job Applications + escalate: flag Act Now, push to HQ, note for #21 interview-copilot. Track awaiting-reply recruiter threads in state/job-threads.json; > N days unanswered → "going stale" nudge for the morning brief.
10. **Log to Notion:** one Email Triage row per thread (Subject, Sender, Classification, Draft Status, Date; intelligence in page content, NOT raw body). Group Archive noise.

## Post-Run
- New senders → vault/people/ (intel only) + CRM rows. New companies → vault/business/.
- writing-style-notes.md updated on any interactive edit OR sent-sweep diff.
- email-triage/status.md (counts, last run, categories, label map) + history snapshot (counts only) + vault/index.md (new pages) + vault/log.md.
- Do NOT re-mark the sprint row (Done at build).
- **Alex HQ metrics push** (build #16 contract). Push `act_now` AND a GREEN `run_status` (green clears any stale red from a prior failed run). Never let a push failure fail the run; never print or log the token:
  `curl -s -m 10 -X POST https://n8n.shaheenkiarash.com/webhook/alex-push -H "Content-Type: application/json" -H "X-Alex-Token: $(cat work/16-alex-hq/config/alex-hq-token.txt)" -d '{"events":[{"project":"email-triage","metric_key":"act_now","value_num":{act now count},"headline":"run {N}: {act} act now, {read} read later","status":"{amber if act_now > 0, else green}"},{"project":"email-triage","metric_key":"run_status","value_num":0,"headline":"clean run {N}","status":"green"}]}' || true`

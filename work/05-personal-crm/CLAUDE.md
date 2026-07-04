# Personal CRM

## Type
Automation (scheduled weekly + on-demand)

## Purpose
A personal relationship manager backed by a Notion "Personal CRM" database. It keeps one row per real contact (sourced from vault/people/, Gmail senders, and Calendar attendees), tracks last-contact and follow-up dates, scores each relationship, and every Monday produces a follow-up list. For the subset of contacts that are appropriate to nudge, it drafts a follow-up email in Shaheen's voice (soul.md) and stages it as a Gmail draft. It never sends, never drafts to off-limits contacts, and never invents an email address.

## Entry Points
- **Scheduled:** Monday 8:30 AM via Task Scheduler (`PersonalOS-personal-crm` → scripts/run-personal-crm.ps1 → `claude -p "Run /personal-crm"`).
- **On-demand:** `/personal-crm` (full sync + follow-up list), `/personal-crm sync` (DB sync only, no drafts).

## Tools Used
- Notion MCP: notion-create-pages / notion-update-page (CRM rows), notion-fetch (read rows by page ID).
- Gmail MCP: search_threads (find last-contact date + email addresses by name), gmail_create_draft (stage follow-up drafts). NEVER Chrome for Gmail.
- Google Calendar MCP: list_events (attendees as contact + l1
- **Relationship Score** (number, 1-10)
- **Status** (select: Active, Warm, Cold, New)
- **Tags** (multi-select: hr, recruiter, family, personal, job-hunt, prospect, do-not-contact, data-gap)
- **Notes** (text)

Views:
- **All Contacts** (table, sort by Relationship Score desc)
- **Follow-Up This Week** (table, filter Follow-Up Date on-or-before end of current week)
- **By Company** (board, group by Company)

Every row carries full readable context in the page **content**, not just properties.

## The Runtime Flow (per run)
1. **Sync contacts.** Read every vault/people/*.md (skip _example-contact). For each, upsert a CRM row: name, company, role, email (if known), tags, a relationship score, a status, and Notes. Match existing rows by Name (page IDs cached in status.md) to avoid duplicates.
2. **Enrich.** Pull recent Gmail senders + Calendar attendees (last 90 days). If a known contact's email or a real last-contact date surfaces, fill it. New people worth tracking get a new row + a vault/people/ page (post-run ingestion). Timebox: if enrichment turns up nothing for a contact, leave the field blank, don't dig.
3. **Score + status.** Relationship Score 1-10 (frequency + recency + importance to current goals; job-hunt and venture contacts weigh up). Status: Active (ongoing exchange), Warm (real but quiet), Cold (fading/closed), New (just appeared, unqualified).
4. **Follow-up list.** Select rows whose Follow-Up Date is due this week, OR Warm/Active rows gone quiet past their cadence. Write the list to status.md and the Monday section.
5. **Draft gate (HARD RULES — see below).** For each eligible follow-up, draft an email in soul.md voice and stage via gmail_create_draft. Log every draft in status.md. NEVER auto-send.

## Draft Gate (non-negotiable)
A contact is drafted to ONLY IF all are true:
- Has a real email address on file (never guess or construct one).
- Status is Active or Warm (never Cold, never New/unqualified).
- Tags do NOT include `personal` or `family`.
- Is NOT tagged `do-not-contact` (sensitive relationships where an automated nudge would be wrong). Reconnecting there is a human decision, not an automated nudge.
- Drafting is the ceiling. The draft sits in Gmail for Shaheen to read, edit, and send or bin. The brief always says how many drafts were staged and to whom.
If a contact would be a useful follow-up but fails a gate (e.g. no email), list them in the follow-up list as "needs your call" with the reason, and draft nothing.

## Vault Structure
- **Tier 1:** vault/projects/personal-crm/status.md — DB IDs, row→pageID map, last run, current follow-up list, drafts staged.
- **Tier 2:** vault/projects/personal-crm/history/YYYY-MM-DD.md — one snapshot per run (follow-up list + drafts that week).

## Vault Reads
- soul.md (email voice — terse, systems-led, no AI slop, no em-dashes).
- vault/people/ (the contact source of truth).
- vault/meetings/ (last-met context). NOTE: not built yet — skip gracefully if absent.
- vault/me/goals.md (to weight scores toward job-hunt + STEMPLICITY goals).
- vault/business/ (company context for the Company select).

## Vault Writes
- Upsert vault/people/ pages for new contacts found in Gmail/Calendar.
- vault/business/ for new companies.
- status.md refresh + new history snapshot.
- vault/index.md (new pages), vault/log.md (every run).

## Connections
- **Fed by:** Morning Brief (enriches vault/people/), Calendar, Gmail.
- **Feeds into:** Morning Brief (follow-up reminders), future Email Triage. Reports Done to the sprint board.

## Post-Run (mandatory)
1. vault/people/ pages for new contacts.
2. vault/business/ pages for new companies.
3. [[wiki links]] between CRM status, people, business.
4. Notion rows updated.
5. vault/index.md updated.
6. vault/log.md updated.
7. Sprint board: marked Done on first build (2026-06-11).
- Alex HQ metrics push (added 2026-07-02): POST the run's key metric(s) to the build #16 ingest webhook per the contract in work/16-alex-hq/CLAUDE.md; exact curl in .claude/commands/personal-crm.md. Failure-tolerant, token never printed.

## Close-Out Extras (Close-Out Gate)
Beyond the universal gate ([[research/alex-close-out-gate]]), this run is not COMPLETE until:
- The Notion CRM DB relationship scores are refreshed and the Monday follow-up list is produced (drafts stay behind the hard gate, never sent).

## Implementation Notes (as built, 2026-06-11)
- DB created and seeded with the 9 real vault/people contacts. IDs in status.md.
- **No emails on file for any seeded contact, and the only Warm contacts are in do-not-draft categories.** So the Monday drafter has zero eligible targets at build time — correct and expected, not a bug. It starts drafting once real professional contacts with emails enter the vault (via Morning Brief / job hunt).
- Draft gate enforced in spec before any email logic runs. Contacts tagged `personal` and `do-not-contact` are explicitly excluded from drafting.

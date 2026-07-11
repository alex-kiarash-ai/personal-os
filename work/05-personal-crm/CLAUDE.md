# Personal CRM

## Type
Automation (scheduled weekly + on-demand)

## Purpose
A personal relationship manager backed by a Notion "Personal CRM" database. It keeps one row per real contact (sourced from vault/people/, Gmail senders, and Calendar attendees), tracks last-contact and follow-up dates, scores each relationship, and every Monday produces a follow-up list. For the subset of contacts that are appropriate to nudge, it drafts a follow-up email in Shaheen's voice (soul.md) and stages it as a Gmail draft. It never sends, never drafts to off-limits contacts, and never invents an email address.

## Entry Points
- **Scheduled:** Monday 8:30 AM via Task Scheduler (`PersonalOS-personal-crm` → scripts/run-personal-crm.ps1 → `claude -p "Run /personal-crm"`).
- **On-demand:** `/personal-crm` (full sync + follow-up list), `/personal-crm sync` (DB sync only, no drafts).

## Tools Used
- Notion MCP: notion-create-pages / notion-update-page (CRM rows), notion-fetch (read rows by page ID), notion-update-data-source (schema).
- Gmail MCP: search_threads (last-contact date, 90-day message counts, email addresses by name), list_drafts (draft dedup), gmail_create_draft (stage follow-up drafts). NEVER Chrome for Gmail.
- Google Calendar MCP: list_events (attendees as contact + last-met context, 90-day sweep).
- Skills: crm-cleanup + crm-maintenance (advisory, 2026-07-11) - run their hygiene checklists (dupes, stale records, missing fields) against vault/people + the Notion CRM during the Monday sweep, before drafting follow-ups. They are HubSpot-written; apply the method, not the tool calls.

## Notion Integration
**Personal CRM** database under the Personal OS parent page. db_id `0da7196d-f52b-435b-8692-76dd75a0dc24`, data_source `746bc5bf-8ab3-4e34-911d-00b9d180e350`. Properties (live schema, verified 2026-07-10):
- **Name** (title)
- **Company** (select: UC AB, Finansförbundet, FFA, LinkedIn, Family, Flow Studio, Other)
- **Role** (text)
- **Email** (email) - never guessed or constructed
- **Last Contact** (date)
- **Follow-Up Date** (date)
- **Relationship Score** (number, 1-10)
- **Status** (select: Active, Warm, Cold, New)
- **Tags** (multi-select: layoff, hr, union, insurance, recruiter, family, personal, job-hunt, prospect, data-gap)
- **Notes** (text)
- **Days Since Contact** (number) - today minus Last Contact, computed + stored each run (deterministic scoring, added 2026-07-10).
- **Msgs 90d** (number) - Gmail thread message count over the last 90 days.
- **Cadence Days** (number) - target silence window before a nudge, defaulted by Status (see step 3).
- **Score Basis** (text) - one-line audit of how the score was formed, so a score is explainable run-to-run.

**Tag note:** the DB has no literal `do-not-contact` tag. The never-draft set is keyed off `layoff` (layoff counterparties), `personal`, and `family`; "do-not-contact" is the conceptual umbrella used in the Draft Gate below, not a literal option.

Views:
- **All Contacts** (table, sort by Relationship Score desc)
- **Follow-Up This Week** (table, Follow-Up Date is-not-empty AND Status is-not Cold, soonest first; the real "due this week" cut is applied at runtime).
- **By Company** (board, group by Company)

Every row carries full readable context in the page **content**, not just properties.

## The Runtime Flow (per run)
1. **Sync contacts.** Read every vault/people/*.md (skip _example-contact). For each, upsert a CRM row: name, company, role, email (if known), tags, **Channel** (from the `channel:` frontmatter, default `email` if an email is on file else `unknown`), **Last Contact** (from the `last_contact:` frontmatter, skip if `unknown`), a relationship score, a status, and Notes. Match existing rows by Name (page IDs cached in status.md) to avoid duplicates.
2. **Enrich (thin backfill since 2026-07-10).** Email Triage (#07) now writes Last Contact + Email onto CRM rows on every sweep (9/13/17), so most rows arrive already fresh. This step is a backfill for contacts #07 never sees: Calendar-only attendees and LinkedIn-only names. Pull Gmail senders + Calendar attendees (last 90 days); fill a missing email or a real last-contact date; new people worth tracking get a new row + a vault/people/ page (post-run ingestion). Timebox: turns up nothing, leave it blank, don't dig.
3. **Score + status (deterministic + channel-aware, since 2026-07-10).** Read each contact's **Channel** (from the people-page `channel:` frontmatter, synced to the Notion `Channel` field; email / whatsapp / linkedin / in-person / mixed / unknown) and branch:
   - **Email / mixed (the system can see them):** compute + store **Days Since Contact** (today minus Last Contact) and **Msgs 90d** (Gmail thread count last 90 days). Map to a base band 0-6 (recent + frequent = high, silent + rare = low).
   - **Non-email (whatsapp / linkedin / in-person - the system is BLIND to the channel):** there is NO reliable recency signal. `Msgs 90d` = N/A. `Days Since Contact` is computed from the `last_contact` frontmatter but is treated as **"last logged, unverified"**, never as proven silence; if `last_contact: unknown`, recency is a data-gap. The recency band is HELD/soft, not scored as if the silence is real (this is what stops the frozen-June dates reading as "gone quiet, 29 days").
   - The model adds only a **goal-importance overlay 0-4** from vault/me/goals.md (job-hunt + Alex-product + active-interview weigh up; on the personal side the dating thread + mother weigh up).
   - **Relationship Score = base + overlay** (clamp 1-10), written with a one-line **Score Basis** that names the channel + whether recency is verified (e.g. "email: base 4 [12d, 6 msgs] + overlay 3 [active recruiter] = 7" · "whatsapp: recency unverified [last logged 29d] + overlay 2 [close friend] = soft 5"). Same inputs give the same score across runs.
   - Status: Active (ongoing exchange), Warm (real but quiet), Cold (fading/closed), New (just appeared, unqualified).
   - **Cadence Days by channel, then status:**
     - *Email / professional:* Active 14, Warm 30, New/prospect while job-hunt is live 7, Cold none. Active-interview (Track 6) override 7.
     - *WhatsApp / personal + family:* a SOFT relationship-maintenance cadence, default 45. The goal-overlay tightens the few that matter (a dating contact ~14, a family member gentle-but-shorter ~30). NEVER the hard job-hunt cadence.
   - When a row has no explicit Follow-Up Date, auto-set Follow-Up Date = Last Contact + Cadence Days (skip when `last_contact` is unknown).
4. **Follow-up list.** Select rows due this week (Follow-Up Date on-or-before end of this week) OR rows past cadence (Days Since Contact > Cadence Days) that are Active/Warm. "Gone quiet past cadence" is now a computed comparison, not a weekly judgment call. **Non-email contacts get a GENTLE, reworded line** ("been a while since you logged contact with {name} (WhatsApp), ping them or tell me `talked {name}`"), never "gone quiet, reply", and never drafted (personal/family are gated out anyway). Write the list to status.md and the Monday section.
5. **Draft gate (HARD RULES - see below).** For each eligible follow-up, draft an email in soul.md voice and stage via gmail_create_draft. Log every draft in status.md. NEVER auto-send.

## Draft Gate (non-negotiable)
A contact is drafted to ONLY IF all are true:
- Has a real email address on file (never guess or construct one).
- Status is Active or Warm (never Cold, never New/unqualified).
- Tags do NOT include `personal` or `family`.
- Is NOT tagged `do-not-contact` (sensitive relationships where an automated nudge would be wrong). Reconnecting there is a human decision, not an automated nudge.
- Drafting is the ceiling. The draft sits in Gmail for Shaheen to read, edit, and send or bin. The brief always says how many drafts were staged and to whom.
If a contact would be a useful follow-up but fails a gate (e.g. no email), list them in the follow-up list as "needs your call" with the reason, and draft nothing.

### Draft lifecycle (since 2026-07-10, kills the pile-up)
The 4-stale-drafts-to-one-contact mess (07-06) is now real behavior, not a manual note:
- **Refresh-in-place.** Before staging a nudge, `list_drafts` for the thread. If an unsent Alex draft already exists there, DELETE the stale one(s) and stage a single current draft. Never a 2nd/5th draft on the same thread.
- **Auto-expire.** A staged draft older than N days (default 14) with no send is not silently kept: surface it as one HQ decision card ("send / bin") via the metrics push, and stop re-staging it until Shaheen acts.

## Phone Actions (two-way notes via Alex HQ, since 2026-07-10)
The Monday "needs your call" list used to stall until Shaheen was at the keyboard. Now he can action it from his phone through the Alex HQ note inbox (Inbox Contract in work/16-alex-hq/CLAUDE.md; notes are already read at every #05 run). At run start (command step 1b) the run GETs `/webhook/alex-inbox`, and for any note that matches a CRM contact it recognises a small verb grammar:
- **`send <name>`** - send the existing staged, gate-passed Gmail draft on that contact's thread. This is the ONLY action that dispatches mail, and it only ever sends a draft that was already staged and passed the hard gate and that Shaheen named by hand. It never auto-composes-and-sends.
- **`close <name>`** - set Status -> Cold, drop from the follow-up list.
- **`snooze <name> to <date>`** - set Follow-Up Date to that date.
- **`draft <name>`** - stage a fresh nudge IF it passes the hard gate (otherwise report why it can't).
- **`talked <name> [date]`** - set that contact's `last_contact` = today (or the given date) on BOTH the people-page frontmatter and the Notion row; optional `talked <name> whatsapp` also confirms/sets Channel. This is the human-as-sensor bridge for WhatsApp and other channels the system can't see: after messaging Nour, a 2-second note keeps the ledger fresh. Clears the "recency unverified" staleness for that contact.

Execute the action, then mark the note filed: POST `/webhook/alex-inbox-mark` with `filed_to: "crm/<action>"` and the required `note` field. Hard rules inherited from the contract: never print the token; an unreachable inbox is one line then continue, never fails the run; a note is filed, never deleted.

## Reliability SLA (since 2026-07-10)
The Monday run is a local `claude -p` job and CAN silently miss (the 07-06 usage-limit skip lost three weeks of drift). Two guards:
- The scheduled wrapper already routes through `Invoke-CloseOutCheck` (scripts/lib/close-out.ps1): a blocked/degraded run pushes RED `run_status` to HQ, and a clean run pushes GREEN so there is always a fresh timestamp to age against.
- **Staleness watch (external, zero-token):** the morning brief (#02) / recovery drift checker (#18) flags when this status.md `last_run` age exceeds **8 days** (one missed Monday + slack) and pushes AMBER/RED to HQ. A missed run can no longer go quiet for weeks.

## Vault Structure
- **Tier 1:** vault/projects/personal-crm/status.md - DB IDs, row→pageID map, last run, current follow-up list, drafts staged.
- **Tier 2:** vault/projects/personal-crm/history/YYYY-MM-DD.md - one snapshot per run (follow-up list + drafts that week).

## Vault Reads
- soul.md (email voice - terse, systems-led, no AI slop, no em-dashes).
- vault/people/ (the contact source of truth).
- vault/meetings/ (last-met context). NOTE: not built yet - skip gracefully if absent.
- vault/me/goals.md (to weight scores toward job-hunt + Alex-product goals).
- vault/business/ (company context for the Company select).

## Vault Writes
- Upsert vault/people/ pages for new contacts found in Gmail/Calendar.
- vault/business/ for new companies.
- status.md refresh + new history snapshot.
- vault/index.md (new pages), vault/log.md (every run).

## Connections
- **Fed by:** Morning Brief (enriches vault/people/), Calendar, Gmail. Email Triage (#07 - LIVE: continuously writes Last Contact + Email onto CRM rows on every sweep, so Monday is a scoring pass over fresh data, 2026-07-10). Interview Copilot (#21) - when a CRM recruiter enters an active interview, #05 overrides that contact's Cadence Days to 7 and bumps the goal-overlay so the follow-up engine prioritises the thread (Track 6). Alex HQ (#16) notes inbox - phone actions (send/close/snooze/draft), Inbox Contract.
- **Feeds into:** Morning Brief (follow-up reminders + staleness watch), Email Triage (#07 - supplies sender context + receives new senders; #07's job-loop cross-checks CRM last-contact to nudge stale recruiter threads, 2026-07-10 v2), Interview Copilot (#21 - recruiter contact context). Reports Done to the sprint board.

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
- **No emails on file for any seeded contact, and the only Warm contacts are in do-not-draft categories.** So the Monday drafter has zero eligible targets at build time - correct and expected, not a bug. It starts drafting once real professional contacts with emails enter the vault (via Morning Brief / job hunt).
- Draft gate enforced in spec before any email logic runs. Contacts tagged `personal` and `do-not-contact` are explicitly excluded from drafting.

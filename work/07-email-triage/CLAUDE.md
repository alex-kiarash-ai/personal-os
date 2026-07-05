# Email Triage

## Type
Automation (scheduled 3x daily + on-demand, two modes)

## Purpose
Keeps the inbox from owning Shaheen's attention. It pulls unread email, classifies each as **Act Now / Read Later / Archive**, pulls sender context from the Personal CRM, and for the ones that need a reply, drafts one in Shaheen's voice. Two modes: **interactive** (review drafts one at a time, approve/edit/skip, approved ones go to Gmail drafts) and **scheduled** (no human present, so it writes all proposed drafts to outputs/ for later review instead of staging them blind). It logs every triaged email to a Notion board, adds unknown senders to the CRM, and learns: when Shaheen edits a draft, it records the change pattern so future drafts sound more like him.

## Privacy rule (non-negotiable)
**Never dump raw email bodies into the vault.** The vault gets *intelligence only*: who the sender is, what they want, why it matters. Raw content stays in Gmail and the transient outputs/ draft files. vault/people/ pages get a one-line context, never pasted email text.

## Entry Points
- **Scheduled:** 9:00, 13:00, 17:00 daily (Task Scheduler `PersonalOS-email-triage`, mode=scheduled).
- **On-demand:** `/email-triage` (interactive, default), `/email-triage scheduled` (batch-to-outputs).

## Tools Used
- Gmail MCP: search_threads (unread, recent), get_thread (when a reply needs the full body), gmail_create_draft (approved replies). NEVER Chrome for Gmail.
- Notion MCP: notion-search (CRM sender lookup), notion-create-pages (Email Triage rows + new CRM contacts), notion-update-page (draft status).
- No Chrome. No auto-send, ever.

## Modes
**Interactive** (`/email-triage`):
1. Pull unread (last ~24h). Classify each.
2. For Act Now items needing a reply, draft in soul.md voice.
3. Show ONE at a time: classification + sender context + the draft. Shaheen approves / edits / skips.
4. Approved → gmail_create_draft (subject to the draft gate). Edited → stage the edit + record the pattern (see Learning). Skipped → mark Skipped.
5. Log each to the Notion board.

**Scheduled** (no human):
1. Same pull + classify.
2. Draft all reply candidates, but DO NOT stage to Gmail blind. Write them to `outputs/email-triage/YYYY-MM-DD/HHMM-drafts.md` (one section per email: sender, classification, why, proposed draft).
3. Log to the Notion board with Draft Status = Pending.
4. The next interactive run (or the Morning Brief) surfaces the pending drafts for approval.

## Draft Gate (inherited from Personal CRM)
Draft only if: real email (it's a reply, so the address is known) AND recipient not tagged personal/family AND not tagged do-not-contact/sensitive. Newsletters/promos/no-reply senders are Archive, never drafted to. Draft is always the ceiling; never auto-send.

## Classification
- **Act Now:** needs an action or reply today. Known people, recruiters (job-hunt active), clients/prospects, account/security/deadline items.
- **Read Later:** worth reading, no urgency. Substantive newsletters Shaheen actually follows, FYIs, receipts that matter.
- **Archive:** marketing, promos, automated no-reply noise. Counted, not drafted.

## Learning (writing-style notes)
When Shaheen EDITS a draft in interactive mode, diff the proposed vs final and append the pattern to `vault/me/writing-style-notes.md` (create on first edit). Record the *pattern*, not the email: e.g. "cuts greetings to a single line", "removes 'just'/'I think'", "prefers sign-off 'Shaheen' over 'Best, Shaheen'". Future drafts read this file first. This is how the voice converges over time.

## Notion Integration
**Email Triage** database under the Personal OS parent page (ID in vault/projects/notion-parent-id.md).
Columns:
- **Subject** (title)
- **Sender** (text)
- **Classification** (select: Act Now, Read Later, Archive)
- **Draft Status** (select: Pending, Approved, Sent, Skipped)
- **Date** (date)

Views:
- **Today** (table, filter Date is today - set at runtime; built as Date is-not-empty sorted desc, agent slices to today)
- **Pending Drafts** (table, filter Draft Status = Pending)

Row content holds the *intelligence*: sender + relationship, what they want, why it matters, classification reason, and (for drafts) a link/reference - NOT the raw email body.

**Cross-DB:** Personal CRM (data_source 746bc5bf-8ab3-4e34-911d-00b9d180e350) - look up sender context; add unknown senders as new rows (Status New, tag inferred).

## Vault Structure
- **Tier 1:** vault/projects/email-triage/status.md - DB IDs, last run, counts, pending-draft pointer.
- **Tier 2:** vault/projects/email-triage/history/YYYY-MM-DD.md - per-run counts + classifications (NO raw content).
- vault/me/writing-style-notes.md - learned voice patterns (shared, also read by CRM + Meeting Intel drafts).

## Vault Reads
- soul.md (draft voice) + vault/me/writing-style-notes.md (learned edits).
- vault/people/ (sender context).
- vault/projects/personal-crm/status.md (CRM IDs + gate).
- vault/me/goals.md (weighting: recruiter/client mail = Act Now while job-hunt + STEMPLICITY are live).

## Vault Writes
- vault/people/ for new senders (one-line intel, NO email body).
- vault/me/writing-style-notes.md on edits.
- status.md + history snapshot (counts only).
- vault/index.md (new pages), vault/log.md (every run).

## Connections
- **Fed by:** Gmail, Personal CRM (sender context), [[projects/alex-hq/status|Alex HQ]] notes inbox (step 1b in the command: every triage run is a touchpoint that files Shaheen's typed/voice HQ notes per work/16-alex-hq/CLAUDE.md "Inbox Contract"; added 2026-07-02).
- **Feeds into:** Personal CRM (new senders), Morning Brief (pending drafts + Act Now surfacing), writing-style-notes (consumed by every drafting automation).

## Post-Run (mandatory)
1. vault/people/ for new senders (intel only).
2. vault/business/ for new companies (intel only).
3. [[wiki links]] across triage history, people, CRM.
4. Notion: Email Triage rows; new CRM contacts.
5. vault/index.md updated.
6. vault/log.md updated.
7. Sprint board: Done on first build (2026-06-12).
- Alex HQ metrics push (added 2026-07-02): POST the run's key metric(s) to the build #16 ingest webhook per the contract in work/16-alex-hq/CLAUDE.md; exact curl in .claude/commands/email-triage.md. Failure-tolerant, token never printed.

## Close-Out Extras (Close-Out Gate)
Beyond the universal gate ([[research/alex-close-out-gate]]), this run is not COMPLETE until:
- `vault/me/writing-style-notes.md` is updated whenever Shaheen edited a draft this run (the voice-learning loop). N/A only when there were no edits.

## Implementation Notes (as built, 2026-06-12)
- Email Triage DB created under Personal OS parent; IDs in status.md.
- Two modes specced; scheduled writes to outputs/ rather than staging blind drafts (a human approves before anything lands in Gmail).
- Reuses the CRM draft gate + shared writing-style-notes; does not re-invent either.
- writing-style-notes.md NOT created at build (no edits yet); created on the first interactive edit.
- No live run at build (first inbox pull starts the history).

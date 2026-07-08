# Interview-to-Offer Copilot

## Type
Automation (event-driven detection via the morning brief + on-demand `/interview`). Built from roadmap brief 05, 2026-07-06.

## Purpose
Carries the two job engines (#03 BI, #14 AI) past "draft sent" to the finish. When an interview is booked: build a dossier on the company / role / interviewers, prep likely questions against Shaheen's own answer bank, capture notes after, and on an offer draft a voice-matched negotiation that reads the runway model. **Drafts only, never sends, never accepts.** This is the one stage of the pivot with zero automation today, and it is the paycheck.

## Entry Points
- **Event-driven (detect, never auto-run):** the morning brief flags a Gmail interview invite or a Calendar event that looks like an interview and suggests `/interview "Company"`. It never generates or sends anything on its own.
- **On-demand:**
  - `/interview "Company [role]"` -> dossier + prep sheet.
  - `/interview notes` -> file post-interview notes (voice or text) to the vault + CRM + sprint.
  - `/interview offer "<terms>"` -> a runway-aware, voice-matched negotiation draft (Phase 2).

## Tools Used
- Gmail + Google Calendar MCPs (detect interviews; load via ToolSearch first).
- Meeting Intel (#06) dossier engine + Research Team (#04) for company + interviewer research.
- Personal CRM (#05) for contact context and updates; the sprint board for action items.
- Runway (#20) for the negotiation's runway awareness (the zero date + what an offer buys).
- Claude for dossier / prep / fit reasoning; **claude-sonnet-4-6 fed from soul.md** for the voice-matched draft reply + negotiation message (prose model per the model-routing rule, corrected 2026-07-08).

## The answer bank (the seeded core, Phase 1)
`vault/me/interview-answers.md` - Shaheen's real, reusable answers in his voice: positioning, Power BI depth, AI automation, the layoff story, the AI differentiator, ownership/behavioral, smart questions + the diplomatic summer-remote probe, honest gap-handling, salary/availability, negotiation stances. Seeded 2026-07-06 from the master CV (`vault/sources/CV- Shaheen Kiarash.md`) + soul.md My Words. **It grows after every interview.**

## Notion Integration
None new. Uses the existing Personal CRM DB (contacts) and the sprint board (action items). No new DB by design.

## Vault Structure
- **Tier 1:** `vault/projects/interview-copilot/status.md`.
- **Tier 2:** `vault/meetings/{company-YYYY-MM-DD}.md` per interview (dossier + prep + notes).

## Vault Reads
soul.md (voice + negotiation register + My Words), `vault/me/interview-answers.md`, `vault/me/situation.md` (availability, salary, severance, citizenship), `vault/me/role.md` + `vault/sources/CV- Shaheen Kiarash.md` (facts), `vault/people/` + `vault/business/` (interviewer/company context), `vault/projects/runway/status.md` (the offer math).

## Vault Writes
`vault/meetings/` per interview; `vault/me/interview-answers.md` (grows from each interview); `status.md`; `vault/log.md`; `vault/index.md`. New interviewers -> `vault/people/` (People Intake Protocol); new companies -> `vault/business/`. New phrasing Shaheen uses -> soul.md My Words.

## Outputs
`outputs/interviews/YYYY-MM-DD/{company}-dossier.md` (+ optional branded PDF) and a prep sheet. Post-interview notes to `vault/meetings/` + CRM + sprint. Negotiation draft on offer.

## Guardrails (HARD)
Drafts only. Never replies to a recruiter, never accepts or declines, never auto-schedules. Every company/person fact is cited or marked unknown, never invented. Every voice draft passes the soul.md check before it is shown.

## Model Routing
Claude: dossier, question prep, fit reasoning, note extraction. OpenAI + soul.md: the draft reply and the negotiation message (human-facing prose in Shaheen's voice).

## Connections
- **Fed by:** #03 BI pipeline + #14 AI pipeline (the applications that lead to interviews), Gmail/Calendar, Meeting Intel (#06), Research Team (#04), Personal CRM (#05), Runway (#20).
- **Feeds into:** `vault/meetings/`, Personal CRM, the sprint board, the morning brief (interview flags), soul.md My Words.

## Close-Out Extras
- Every dossier/prep run cites its sources; unknowns flagged, nothing invented.
- New interviewer -> people/ intake (or _inbox.md); new company -> business/.
- The answer bank is updated whenever Shaheen gives a new answer or phrasing.
- Negotiation drafts reference the current runway zero date from [[projects/runway/status]].

## Phasing
- **Phase 1 (now):** the seeded answer bank + `/interview "Company"` dossier & prep on demand + the morning-brief detection flag.
- **Phase 2:** the post-interview capture loop + the negotiation module wired to Runway (#20) + auto-harvest of Shaheen's phrasing into soul.md.

## Build status
- **2026-07-06:** scaffolded from roadmap brief 05 via `/new`. Answer bank seeded from the real CV + soul.md. Dossier/prep = on-demand `/interview`; detection flag rides the morning brief (no dedicated cron). Negotiation module = Phase 2, references #20. NOTE on numbering: this is roadmap brief 05 built as **work/21** (build order, not brief number); live work/05 is /personal-crm.

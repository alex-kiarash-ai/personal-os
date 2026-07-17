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
- Skills (advisory, 2026-07-11): interview-prep (interviewer-side knowledge used INVERTED: anticipate their questions, drill vs the answer bank); power-bi-dax-optimization / -model-design-review / -performance-troubleshooting (technical drill, Power BI track); resume-tailor + resume-ats-optimizer (role-specific CV tweaks).

## The answer bank (the seeded core, Phase 1)
`vault/me/interview-answers.md` - Shaheen's real, reusable answers in his voice: positioning, Power BI depth, AI automation, the layoff story, the AI differentiator, ownership/behavioral, smart questions + the diplomatic summer-remote probe, honest gap-handling, salary/availability, negotiation stances. Seeded 2026-07-06 from the master CV (`vault/sources/CV- Shaheen Kiarash.md`) + soul.md My Words. **It grows after every interview.**

## Interview Brief (application-anchored, added 2026-07-15, /prompting item 5)
When `/interview "Company [role]"` runs (or on a booked-interview flag) and that company/role has a DRAFTED application in the #03/#14 pipeline, the dossier gains the one thing only Alex can produce: the delta between what was SENT and what the CV backs. Read-only over Shaheen's own records. Anything can generate "likely BI interview questions"; only Alex knows what went out in his voice.

**Where the application record lives (located 2026-07-15):** the #03/#14 pipeline writes to the **"Job Search Pipeline" Google Sheet** (id `19puwN6wxFHI7iICrdafiFn1Diqq7qJTe5-5r0Y2XQFY`, see work/03-application-engine/CLAUDE.md "External IDs"), tab **`run_log`** = one row per drafted application: `company | location | country | target_role (=lane) | fit_score | interest_score | rank_score | date | drive_folder_url | job_url | ...`. The actual **CV PDF + cover-letter PDF** live in the per-job **Google Drive folder** at `drive_folder_url`; the **JD** is at `job_url` (or the `payload_json` column of the `processed_jobs` tab). The full scorer rationale is NOT persisted (only the three scores), so the brief's spine is the CV-vs-cover-letter-vs-JD delta, not the scorer's prose.

**The join (deterministic, read-only):**
1. Given company + role (or a `job_posting_id`, most reliable), read the `run_log` row via the Google Sheets MCP (fall back to a Drive xlsx export read, the #03 ops-check pattern, if the natural-language read truncates to tab 1).
2. Download the CV + cover-letter PDFs from `drive_folder_url` (Google Drive MCP, `pdf` skill to read them); read the JD from `job_url`/`payload_json`.
3. Read the outcome from [[projects/interview-copilot/outcomes]] if present.

**The brief (ONE Claude call, prose = claude-sonnet-4-6 + the soul voice block; run the Brand + Soul Pre-Flight Gate FIRST and print the pre-flight line before a single byte):**
- **Defence list** - every claim the cover letter makes, each with the CV evidence for it, or a flag where there is none ("claimed X, CV shows Y, be ready to defend X"). This is the part that bites in a real interview.
- **Gap list** - JD requirements with no matching CV block = the likely questions (job-description-analyzer skill for the requirement/keyword extraction; resume-tailor/-ats-optimizer for the CV-side mapping).
- **Lane frame** - which track applied (`target_role`: Senior Power BI vs AI/Automation), so the framing matches what they read.
- **Timing** - date sent + elapsed ("applied Tuesday" vs "applied in March" are different conversations).
- Phone-openable (interviews don't happen at the desk): `outputs/interview-copilot/YYYY-MM-DD/{company}-brief.md` (+ the dossier's optional branded PDF), ledger row per Output Hygiene.

**Guardrail:** read-only over the Sheet/Drive; cite every claim to the actual CV/cover-letter/JD, flag anything not found, invent nothing. The HARD never-send gate is unchanged. EVENT by nature: with no booked interview the capability sits ready and fires on the next real one (or a named drill target), exactly like the rest of #21.

## Application outcome ledger (added 2026-07-15, /prompting item 5)
[[projects/interview-copilot/outcomes]] (`vault/projects/interview-copilot/outcomes.md`) - one row per application whose fate is known: `job_posting_id | company | role | lane | outcome | date | source`. `outcome` enum: `sent | no-reply | rejected | screen | interview | offer`. Written by Shaheen, or by #07 email-triage where a rejection/interview-invite is unambiguous (its job-loop already flags recruiter replies and escalates here). It trains nothing and is not a calibration set (~10 real signals/year); it exists so the brief can say "applied in March, no reply" and so Shaheen knows what happened. **Home rationale (deliberate deviation from the plan's "column on run_log", 2026-07-15):** run_log is a remote n8n-appended Sheet; a local markdown ledger keeps the outcome Shaheen/#07-writable, greppable, verify-friendly, and OFF the live pipeline's schema (no risk to the 07:00 cron's append). The brief reads it read-only. The #07-writes-outcomes hook is a small follow-on, not built this session (Shaheen writes it for now).

## Notion Integration
None new. Uses the existing Personal CRM DB (contacts) and the sprint board (action items). No new DB by design.
**Row-filter contract (upgrade P6, 2026-07-12, audit b21):** interview-related rows live MIXED among CRM contacts, so: every #21 row gets the tag `interview` on its CRM entry; every #21 query filters on that tag; and the unattended Status ceiling ("Alex may set Status only up to Interesting unattended") is enforced BY the filter discipline - a #21 write never touches a non-`interview`-tagged row's Status, and never raises any row past Interesting without Shaheen in the loop. Cheap and honest; a dedicated DB was rejected (bootstrap + isolation overhead for a per-event automation).

## First-fire drill (2026-07-12, upgrade P6)
Full path exercised on a synthetic interview (flag -> dossier shape -> answer-bank prep mapping -> runway-aware negotiation stance computed from the live 07-12 inputs). Record: outputs/interview-copilot/2026-07-12/drill-mock-interview.md. `first_fire: 2026-07-12, kind: drill` in the registry. Friction noted for the first real run: the answer bank already covers behavioral/negotiation (drill's §4+ seeding note was WRONG - the bank's seed list above includes them); real friction found: none.

## Vault Structure
- **Tier 1:** `vault/projects/interview-copilot/status.md`.
- **Tier 2:** `vault/meetings/{company-YYYY-MM-DD}.md` per interview (dossier + prep + notes).

## Vault Reads
soul.md (voice + negotiation register + My Words), `vault/me/interview-answers.md`, `vault/me/situation.md` (availability, salary, severance, citizenship), `vault/me/role.md` + `vault/sources/CV- Shaheen Kiarash.md` (facts), `vault/people/` + `vault/business/` (interviewer/company context), `vault/projects/runway/status.md` (the offer math).

## Vault Writes
`vault/meetings/` per interview; `vault/me/interview-answers.md` (grows from each interview); `status.md`; `vault/log.md`; `vault/index.md`. New interviewers -> `vault/people/` (People Intake Protocol); new companies -> `vault/business/`. New phrasing Shaheen uses -> soul.md My Words.

## Outputs
`outputs/interview-copilot/YYYY-MM-DD/{company}-dossier.md` (+ optional branded PDF) and a prep sheet. Post-interview notes to `vault/meetings/` + CRM + sprint. Negotiation draft on offer.

## Guardrails (HARD)
Drafts only. Never replies to a recruiter, never accepts or declines, never auto-schedules. Every company/person fact is cited or marked unknown, never invented. Every voice draft passes the soul.md check before it is shown.

## Model Routing
Claude: dossier, question prep, fit reasoning, note extraction. claude-sonnet-4-6 + soul.md: the draft reply and the negotiation message (human-facing prose in Shaheen's voice). *(Corrected 2026-07-14, /deep-audit D1: was "OpenAI"; the 2026-07-08 model-routing rule runs all prose nodes on claude-sonnet-4-6.)*

## Connections
- **Fed by:** #03 BI pipeline + #14 AI pipeline (the applications that lead to interviews), Gmail/Calendar, Meeting Intel (#06), Research Team (#04), Personal CRM (#05), Runway (#20), Email Triage (#07 - its job-loop flags recruiter replies + interview invites and escalates them here, 2026-07-10 v2).
- **Feeds into:** `vault/meetings/`, Personal CRM (an active interview signals #05 to override that recruiter contact's Cadence Days to 7 + bump the goal-overlay, so the follow-up engine prioritises the live opportunity, 2026-07-10), the sprint board, the morning brief (interview flags), soul.md My Words.

## Close-Out Extras
- Every dossier/prep run cites its sources; unknowns flagged, nothing invented.
- New interviewer -> people/ intake (or _inbox.md); new company -> business/.
- The answer bank is updated whenever Shaheen gives a new answer or phrasing.
- Negotiation drafts reference the current runway zero date from [[projects/runway/status]].
- The interview brief cites the exact `run_log` row + CV/cover-letter/JD it read; unknowns flagged, nothing invented. The outcome ledger [[projects/interview-copilot/outcomes]] is updated when an application's fate is known.

## Phasing
- **Phase 1 (now):** the seeded answer bank + `/interview "Company"` dossier & prep on demand + the morning-brief detection flag.
- **Phase 2:** the post-interview capture loop + the negotiation module wired to Runway (#20) + auto-harvest of Shaheen's phrasing into soul.md.

## Build status
- **2026-07-06:** scaffolded from roadmap brief 05 via `/new`. Answer bank seeded from the real CV + soul.md. Dossier/prep = on-demand `/interview`; detection flag rides the morning brief (no dedicated cron). Negotiation module = Phase 2, references #20. NOTE on numbering: this is roadmap brief 05 built as **work/21** (build order, not brief number); live work/05 is /personal-crm.

## Trifecta
Gate: **draft-only**. Legs: private_data=true, untrusted_content=true, external_comm=true (agent-security Rule-of-Two, three-plan validation P3, 2026-07-17). All three legs true: private financials/answer bank + untrusted company research + negotiation drafts. Never sends, Shaheen sends. Source of truth: the `trifecta` block in system/manifest.json + [[research/trifecta-map]]. Validator V12 fails the build if this gate stops matching the manifest.

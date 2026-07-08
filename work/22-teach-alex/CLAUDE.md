# Teach-Alex Button

## Type
Automation (event-driven: a correction note arrives at the inbox + a sweep at each touchpoint + on-demand). Built from roadmap brief 02, 2026-07-06. Built as **work/22** (brief 02; build order, not brief number).

## Purpose
Makes correcting Alex a single frictionless action from anywhere. Shaheen drops a note (typed or voice) like "you labelled Gabriella as a recruiter, she is HR, fix it" or "that draft was too formal, I say deal not engagement." Alex classifies the correction (voice / fact / person-label / rule / format; a behavior correction folds into the rule route), files it to the right home, proposes the exact edit, applies it on confirmation (identity files always confirm), and replies with what changed. Every correction is logged so the weekly self-review (#23, work/23) can batch them into rule changes. This is the "correct it" verb of the personal-OS product and the fuel of the self-improving loop.

## Entry Points
- **Event-driven:** a correction arrives via the existing "Drop a note to Alex" inbox (`alex_inbox`, typed + voice via local Whisper).
- **Touchpoint sweep:** every existing inbox-reading touchpoint (morning brief step 4b, email-triage, `/alex-hq`, `/status`, any session) checks for correction-type notes and routes them here.
- **On-demand:** `/teach-alex "<correction>"` (or just drop it in the inbox).

## The correction classifier (the core new logic)
Given a note, classify into ONE type and route:
- **voice / phrasing** ("I say deal not engagement") -> `soul.md` "My Words" (date-stamped). CONFIRM before applying (identity file).
- **fact / person-label** ("Gabriella is HR not a recruiter") -> the relevant `vault/people/` or `vault/business/` page (+ fix inbound links per the People Intake Protocol). Auto-applies when the target is unambiguous; CONFIRM if it moves a person between category folders.
- **rule / behavior** ("always X", "stop doing Y") -> a rule in the relevant CLAUDE.md (root or `work/{n}`). CONFIRM before applying (identity file).
- **format** ("reports should show X first") -> a format note in the relevant command/spec. Auto-applies to a work file; CONFIRM for root.
- **ambiguous** -> ask ONE sharp question if interactive, else file to the corrections-log tagged `needs-review` (never guess silently, never block a night run).

## Corrections log (the bridge to #23)
Every correction, whatever the type, is appended to `vault/projects/teach-alex/corrections-log.md` (append-only): date, raw note, type, target file, status (proposed / applied / confirmed / needs-review), and the resulting edit. **#23 `/self-review` reads this weekly** to cluster corrections into rule changes.

## Guardrails (HARD)
Never applies identity-file changes (`soul.md`, any `CLAUDE.md`) without explicit confirmation. Confirms the interpretation before any big change. Never sends anything outward. Fabricates nothing; if the target is unclear, ask or file `needs-review`.

## Tools / infra (all live)
The existing two-way inbox (`alex_inbox` table, n8n wf `701jclfh3q4d8l1q`, typed + voice via local Whisper), Alex HQ, the vault, Notion. Almost nothing new externally; this rides infrastructure already shipped (#16).

## Model Routing
Claude to classify the correction and choose the target file. claude-sonnet-4-6 fed from soul.md for the confirmation reply so it reads as Alex (prose model per the model-routing rule, corrected 2026-07-08).

## Vault Structure
- **Tier 1:** `vault/projects/teach-alex/status.md`.
- **Tier 2:** `vault/projects/teach-alex/corrections-log.md` (append-only) + a running "what Alex learned" digest inside status.

## Vault Reads
soul.md, the target files per correction (`vault/people/`, `vault/business/`, root + work CLAUDE.md, command specs), the corrections-log.

## Vault Writes
The corrected file (on confirm), `corrections-log.md` (every correction), the "what Alex learned" digest, `vault/log.md`, `vault/index.md`.

## Outputs
No file deliverable. The output is the corrected file + a confirmation reply in the inbox + a corrections-log entry.

## Connections
- **Fed by:** the `alex_inbox` (Shaheen's corrections), every touchpoint that reads the inbox.
- **Feeds into:** soul.md My Words, people/business pages, CLAUDE.md rules, and **#23 `/self-review`** (the weekly batch), the morning brief "what Alex learned" line.

## Close-Out Extras
- Every correction -> a corrections-log entry (never silently dropped).
- Identity-file edits confirmed; others logged with the applied edit.
- New person from a correction -> People Intake Protocol.

## Phasing
- **Phase 1 (now):** the correction note-type + classifier + file-with-confirm + the corrections-log, wired into the morning-brief inbox step.
- **Phase 2:** the weekly "what Alex learned" digest into the Monday brief / HQ + trusted auto-apply for safe classes.

## Build status
- **2026-07-06:** scaffolded from roadmap brief 02 via `/new`. Rides the existing inbox (#16). Corrections-log created. Correction detection/routing wired into the morning-brief inbox step (4b). Feeds #23 (`/self-review`, work/23).

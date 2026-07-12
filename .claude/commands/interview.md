# /interview - Interview-to-Offer Copilot

Full spec: `work/21-interview-copilot/CLAUDE.md` (read it first).

Carries a booked interview to the finish: dossier + prep against Shaheen's answer bank, notes capture, and a runway-aware voice-matched negotiation on offer. **Drafts only. Never replies, accepts, declines, or schedules.**

## Modes
- `/interview "Company [role]"` - build the dossier + prep sheet.
- `/interview notes` - file post-interview notes (voice or text) to the vault + CRM + sprint.
- `/interview offer "<terms>"` - draft a runway-aware negotiation reply (Phase 2).

## Steps the command executes
1. **Read the answer bank** `vault/me/interview-answers.md` + soul.md (voice) + `me/situation` (availability, salary, citizenship, severance).
2. **Build the dossier** for the company / role / interviewers: reuse Meeting Intel (#06) + Research Team (#04); cross-reference `vault/people/` and `vault/business/`. Cite every fact, mark unknowns, invent nothing.
3. **Prep sheet:** likely questions in his domain (Power BI + AI automation) mapped to his own answers, his differentiators, the smart questions to ask, and the diplomatic summer-remote probe from My Words.
4. **Write** `vault/meetings/{company-YYYY-MM-DD}.md` + the dossier to `outputs/interview-copilot/YYYY-MM-DD/`. New interviewer -> `vault/people/` (intake); new company -> `vault/business/`.
5. **Post-interview (`notes`):** extract notes -> `vault/meetings/` + Personal CRM + sprint board action items; harvest any new phrasing to soul.md My Words + grow the answer bank.
6. **On offer (`offer`, Phase 2):** pull the current zero date from [[projects/runway/status]], draft a negotiation message in his voice (OpenAI + soul.md): positive, money-second, soft numbers, availability from today.

## Detection (event-driven)
The morning brief flags a Gmail interview invite or a Calendar event that smells like an interview and suggests `/interview "Company"`. It NEVER auto-runs a dossier or drafts anything on its own.

## Guardrails
Drafts only, hard gate on every outward message. Facts cited or marked unknown. Voice drafts pass the soul.md check.

## Close-Out
Print the Close-Out Report. Interview extras: sources cited, new people -> people/, answer bank grown if a new answer landed, negotiation drafts reference the current runway zero date.

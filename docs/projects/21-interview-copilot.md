# 21 - Interview-to-Offer Copilot

**What it is (plain version):** Shaheen's two job engines (the BI pipeline #03 and the AI pipeline #14) find jobs, score them, and write tailored applications. Then they stop. The highest-stakes part of the pivot, the interview and the offer, had zero help. This closes that loop: when an interview is booked, Alex builds a dossier on the company and the people, preps the likely questions with Shaheen's own answers, captures the notes afterward, and on an offer drafts a negotiation in his voice that knows exactly what the money means against his runway.

**Why it exists:** landing the role is the number-one near-term goal, and it was the one stage with no automation. It also shows the system compounding: it reuses Meeting Intel, the Research Team, the CRM, the runway model and Shaheen's voice, instead of building from scratch.

**How it works:**
- The seeded piece is the **answer bank** (`vault/me/interview-answers.md`): Shaheen's real answers in his voice, built from his actual CV and soul.md, covering positioning, his Power BI and AI-automation proof, the layoff story told plainly, the AI-differentiator edge, the smart questions to ask (including his diplomatic summer-remote probe), and his negotiation stances. It grows after every interview.
- `/interview "Company"` builds a dossier + prep sheet on demand. The morning brief flags anything that looks like an interview and suggests running it, but never generates or sends anything on its own.
- Drafts only, always. Alex never replies to a recruiter, never accepts or declines, never schedules. Facts are cited or marked unknown, never invented.

**First build (2026-07-06):** Phase 1 shipped, the answer bank seeded and the command + detection ready. No interview has run yet. Phase 2 wires the post-interview capture and the runway-aware negotiation module.

**Connects to:** fed by the job pipelines (#03, #14), Gmail/Calendar, Meeting Intel (#06), Research Team (#04), Personal CRM (#05) and Runway (#20); feeds the vault meetings, the CRM, the sprint board, and Shaheen's voice corpus.

**Command:** `/interview "Company [role]"` (dossier + prep), `/interview notes`, `/interview offer` (Phase 2). Numbering note: this is roadmap brief 05, built as work/21; live work/05 is the personal CRM.

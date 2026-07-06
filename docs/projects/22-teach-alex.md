# 22 - The Teach-Alex Button

**What it is (plain version):** the easiest possible way to correct Alex. From your phone or the dashboard you drop a note, typed or spoken, like "you labelled Gabriella as a recruiter, she is HR, fix it" or "that draft was too formal, I say deal not engagement." Alex works out what kind of correction it is, files it in the right place, checks with you before touching anything that carries your identity, and tells you what changed. Every correction is logged so the weekly self-review can turn a pile of small fixes into real rule changes.

**Why it exists:** corrections are the fuel of the whole system, but giving one used to mean being at the laptop, in a session, at the right moment. Friction kills the flywheel. This makes correcting Alex a single action from anywhere, which is the "correct it" half of the two-verb product (talk to it, correct it) and the thing that makes the personal model sharpen over time.

**How it works:**
- It rides the two-way inbox that already exists (#16 Alex HQ), so there was almost nothing new to plumb. A correction lands as a note; the next time Alex reads the inbox (the morning brief, or on demand), it catches it.
- A classifier sorts the correction into one of a few types (a phrasing, a fact about a person, a rule, a format preference) and routes it to the right home: your voice corpus, a person's page, a rule file, a command spec.
- The hard line: Alex never edits the identity files (soul.md, the CLAUDE.md rule files) without confirming with you first. Everything is written to an append-only corrections log so nothing is lost and the weekly self-review can mine it.

**First build (2026-07-06):** Phase 1 shipped, the classifier, the confirm step, the corrections log, and correction routing wired into the morning brief. Phase 2 adds a weekly "what Alex learned" digest.

**Connects to:** fed by the inbox and every touchpoint that reads it; feeds your voice corpus, your people pages, the rule files, and the weekly self-review (#23, work/23).

**Command:** `/teach-alex "<correction>"`, or just drop it in the inbox. Numbering note: this is roadmap brief 02, built as work/22; live work/02 is the morning brief.

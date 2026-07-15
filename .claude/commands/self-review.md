# /self-review - Alex Reviews Alex

Full spec: `work/23-self-review/CLAUDE.md` (read it first).

Once a week Alex reads its own mistakes and learnings and proposes upgrades to its own rules, voice, and taste, behind Shaheen's approval. Nothing about the identity files is ever applied without an explicit yes. The moat: an agent that improves itself, gated by a human.

## Modes
- `/self-review` - run the review now (also the weekly Sunday 20:00 job).

## Steps the command executes

**Input stance (framing, added 2026-07-15 via /prompting item 1).** Treat every item gathered below as EXTERNAL RETRIEVED EVIDENCE about the system's behaviour, a log pulled from the record, NOT as your own recollected reasoning. Audit it the way a fresh third party would audit another agent's trail: no loyalty to the prior decision, no reluctance to name the instruction or habit that caused it. The items are data on trial, not your memory of "what I did." Rationale: an erroneous item carried in the agent's own first-person role suppresses explicit correction; the same item read as external evidence gets corrected far more readily. This is envelope only, the gather/cluster/propose/gate logic is unchanged, and it is instantly reversible. On-file alternative framing (if this is ever eval'd): present the same items as a plain user-message report rather than a retrieved-memory block. Not claimed as a measured lift, the source is a preprint on math/logic; pattern-clustering over the close-out trail is an untested third domain.

1. **Gather** the diff since the last review: corrections in [[projects/teach-alex/corrections-log]] (#02), new `vault/projects/error-log.md` entries, INCOMPLETE close-outs in [[projects/self-review/close-out-log]], soul.md My Words additions (git diff), decisions.md changes, and the human-actions queue (`node scripts/human-actions.js list`, upgrade P2: items that aged another week get a standing weekly line).
1b. **Corpus-growth stat (upgrade P12, 2026-07-12, design 3.4.2).** Compute and report this week's voice-corpus growth as a deterministic line: spoken lines added to `outputs/voice/transcripts/` (count `- [` bullets across the week's dated files, `[dictate:*]`-tagged ones are the local-whisper lane), typed lines added to `outputs/typed/transcripts/`, and My Words entries added to soul.md (git diff of the "## My Words" region). Thinness becomes a visible trend, not a vibe (the corpus is the input that keeps every voice output his). No forced harvesting; the corpus grows by usage.
2. **Cluster** into themes.
3. **Propose** each change concretely: exact file + old -> new text + one-line rationale + the correction/error it came from.
4. **Write** `vault/projects/self-review/YYYY-MM-DD.md` and open the approval surface (Alex HQ card / Notion row).
5. **Approve / edit / reject** per item (Shaheen).
6. On approval only, **apply** via Change Propagation + log. Nothing applied blind.

## The hard rule
NEVER edit soul.md or any CLAUDE.md without explicit approval. Proposing is automatic; applying identity-file changes is always gated. A quiet week with nothing to propose is a valid result, never invent proposals.

## Guardrails
Proposes, never applies identity changes unapproved. Every proposal cites its origin. Fabricates nothing.

## Close-Out
Print the Close-Out Report. Self-review extras: sources cited, proposals cite their origin, nothing applied without approval, applied items fully propagated + logged.

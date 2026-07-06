# /self-review - Alex Reviews Alex

Full spec: `work/23-self-review/CLAUDE.md` (read it first).

Once a week Alex reads its own mistakes and learnings and proposes upgrades to its own rules, voice, and taste, behind Shaheen's approval. Nothing about the identity files is ever applied without an explicit yes. The moat: an agent that improves itself, gated by a human.

## Modes
- `/self-review` - run the review now (also the weekly Sunday 20:00 job).

## Steps the command executes
1. **Gather** the diff since the last review: corrections in [[projects/teach-alex/corrections-log]] (#02), new `vault/projects/error-log.md` entries, INCOMPLETE close-outs in [[projects/self-review/close-out-log]], soul.md My Words additions (git diff), decisions.md changes.
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

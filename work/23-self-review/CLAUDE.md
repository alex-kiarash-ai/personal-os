# Alex Reviews Alex (Self-Review)

## Type
Automation (weekly, Sunday 20:00, + on-demand `/self-review`). Built from roadmap brief 01, 2026-07-06. Built as **work/23** (brief 01; build order, not brief number).

## Purpose
Turns Alex's learning loop from passive filing into an active habit. Once a week Alex reads its own trail since the last review: the new corrections (from #22, the corrections-log), the error-log entries, the close-out reports that came back INCOMPLETE, the phrasing added to soul.md My Words, and it looks for patterns. Then it writes a short self-review in plain words, what it got wrong or learned this week, and the exact changes it proposes to its own rules (CLAUDE.md), its voice (soul.md), or its taste (taste-profile). Shaheen approves / edits / rejects each item, and ONLY then does Alex apply the change and log it. This is the moat: the coherence layer that keeps a year-long agent improving instead of rotting, and a rare "AI that upgrades itself, behind a human gate" to show.

## Entry Points
- **Scheduled:** weekly, Sunday 20:00 (quiet slot), before the Monday brief.
- **On-demand:** `/self-review`.

## What a run does
1. **Gather the diff** since the last review: new corrections in [[projects/teach-alex/corrections-log]] (#22), new `vault/projects/error-log.md` entries, INCOMPLETE close-out reports from [[projects/self-review/close-out-log]], soul.md My Words additions (git diff), `vault/me/decisions.md` changes.
2. **Cluster** into themes (a recurring voice slip, a wrong contact label, a formatting miss, a repeated failure).
3. For each theme, **draft a concrete proposed change:** the exact file + the exact old -> new text + a one-line rationale + the correction/error it came from.
4. **Write** `vault/projects/self-review/YYYY-MM-DD.md` and open an approval surface (an Alex HQ card or a Notion row).
5. Shaheen **approves / edits / rejects** each item.
6. On approval, Alex **applies** the change through Change Propagation and logs it. Nothing applied without approval.

## The hard rule (the whole point)
Alex NEVER self-edits soul.md or any CLAUDE.md without Shaheen's explicit approval. Proposing is automatic; applying identity-file changes is gated, always. Low-risk classes (a My Words phrase already confirmed via #22) may be pre-approved, but soul.md / CLAUDE.md edits are never auto-applied here.

## Data / infra it uses (all live)
Git history (weekly diff of the identity files), `vault/projects/error-log.md`, [[projects/teach-alex/corrections-log]] (#22), [[projects/self-review/close-out-log]], soul.md My Words, `vault/me/decisions.md`, `vault/me/taste-profile.md`, the vault, Notion (approval rows), Alex HQ (approval card). No new external service; this is reasoning over files that already exist.

## Approval surface
Phase 1: the self-review doc itself + Shaheen approves inline (or a small "Alex Improvements" Notion view / an Alex HQ card). Phase 2: approve-in-HQ with auto-apply on approval for safe classes.

## Vault Structure
- **Tier 1:** `vault/projects/self-review/status.md`.
- **Tier 2:** `vault/projects/self-review/YYYY-MM-DD.md` (one per review) + `close-out-log.md` (the INCOMPLETE-verdict persistence the Close-Out Gate appends to).

## Vault Reads
error-log.md, teach-alex/corrections-log, self-review/close-out-log, soul.md (+ git diff), decisions.md, taste-profile.md, log.md.

## Vault Writes
The self-review doc; on approval, the target identity/rule/taste files (via Change Propagation) + log.md; status.md; index.md.

## Guardrails
Proposes, never applies identity-file changes without approval. Fabricates nothing; every proposed change cites the correction/error it came from. If nothing meaningful accumulated in a week, says so plainly (a quiet week is a valid result), never invents proposals to look busy.

## Model Routing
Claude for the clustering and the reasoning. If a human-readable weekly summary line is written for the Monday brief, OpenAI + soul.md.

## Connections
- **Fed by:** #22 Teach-Alex (corrections-log), error-log, close-out-log, soul.md My Words, decisions.
- **Feeds into:** soul.md, CLAUDE.md (root + work), taste-profile, decisions.md, the Monday brief ("what Alex learned this week"), a Building Alex episode.

## Close-Out Extras
- Every review cites its sources; proposals cite their origin correction/error.
- Nothing applied without approval; applied changes go through full Change Propagation + log.

## Phasing
- **Phase 1 (now):** the weekly proposal doc, Shaheen applies approved items; the general taste-profile + close-out-log seeded so the inputs actually exist. A first self-review proof written.
- **Phase 2:** approve-in-HQ + auto-apply on approval for safe classes + the "what Alex learned" brief line.

## Build status
- **2026-07-06:** scaffolded from roadmap brief 01 via `/new`. Persistence gaps the earlier validation flagged are CLOSED: a general `vault/me/taste-profile.md` and `vault/projects/self-review/close-out-log.md` created, and the Close-Out Gate now appends INCOMPLETE verdicts to that log. First self-review proof doc written. Weekly Sunday 20:00 pending /cron-setup.

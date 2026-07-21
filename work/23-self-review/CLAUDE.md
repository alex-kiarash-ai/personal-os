# Alex Reviews Alex (Self-Review)

## Type
Automation (weekly, Sunday 20:00, + on-demand `/self-review`). Built from roadmap brief 01, 2026-07-06. Built as **work/23** (brief 01; build order, not brief number).

## Purpose
Turns Alex's learning loop from passive filing into an active habit. Once a week Alex reads its own trail since the last review: the new corrections (from #22, the corrections-log), the error-log entries, the close-out reports that came back INCOMPLETE, the phrasing added to soul.md My Words, and it looks for patterns. Then it writes a short self-review in plain words, what it got wrong or learned this week, and the exact changes it proposes to its own rules (CLAUDE.md), its voice (soul.md), or its taste (taste-profile). Shaheen approves / edits / rejects each item, and ONLY then does Alex apply the change and log it. This is the moat: the coherence layer that keeps a year-long agent improving instead of rotting, and a rare "AI that upgrades itself, behind a human gate" to show.

## Entry Points
- **Scheduled:** weekly, Sunday 20:00 (quiet slot), before the Monday brief.
- **On-demand:** `/self-review`.
- **On-demand, heavy:** `/deep-audit [scope]` - the adversarial whole-system audit (see Deep Audit below). Never scheduled.

## What a run does

**Input stance (framing, 2026-07-15, /prompting item 1).** The review reads its inputs as EXTERNAL RETRIEVED EVIDENCE about the system's behaviour (a log pulled from the record), not as Alex's own recollected reasoning. Audit the trail the way a fresh third party would: no loyalty to the prior decision, willing to name the instruction or habit that caused it. Reflexive "here is what I did, find my pattern" framing suppresses explicit self-correction; external-evidence framing lifts it. Envelope only (the gather/cluster/propose/gate logic below is unchanged), reversible, and made on the argument, not on a measured lift (preprint, math/logic; close-out pattern-clustering is an untested domain). The command file `.claude/commands/self-review.md` carries the same stance verbatim. Note: /deep-audit already reads external by construction (per-project fan-out + adversarial refuters anchored in ground truth), so this change is /self-review only.

1. **Gather the diff** since the last review: new corrections in [[projects/teach-alex/corrections-log]] (#22), new `vault/projects/error-log.md` entries, INCOMPLETE close-out reports from [[projects/self-review/close-out-log]], soul.md My Words additions (git diff), `vault/me/decisions.md` changes, and the week's **`work/**/CLAUDE.md` spec changes** (git diff) - the manifest-entry review nudge (added 2026-07-21, audit F-02/Class B): for each changed spec confirm its `system/manifest.json` one_liner/state/trigger/commands still match, since recovery check C10 no longer raises committed spec edits as "manifest-stale" drift (it now flags only UNCOMMITTED spec edits; committed = accepted). A mismatch becomes a proposed manifest edit; a match is a one-line note.
2. **Cluster** into themes (a recurring voice slip, a wrong contact label, a formatting miss, a repeated failure).
3. For each theme, **draft a concrete proposed change:** the exact file + the exact old -> new text + a one-line rationale + the correction/error it came from.
4. **Write** `vault/projects/self-review/YYYY-MM-DD.md` and open an approval surface (an Alex HQ card or a Notion row).
5. Shaheen **approves / edits / rejects** each item.
6. On approval, Alex **applies** the change through Change Propagation and logs it. Nothing applied without approval.

## The hard rule (the whole point)
Alex NEVER self-edits soul.md or any CLAUDE.md without Shaheen's explicit approval. Proposing is automatic; applying identity-file changes is gated, always. Low-risk classes (a My Words phrase already confirmed via #22) may be pre-approved, but soul.md / CLAUDE.md edits are never auto-applied here.

## Close-Out Grader (separate-context, item C) - added 2026-07-07 (upgrade-scan item 2)
The kit in `work/23-self-review/close-out-grader/` (rubric.md + grader-prompt.md + README.md) implements
Anthropic's Outcomes pattern for Close-Out item C: a fresh subagent that sees ONLY the finished
identity-carrying artifact + the rubric, never the producing session's reasoning, and returns
per-criterion PASS/FAIL (palette / accent / type / red / logo; dashes / AI-tells / softeners / rhythm /
his-words; pre-flight). It fixes the self-grading bias that let the 2026-07-03 brand incident ship.
**ADVISORY ONLY, hard constraint:** it flags, it never blocks a run; it is deliberately NOT wired into
`scripts/lib/close-out.ps1`, so a grader FAIL / slow grader / unavailable grader can never fail one of
the 15 scheduled jobs. Invoked via the Agent tool (Alex's existing inline-subagent convention, no new
Claude Code config). Verified 2026-07-07 against a reconstructed 07-03 violator (FAIL) + a compliant
artifact (PASS). #23 owns the kit because it owns the review/quality surface; the invocation is global
(every session's item C), driven from the root CLAUDE.md Close-Out Gate.

## Deep Audit (on-demand adversarial repo audit) - added 2026-07-14 (dynamic-workflows build)
The heavy on-demand sibling of the weekly review. `/deep-audit [scope]` fans out one agent per project and makes each prove the project's manifest CLAIMS (state, "does what the one-liner says", n8n `active:true` on the live API, schedule_jobs exist, first_fire real, connected surfaces agree) match GROUND TRUTH, then an adversarial pass tries to break every "verified" verdict from a cited system fact. It catches the "file says X, reality is Y" drift class that #18's pattern-checker and the cheap weekly review structurally miss (proven by the 07-10 silent dual-engine deactivation, the stale deployed-inactive note, the recurring audit-null corrections in commits). **Never scheduled** - on Max it spends the usage window; a full ~26-project run is the quarterly deep sweep, scope it to one project for a bounded proof. **Finds + proposes only:** DRIFT enters #23's gated propose/approve/apply loop (generated-surface drift is fixed via `system/manifest.json` + the generator, never hand-edits between markers; identity files stay gated exactly like `/self-review`). Full spec + workflow: `work/23-self-review/deep-audit/README.md`. It is the whole-repo sibling of #04's single-claim Adversarial Verification Mode (shared evidence-anchored refutation discipline: dissent must cite a fact, never model reasoning alone).

## Diagnose (instruction attribution) - added 2026-07-15 (/prompting item 4)
The batched sub-step that asks WHICH instruction caused a correction, so #23 stops treating symptoms. Runs inside the weekly review. Split per the model-routing rule: DETERMINISTIC `work/23-self-review/diagnose/diagnose.js` (`corpus` bounds the candidate set to root CLAUDE.md + soul.md + the relevant work/NN/CLAUDE.md; `record` writes a diagnosis behind a hard **>=80 confidence gate**; `resolve` scores it at 60 days by asking "did this class recur after the patch?"), and one REASONING pass (Alex, `claude-sonnet-4-6`, NO voice block) that reads the bounded corpus and names the culprit with a quoted span + file:line + confidence. Below 80 -> "no attributable instruction" (the common, honest case, still recorded). At/above 80 -> a **gated proposal** to `system/human-actions.jsonl`.
**Hard rule (by construction):** diagnose writes ONLY to `vault/projects/self-review/diagnoses.jsonl` + the human-actions queue. It NEVER edits CLAUDE.md or soul.md ([[me/NEVER-TOUCH]]); the constitution changes only when Shaheen edits the source + regenerates. Ships WITH its resolver in the same pass (a diagnoser without a resolver would be an unchecked semantic surface, the exact thing this refuses to add). Limits stated plainly: most errors will not trace to a line; the resolver is slow (~a dozen resolved rows/year, a signal never a scoreboard); it cannot diagnose an error nobody reported. Full spec: `work/23-self-review/diagnose/README.md`. Proven by drill 2026-07-15 (all four subcommands + both resolver branches, against temp files; real record clean, corrections-log still empty so nothing to diagnose yet).

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
- The close-out-grader kit stays ADVISORY: never add it to scripts/lib/close-out.ps1 or gate any run on it.

## Phasing
- **Phase 1 (now):** the weekly proposal doc, Shaheen applies approved items; the general taste-profile + close-out-log seeded so the inputs actually exist. A first self-review proof written.
- **Phase 2:** approve-in-HQ + auto-apply on approval for safe classes + the "what Alex learned" brief line.

## Build status
- **2026-07-06:** scaffolded from roadmap brief 01 via `/new`. Persistence gaps the earlier validation flagged are CLOSED: a general `vault/me/taste-profile.md` and `vault/projects/self-review/close-out-log.md` created, and the Close-Out Gate now appends INCOMPLETE verdicts to that log. First self-review proof doc written. Weekly Sunday 20:00 pending /cron-setup.

# Migration Engine

## Type
Automation (on-demand, dynamic-workflow fan-out). Built 2026-07-14 (dynamic-workflows build, Shaheen's call). Target is a PARAMETER; no target committed yet.

## Purpose
Run a real code/config migration as a dynamic workflow - parallel agents, per-unit self-verification, adversarial parity checking, resumable and reversible - for the case where a migration is too large for one serial by-hand session. The P9 dashboard.tsx extraction (1344 -> 377 lines, verified pixel-identical) was the hand-done SMALL version; this is the fan-out version for the big ones: a framework swap, an API-deprecation sweep, a language/structure port, or a refactor spanning many files where the win is parallelism + independent verification + a clean rollback point.

The honest boundary (stated up front): Alex has no large migration waiting today. This project exists as a fireable capability, not a running job. Its value is "when a real target shows up," and it refuses to run without one.

## Entry Points
- On-demand ONLY: `/migrate {named target + scope}`. **Never scheduled.** Refuses to run on a vague or unnamed target.

## The hard preconditions (refuse to start without these)
1. **A named target + a target state.** What is migrating, from what, to what. "Modernize the code" is not a target; "port the #03/#14 n8n writer nodes from model X to Y across both engines, behavior-identical" is.
2. **A verification harness that defines the invariant.** Tests, renders, golden outputs, a parity diff - the objective thing that says "migrated unit still behaves." **A migration you cannot verify is not a migration, it is a rewrite you hope works.** If no harness exists, build or name one FIRST, or stop and say so.
3. **A rollback point.** A git branch off main (never migrate on main); per-unit checkpoints so a bad migration reverts cleanly.

## The workflow (dynamic-workflow / Agent fan-out)
1. **Scope.** Lock source state, target state, the invariant (behavior / pixel / test parity), and the verification harness. Document any known non-deterministic regions that will legitimately differ (the P9 precedent: 3 documented diff regions were expected and accepted).
2. **Plan.** Decompose into independent units (files / modules / workflows). Map dependencies -> the parallel-safe set vs the serial spine. Write the plan to disk.
3. **Fan out.** Agents migrate independent units in parallel; each verifies its own unit against the harness BEFORE reporting done, and checkpoints its result to `outputs/migration-engine/YYYY-MM-DD/partial/{unit}.json` (resumable).
4. **Adversarial verification.** A refuter/QA pass tries to prove the migrated units broke behavior - parity diff, injected edge cases, the honesty law - anchored in the verification harness output, never in vibes. Shared evidence-anchored discipline with #04's Adversarial Verification Mode and #23's /deep-audit.
5. **Converge.** Master integrates, runs the FULL harness, and produces a migration report: what migrated, the parity result (green/diff), residual documented diffs, the rollback point, and any unit that could not reach parity (flagged, not hidden).
6. **Deploy once, verified.** One deploy at the end. Any external mutation (n8n REST, a deployed surface, Task Scheduler) is followed IN THE SAME RUN by a read-back per the Verify-after-write standing order. "It returned 200" is not verification.

## Guardrails
- **No target, no run. No harness, no run.** Behavior parity is the gate, not agent confidence.
- **Branch off main, never migrate on main.** Per-unit checkpoints; resumable from disk; revertible.
- **Honesty law.** Report the real parity result. Never claim green while the harness is red; a unit that can't reach parity is a flagged finding, not a silent pass.
- **Verify-after-write** on every external mutation this run performs.
- Follows the standard build spine ([[me/build-playbook]]): layout -> design -> execution, render-and-look, review loop, verified deploy, full close-out.

## What it is NOT
- Not for small edits. A one-file refactor is a normal session; fanning out agents at it is waste. Rule of thumb: reach for `/migrate` only when the unit count is large enough that parallelism + independent verification actually pay for the overhead.
- Not a blind rewrite. No verification harness = stop.
- Not scheduled. Firing it is a deliberate, window-spending act (Max: it spends the usage window, no per-token dollars).

## Vault Structure
- Tier 1: vault/projects/migration-engine/status.md (state, candidate targets, first real fire when it happens).
- Tier 2: a per-migration report in outputs/migration-engine/YYYY-MM-DD/ (+ ledger row), and a vault/research or vault/projects note if the migration produced reusable knowledge.

## Connections
- **Reuses:** #04 research-team patterns (implementation-relay-plan-build-review, verification-qa-built-artifact) as the agent-team shapes; #23 /deep-audit + #04 verification mode for the adversarial discipline.
- **Precedent:** the P9 dashboard.tsx extraction (canonical small, hand-done, pixel-verified migration).
- **Candidate first targets (none committed):** n8n workflow-set consolidation/versioning across the active engines; an Alex HQ framework or structure migration; a docs/ or vault structure migration. First fire is Shaheen's call.

## Close-Out Extras
- Named target + verification harness + rollback point recorded before any unit is touched.
- Migration report written to outputs/ + ledger row; parity result stated honestly (green or the exact residual diff).
- Every external mutation read-back-verified (Verify-after-write); one verified deploy.

## Build status
- **2026-07-14:** built as a fireable on-demand capability from the dynamic-workflows build. Spec + command + registry entry + status page. No live run yet (ON-DEMAND, first_fire null by design; a first fire is a deliberate window-spend against a named target).

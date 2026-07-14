# /migrate - Migration Engine (dynamic-workflow fan-out)

Full spec: `work/27-migration-engine/CLAUDE.md` (read it first).

Run a real code/config migration as a dynamic workflow: parallel agents, per-unit self-verification, adversarial parity checking, resumable + reversible. For migrations too large for one serial by-hand session (a framework swap, an API-deprecation sweep, a big multi-file refactor). The P9 dashboard.tsx extraction was the hand-done small version; this is the fan-out version.

Usage: `/migrate {named target + scope}`. On-demand ONLY, **never scheduled.**

## Refuses to start without (hard preconditions)
1. A **named target + target state** (what, from what, to what). Refuses on a vague target.
2. A **verification harness** (tests / renders / golden outputs / parity diff). No harness = stop: a migration you can't verify is a rewrite you hope works.
3. A **rollback point** (branch off main, per-unit checkpoints).

## Before a run
On Max this spends the usage window. State the scope and window risk first. There is no large migration waiting today; this is fireable-when-a-target-shows-up.

## Steps (spec is authoritative)
1. Scope: lock source state, target state, the invariant (behavior/pixel/test parity), the harness; document expected non-deterministic diff regions (P9 precedent).
2. Plan: decompose into independent units, map dependencies -> parallel-safe set vs serial spine, plan to disk.
3. Fan out: agents migrate units in parallel; each verifies against the harness before reporting done; checkpoint each unit to disk (resumable).
4. Adversarial verification: refuters try to prove behavior broke, anchored in harness output not vibes.
5. Converge (master): integrate, run the full harness, migration report (what migrated, parity result, residual diffs, rollback point, any non-parity unit flagged).
6. Deploy once, verified: every external mutation read-back-verified (Verify-after-write).

## Guardrails
No target / no harness = no run. Branch off main. Honesty law (report real parity; never claim green on a red harness). Verify-after-write on every external mutation. Follows [[me/build-playbook]].

## Close-Out
Print the Close-Out Report. Migration extras: target + harness + rollback recorded before touching a unit; report to outputs/ + ledger row; parity stated honestly; external mutations verified; one verified deploy.

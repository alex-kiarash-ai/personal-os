# Outcome-Loop Activation Runbook (#03 + #14)

**Status: PRE-WRITTEN, NOT YET ARMED (upgrade #03/#14 Phase 1, 2026-07-25).**
This is the runbook to follow the day the outcome loop's winner gate clears. It exists NOW, before the
gate clears, so activation is a checklist and never an improvisation. Nothing here runs until the
condition in §1 is true.

## 0. Why this exists
The outcome loop (`scripts/alex-outcome-loop.js`) is the system's single genuine moat: it learns which
CV/cover variants actually draw responses. Today it is latent - it accumulates outcomes but has declared
no winner (see the `loop-status` line in the #10 weekly report). The built-ready writer block
(`work/03-application-engine/outcome-winners.block.md`) is OFF by design: injecting an empty or thin
block into production is pointless and risky. This runbook flips it ON safely when the evidence is real.

## 1. Activation condition (all must hold)
1. `node scripts/alex-outcome-loop.js loopstatus` reports **gate CLEARED** (a variant value has
   `resolved >= MIN_RESOLVED`, currently 5) AND at least one non-null `winner` in
   `vault/projects/job-pipeline/outcomes/winners.json`.
2. The 60-day honesty-rail day count is meaningful (`days_in_window` large enough that the resolved
   outcomes are not all from one burst). Judgment call, stated in the activation note.
3. Shaheen has seen the winner in a #10 report and not objected. The loop PROPOSES activation; the flip
   is a human-visible moment, not a silent auto-edit.

## 2. The flip (never hand-edit the n8n writer nodes)
The winner block is injected the same idempotent, backup-first, read-back-verified way the SOUL_VOICE
block is (module `scripts/lib/sync-n8n-voice.js`, run via `node scripts/generate-alex.js`):
1. Re-run `node scripts/alex-outcome-loop.js` so `outcome-winners.block.md` holds the current winners.
2. Set the activation flag the generator reads (add `meta.outcome_loop.active: true` to
   `system/manifest.json`; the sync module injects the block between `<<<OUTCOME_WINNERS_START>>>` /
   `<<<OUTCOME_WINNERS_END>>>` markers into the `Build Writer Request` node of BOTH engines
   `9XuIEfxS71DEetVR` + `9x9M3EnEEeX3O8dy`, exactly like the voice block).
3. `node scripts/generate-alex.js` -> backup-first PUT -> GET read-back verify the markers are present
   AND the workflow `active` flag survived (the 07-10 activation-drop lesson; V6/V13 posture).
4. An unchanged winners block is a verified no-op, so re-running is always safe.

## 3. The A/B guard (the honesty rail at the moment it matters most)
Declaring a winner is a causal claim: "this variant improves response rate." That claim survives contact
with reality only if it is measured against a control at activation. So for the **first 10 sends after
the flip**, winners apply to ALTERNATING applications:
- Deterministic split by application send-order counter (`meta.outcome_loop.ab_counter` in the manifest,
  incremented once per drafted application by the pipeline): **odd = winners-ON (treatment), even =
  winners-OFF (control)**. The Build Writer Request node reads the counter parity and includes or omits
  the winner block accordingly.
- Each of the 10 carries its arm (`treatment`/`control`) in its outcome row `note` so the loop can, once
  those 10 resolve, compare treatment vs control response rates directly.
- **Kill criterion:** if treatment does NOT beat control across the first 10 resolved, the winner claim
  failed its own test - set `meta.outcome_loop.active: false`, regenerate (block goes empty), and record
  the failure in the #10 report. The loop keeps accumulating; no winner is asserted on thin causation.
- After 10 clean sends where treatment >= control, drop the alternation and apply winners to all (still
  truthful: winners only ever *tilt* the writer toward proven patterns, never fabricate a claim to match
  one - the block header enforces this).

## 4. Rollback
Everything is git-reversible except the live n8n node, which is backup-first + read-back verified:
- `meta.outcome_loop.active: false` + `node scripts/generate-alex.js` empties the injected block.
- `git revert <sha>` on the manifest + block file restores the pre-activation state.
- The n8n node backup taken in step 2.3 restores the exact prior node if a PUT ever goes wrong.

## 5. Close-out on activation
Log to `vault/log.md`, update `vault/projects/job-pipeline/status.md` (activation date + the winner),
append a line to the plain-English guide 13.7 + master doc §11, and add a `first_fire`-style note that
the moat went live. The #10 report's `loop-status` line will then read "winner ACTIVE (A/B guard,
send N/10)".

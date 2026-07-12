---
class: decision-brief
created: 2026-07-11
last_used: 2026-07-11
times_used: 1
---
# Inventory -> Architect -> Debate (structure redesign decision)

## Question shape
"This part of my own system looks messy, should we restructure it or keep it?" Any change-or-keep decision about an owned structure (folder layout, schema, pipeline shape) where the evidence is INTERNAL (inventory of what exists) and the deliverable is a verdict with up/downsides vs the incumbent. Shaheen hand-specified this choreography (2026-07-11), same family as his gather-review-QC pipelines but with an options-architect middle and an eliminate-by-debate end.

## Team
- Output Cartographer (Explore): inventory the current state, declared vs actual, flag every inconsistency; map + flags ONLY, no conclusions. | tools: read-only repo | output: tables + numbered flags
- Senior AI Architect (general-purpose): given the verified map, propose EXACTLY 3 options, distinct in philosophy, each addressing the stated pain case + the named hard cases (retired items, shared artifacts, content classes, lookup axes, migration cost, breakage couplings, future-proofing). No ranking. | tools: read-only repo | output: 3 designs with structure sketch, retrieval story, Hcase handling, migration S/M/L, discipline cost
- Debater (general-purpose): steelman + attack each option against the owner's decision context (enforcement history, risk aversion classes, time budget), eliminate to ONE qualified option (amendments from losers allowed), then compare the winner head-to-head vs the CURRENT structure (up/downsides, cost line, risk table). No final verdict. | tools: read-only repo, may spot-verify claims | output: debate record + comparison
- Master (Alex, the session): reviews every hand-off against ground truth (manifest/registry), corrects before forwarding, synthesizes the final verdict. Recommendation only unless the owner pre-approved execution.

## Synthesis approach
Master owns the change-or-keep verdict. Weigh the debate against the house risk hierarchy (silent breakage > findability pain), state the minimal defensible alternative to the full verdict, and put the honest same-model caveat in the deliverable (internal evidence = structured self-review, not independent validation).

## Lessons
- Run 21 (outputs/ structure): worked first pass. Feeding the debater the owner's REAL constraints (backup whitelist lines, gitignore privacy scrub, enforcement incident history) is what made the elimination decisive instead of abstract; the debater spot-verified those claims in code, which killed two options on hard facts.
- Give agent 2 an explicit "one option SHOULD be keep-tree + add index" style nudge when the house has a known idiom (manifest-driven generation), but demand honest design of all three; the nudged option still has to win the debate on merits.

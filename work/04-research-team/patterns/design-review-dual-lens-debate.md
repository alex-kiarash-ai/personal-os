---
class: other
created: 2026-07-13
last_used: 2026-07-13
times_used: 1
---
# Design review, dual independent lenses + adversarial debate

## Question shape
"Review this UI/page/artifact in detail through multiple specialist lenses and give me a dev-ready
improvement plan." Owner dictates the choreography (Alex master + specialist agents + a debate that
concludes). Fits any shipped visual surface with a stated design goal to judge against.

## Team
- Agent 1 senior UX designer: detailed review of the RENDERED artifact (IA, hierarchy, glanceability vs the
  stated goal, interaction, mobile ergonomics, states, a11y) | tools: Read (screenshots + source), the
  target's spec | output: prioritized findings, each Problem -> Change -> Why + severity, plus a
  do-not-break list and open questions.
- Agent 2 senior UI designer: INDEPENDENT visual pass (never sees Agent 1) - brand adherence vs the law
  files, contrast with computed ratios, type system, spacing/grid, component states, motion | same output
  shape.
- Agent 3 debate agent: steelman then attack every finding from both reviews + the master's curation notes;
  resolve cross-lens conflicts with reasoning; kill/defer/merge; output a single ranked change set with
  effort, sequencing waves, and a QA gate per item. Proposes only.

## Synthesis approach
Master (Alex) between every hand-off: screenshot the LIVE page first (1440 + mobile + a drill-down; puppeteer
viewport emulation, basic-auth via page.authenticate) and READ the PNGs; spot-verify each review's
highest-stakes claims in source BEFORE the debate and pass them to the debate as facts; write curation notes
(keep / keep-with-reservations / weak + carry-ins); give the debate binding ground rules - settled owner
decisions, the honesty law (no fabricated correlation), the brand law file as color tiebreaker, honest
pricing of producer-side changes. Master owns the final verdict and writes the plan; owner-visible decisions
(law-file amendments, convention changes) get a dedicated block at the top of the plan.

## Lessons
- Independence between the lens passes is the value: run 25 got 4 convergent findings (stale values rendered
  bright, raw slugs, reduced-motion holes, numeral formatting) that neither prompt hinted at - instant
  highest-confidence tier.
- Reviews of a UI must see the rendered page; both agents pixel-grounded claims (a face-wash measured by
  pixel sampling, a fold measured in viewports) that source reading alone would have missed.
- The debate WILL ship tidy fabrications unless the honesty law is an explicit binding rule; it killed
  client-side incident-correlation and an invented "likely 1 incident" stat on that rule alone.
- Give the debate the convergence table and the mechanism forks by name; run 25's two forks (dim vs "?" for
  stale values; remove vs enrich a dead-end overlay) both resolved cleanly because they were posed as forks.
- Sequence structure before polish in the concluded set (fold rebuild + alarm-skin fix unlock and re-tune
  the cosmetic items) or the plan polishes surfaces twice.

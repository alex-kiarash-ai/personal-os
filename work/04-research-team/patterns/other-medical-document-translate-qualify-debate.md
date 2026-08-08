---
class: other
created: 2026-08-08
last_used: 2026-08-08
times_used: 2
---
# Medical document: translate -> qualify -> adversarial debate -> family-language deliverable

## Question shape
"Read this foreign-language medical document and tell my family what it means." A fixed
document (no external research), a lay audience in a second language, and a domain where a
confident wrong answer causes real harm. Retro-fitted 2026-08-08 after its second run; run 23
(2026-07-12, sister's e-Nabız panel) was the first and wrote no pattern.

## Team
Sequential, master-gated at every hand-off. No parallelism: each agent's value comes from
attacking the previous one's finished work.

- **Agent 1, translator + validator:** extract and translate every value, unit, reference
  range and printed flag. Compute an INDEPENDENT flag per row and report any disagreement
  with the lab's own. Verify absences by search. | tools: PyMuPDF, Python | output: complete
  analyte table + counts + unresolved items.
- **Agent 2, senior physician:** severity, what the abnormals mean TOGETHER, ranked
  differential, management with real intervals, red flags. | output: the report under attack.
- **Agent 3, adversarial:** rule on the master's binding challenges, audit Agent 2 point by
  point (AGREE / DISAGREE / AMEND with evidence), hunt what both missed, then RESOLVE into
  the final consolidated report in lay language. | output: the thing that ships.

## Synthesis approach
The master owns verification, not just routing:
1. **Extract the source YOURSELF, before Agent 1 runs.** Then diff. This converts Agent 1
   from an unchecked oracle into a second independent read. On run 43 they matched
   line-for-line across 43 analytes, which is what made the dataset trustworthy downstream.
2. **Recompute every arithmetic claim** each agent makes. Both runs had agents assert
   derived numbers; all verified, but the check is the point.
3. **Hand the adversary a real weapon.** Run 43's master found Agent 2 had chosen the
   flattering of two true framings (ferritin as "4.42x the floor" vs "15.6% up its band")
   and made it a binding challenge. An adversary given only "go attack this" produces
   theatre; one given a specific asymmetry produces a ruling.
4. **Master amendments are stated separately from the agents' verdicts**, never merged.

## Lessons
- **A printed lab flag is not automatically a patient finding.** Run 43: an "L" on IMG# was a
  reference-range configuration defect, provable from inside the document (the IMG# floor
  implied an IMG% floor 30x the same report's printed IMG% ceiling). Always test whether a
  flagged row contradicts another row of the same document.
- **The adversarial seat pays for itself in the differential, not the data.** Run 23 it added
  the celiac screen. Run 43 it caught a material clinical error: Agent 2 favoured *alpha*-thal
  carrier state then prescribed the *beta*-thal test and called it definitive. A single pass
  ships that.
- **Ask what free information exists before designing new tests.** Run 43's highest
  value-per-effort finding was "does an old blood count exist", which both earlier agents
  missed while planning elaborate future panels.
- **Cut pseudo-quantitative confidence.** "Roughly 1 in 10" beside traceable lab values
  borrows their credibility and traces to nothing. Ordinal words carry the same information
  honestly. Check that stated probabilities actually partition; run 43's did not.
- **A conditional does not survive translation.** "If the complaint was hair loss" becomes
  "the report says his hair is falling out". Never write a reconstructed symptom into a
  document a family keeps; ask them instead.
- **Split the verdict when one question hides two.** "Is the deficiency harming him today"
  (near-certain) and "can we prove stores are adequate" (one test short) deserve different
  confidences. Blending them understates the first and overstates the second.
- **Route the frightening detail to a doctor-facing appendix**, keep the symptom trigger in
  the family document. Naming a searchable disease the evidence disfavours buys anxiety and
  nothing else. Frame red flags as an instruction list that opens by stating none of it is
  present.
- **RTL build: wrap in LOGICAL order, shape each line only at draw time.** Reshaping a
  paragraph then letting the layout engine wrap it scrambles line order. Also: route any
  table cell containing Arabic through the Arabic font even if the column is nominally Latin,
  and wrap Latin tokens carrying `#`/`%` in an explicit LTR embedding (U+202A/U+202C) or bidi
  renders `IMG#` as `#IMG`. python-bidi rejects the modern U+2066 isolate.
- **Render the PDF and LOOK at every page.** Run 43's build exited 0 with two real defects on
  page 1. One low-resolution glance also produced a false positive, so zoom before ruling.
- **Privacy is part of the pattern.** Medical deliverables stay local: prove `git check-ignore`
  on the real paths, skip Notion deliberately, and delete compiled artifacts (`__pycache__`
  holds the content too).
- **State the no-web-search consequence in the claims table.** Clinical judgement here is
  model reasoning capped at `med`; guideline thresholds are recalled, not fetched. Say so.

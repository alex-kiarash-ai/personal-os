---
class: other
created: 2026-07-07
last_used: 2026-07-07
times_used: 1
---
# Document tailor: build -> domain-expert review -> QC

## Question shape
"Take my real source document (CV, profile, proposal) and restructure it for a specific audience brief (a recruiter's shopping list, a client's requirements), branded, with a hard no-invention rule." The brief drives the structure; the source document is the only permitted fact base (plus explicitly sanctioned additions from Shaheen).

## Team
- **Agent 1 Build:** restructure + draft against the brief; produce the artifact (self-contained HTML -> headless Chrome `--print-to-pdf`), self-verify the render (page count, clipping, keyword placement) before reporting. | tools: general-purpose, Write/Bash/Chrome | output: artifact paths + restructure map + judgment calls. Same agent takes the revision relay (SendMessage) after review.
- **Agent 2 Domain-expert reviewer:** the audience's seat (senior HR recruiter hiring for THIS role): 6-second skim, then 2-minute read; MUST-FIX vs NICE-TO-HAVE, each WHAT/WHERE/HOW, achievable from source material only; also verify ATS/parser text-layer extraction. | tools: general-purpose, Read | output: ordered feedback + "do not break" list.
- **Agent 3 QC + final judgment:** confirm every reviewer item addressed (re-verify item 5-style claims YOURSELF), then the client checklist item by item (prominence, headline, traceability of every number/name, sanctioned-addition accuracy, brand, layout), verdict READY or exact fix list. | tools: general-purpose, Read/Bash | output: PASS/FAIL table + verdict.

## Synthesis approach
Orchestrator runs the Brand + Soul pre-flight, pastes exact brand tokens + the FULL VERBATIM source into every prompt, validates Agent 2's feedback before relaying (strike false positives), relays revisions to Agent 1 via SendMessage (keeps roles clean), ships only on Agent 3 READY, then runs the advisory close-out grader.

## Lessons
- **Give reviewers the verbatim source, never a compressed excerpt.** Run 1: the session compressed the Menigo line in Agent 2's briefing; Agent 2 flagged the draft's (correct, source-true) line as an invention. Orchestrator caught it and voided the fix before relaying.
- Agent 2's ATS extraction check earned its slot: `position:relative` bullet markers made Chrome paint all bullet text AFTER flow text in the PDF content stream (chips/bullets detached from headers for any parser). Fix: normal-flow inline-block markers + text-indent hanging indent; DOM order = visual order = paint order.
- Real overclaim caught in review ("7+ years finance reporting" when the finance platform dates from 2021): reattach the years to what the source supports, keep the emphasis word first in the sentence.
- Glossing real named systems ("NetSuite (ERP)", "Adaptive (financial planning)") is a permitted clarification for non-technical screeners, not an invention.
- Spelling hedge for ATS: keep the brief's variant (modelling) in the headline zone, the source's variant (modeling) in Skills, so both live in the text layer.

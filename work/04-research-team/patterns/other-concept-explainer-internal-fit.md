---
class: other
created: 2026-08-27
last_used: 2026-08-27
times_used: 1
---
# Concept explainer plus internal fit

## Question shape
"Explain X and Y to me, I am not technical, then tell me what they mean for MY system and what to do about it." Two halves that most relays get wrong by doing only one: an EXTERNAL sweep of a thing the owner has heard of, and an INTERNAL audit of what the owner already has. The deliverable teaches AND recommends, for a reader who will not read a second document.

Distinct from `technical-evaluation-tool-scout-review-qc` (which picks a tool) and from `technical-evaluation-aspect-fan-reconcile` (which assesses an external system aspect by aspect). Here the subject is a CONCEPT, not a product, and the owner's own system is the second subject.

## Team
Four parallel lanes plus the master as synthesizer. Lanes are independent by construction, so they fan out in one block.

- **L1 code scout:** what people actually BUILT. `gh search repos` seeded from a curated awesome-list, then searched independently so the list's editorial choices do not bound the answer. | tools: gh, Jina | output: tables of repo / one plain sentence / stars / last-updated / URL, plus an "ideas worth stealing" list written for a non-technical reader.
- **L2 practitioner scout:** what people SAY, including the complaints. Reddit and X are login-walled, so this rides claude-in-chrome on the owner's real session, with a named Exa fallback that must be LABELLED per row if used. | output: verbatim quotes with permalinks and dates. The complaints section matters more than the enthusiasm section and the mission must say so.
- **L3 open-web scout:** provenance, governance, adoption, and THE CRITIQUES. | tools: Exa to find, Jina to read | output: primary sources with dates, vendor claims labelled as vendor claims.
- **L4 internal auditor:** what the owner already has that IS this thing under another name. | tools: Explore, read-only | output: five fixed questions answered with `file:line` anchors, plus a seams section.
- **Master:** specs FIRST (via Context7 or the primary source) so the sweep has a yardstick, then synthesis, then the document.

## Synthesis approach
1. **Read the specification before the sweep.** A forum opinion checked against the protocol is evidence; a forum opinion standing alone becomes the source by default.
2. **Re-derive the decisive claim personally.** The claim under the TOP recommendation gets checked by the master, not accepted from a lane. On run 48 this reversed the top recommendation in two lookups.
3. **Convergence tiering.** A finding two lanes reached from independent evidence bases is the top confidence tier.
4. **The internal audit is the emotional core.** The owner usually already does a version of the thing. Lead with that, because it converts an abstract standard into something they can see.
5. **Answer "does this apply to me" as explicit numbered tests**, and let a test fail in public. A report where everything applies is a sales brochure.

## Lessons
- **Re-derivation beat the lane.** A community node that looks perfect on GitHub may not be installable: check the actual distribution channel (npm, marketplace) and not just the repo. Also check for acronym collisions, since `n8n-nodes-a2a` on npm is a banking package.
- **A page-count assertion is not optional for a fixed-page-size document.** The first render silently produced 22 pages from 15 `.page` divs because seven overflowed A4 and split. Fold an overflow probe into the build script so it is measured every render.
- **Four diagrams sharing ONE visual grammar teach more than four good unrelated diagrams.** Fix the shape vocabulary (box does work, pill holds data, solid arrow requests, dashed returns) on diagram 1, reuse it, and make the last diagram the previous one with exactly one element changed so the delta is the only thing that moves.
- **Widening a figure makes it taller.** Pulling figures into the page margins for legibility re-broke pagination twice; change figure width and re-run the overflow probe in the same step.
- **Sentence rhythm is the hardest house-style rule to hit** and the only one that needed two passes. Report the residual number rather than claiming compliance.

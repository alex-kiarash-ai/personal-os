---
class: other
created: 2026-07-10
last_used: 2026-07-10
times_used: 1
---
# Deck rebuild: content -> design -> QC relay

## Question shape
"Rebuild this existing deck per my page-by-page feedback: keep the approved visual language, replace most copy, keep/adapt/new per graphic, fix readability, deliver in N formats." An implementation relay (document-tailor family), not research: the spec is law, the master maps it to sources and gates every handoff.

## Team
- Senior Presentation Builder (content): reviews every word, applies the per-page spec, polishes for punch while preserving meaning, drafts the few lines the spec delegates | tools: Read/Write | output: a per-page copy doc (kicker, headline with accent phrase marked, ordered body lines, EXACT diagram label strings, keep/adapt/new note per graphic)
- Senior UX Designer: builds the deliverable (here: single-file React HTML, animated canvas background, static render mode `?slide=N&static=1`), places copy verbatim, builds new diagrams in the deck's idiom, bumps type 1-2 steps, renders EVERY slide and self-reviews the PNGs | tools: Read/Write/PowerShell + headless Chrome | output: the deck + renders + a decisions report
- Quality Check: word-for-word copy diff vs the copy doc, dash law, brand hex scan, headless integrity both modes, legibility eyeball, then builds the second format (image-per-slide pptx from fresh scale-2 renders) and cleans outputs/ | output: QA table + final deliverables

## Synthesis approach
Master agent reviews at every handoff (reads the copy doc line by line; personally views all slide renders) and only then passes forward. Separate-context close-out grader runs on the final artifact. Brand pre-flight runs FIRST and exact tokens are pasted into the designer's and QA's prompts.

## Lessons
- MAP BEFORE BUILDING: the brief's stated source path was the wrong deck (a 15-slide business deck); the per-page spec actually matched a different 12-slide deck title-for-title. Verify every "keep this graphic" note exists in the claimed source before accepting the mapping; resolve loudly, never guess silently.
- Copy in rendered decks may live in a JSON blob on one huge line (`window.__ALEXDECK__`), and pptx exports may be image-only (no text layer) - extract pptx media or read the blob instead of trusting greps.
- Making the CSS base state the animation END state (animations only under `body:not(.static)`) guarantees static screenshots can never catch a mid-flight frame.
- Font-size floor that survived the eyeball test at 1920x1080: body 21-22px, diagram labels 19-22px, captions 17px.

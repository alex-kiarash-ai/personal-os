# Research Team

## Type
Automation (on-demand, adaptive multi-agent)

## Purpose
An adaptive research system that designs its own team per question. Given a research question, it: analyzes the question type, checks patterns/ for a reusable team architecture from past research, designs (or reuses) the right agent team, shows the design for approval, executes with parallel sub-agents, synthesizes, saves findings to the vault and Notion, asks "Claude Design deck or PDF?", and ships a branded deliverable. The team is never fixed; the question shapes it.

## Entry Points
- On-demand only: `/research-team {question}` or "research {topic}". NOT scheduled.

## Tools Used
- Agent tool (sub-agents: Explore for breadth, general-purpose for deep dives)
- WebSearch + WebFetch (load via ToolSearch first)
- Chrome only for sites that block plain fetch (deep scraping; never for Gmail/Calendar/Notion)
- Python (data analysis, charts) - via Bash, cleanup after
- Notion MCP: notion-search (internal context), notion-create-pages (research page under Personal Ops System parent)
- **Claude Design (DesignSync) for branded decks** (standing rule 2026-06-15; NOT /pptx), /xlsx skill (data tables), Python/reportlab (standalone PDF)

## The Runtime Flow (executed by Claude Code per run)
1. **Analyze the question.** Classify: market-scan | competitor-deep-dive | technical-evaluation | decision-brief | person-or-company-profile | other. Identify what evidence would settle it.
2. **Check patterns/.** Read work/04-research-team/patterns/index.md. If a pattern matches the question class, load it and adapt; note "reusing pattern {name}".
3. **Design the team.** 2-5 sub-agents max, each with: name, one-sentence mission, tools, expected output. Parallel where independent. One synthesizer (the main session) - sub-agents report, they do not conclude.
4. **Approval gate.** Show the design via AskUserQuestion: approve / modify / answer-without-team (for questions too small for a team). Do NOT spawn agents before approval - sub-agents are the expensive path.
5. **Execute.** Spawn approved sub-agents (parallel calls in one block where independent). Each returns findings + sources. **Timebox every lane:** each sub-agent's mission includes "if reasonable effort turns up nothing, report 'nothing found' with what was tried; do not keep digging." A lane that comes back empty is a finding, not a failure. Never re-spawn an agent to retry an empty lane without a changed approach.
6. **Synthesize.** Main session writes the answer: findings first, confidence levels, what's unknown stays unknown. Alex voice, no padding.
7. **Save knowledge.** vault/research/{topic-slug}.md (concise findings, key insights, sources, [[wiki links]]). Notion page "Research: {topic}" under the Personal Ops System parent (ID in vault/projects/notion-parent-id.md) with the full findings as content.
8. **Save the pattern.** If the team design was new or meaningfully adapted: write patterns/{class}-{slug}.md (see Pattern Format) and update patterns/index.md.
9. **Deliverable (team runs only).** If the run went through the answer-without-team path, the vault page + Notion page IS the deliverable - do not build a file for a two-paragraph answer. For team runs, ask via AskUserQuestion: "Claude Design deck or PDF?" Then:
   - **Deck → Claude Design (DesignSync)** (standing rule 2026-06-15): build on claude.ai/design as a design-system deck, slides as components one at a time (finalize_plan → write_files), branded from brand/config/brand-config.md (ALEX brand: #001219 canvas, #005f73 + #0a9396 teal structure, one #ee9b00 accent, Calibri, ALEX logo block), then export PDF. NOT /pptx (no native .pptx).
   - PDF → Python reportlab/weasyprint, brand colors + fonts, dark teal header bar with the ALEX logo block
   - Save the exported PDF (and note the claude.ai/design project link) to outputs/research-team/YYYY-MM-DD/. Delete ALL build scripts and temp dirs after. Team-run deliverables are always branded, never just markdown.

## Pattern Format (patterns/{class}-{slug}.md)
```
---
class: market-scan | competitor-deep-dive | technical-evaluation | decision-brief | profile | other
created: YYYY-MM-DD
last_used: YYYY-MM-DD
times_used: N
---
# {Pattern name}
## Question shape
{What kind of question this fits}
## Team
- {agent name}: {mission} | tools: {list} | output: {what it returns}
## Synthesis approach
{How findings get combined}
## Lessons
{What worked, what to change next time}
```
patterns/index.md lists every pattern: name, class, times_used, one-line description.

## Notion Integration
No new database. One page per research run under the Personal Ops System parent page (`37bb5342-d7f1-81a4-8bf1-d5642d7c3e85`), titled "Research: {topic}", full findings as page content. notion-search before researching: internal docs may already answer part of the question.

## Vault Structure
- Tier 1: vault/projects/research-team/status.md (last run, run count, recent topics, output paths)
- Tier 2: vault/research/{topic-slug}.md (one page per research output - this IS the knowledge)
- Patterns live in work/04-research-team/patterns/ (architecture = config, not knowledge)

## Vault Reads
- soul.md (voice + priorities: research serving job hunt or the Alex product outranks curiosities)
- vault/research/ (don't re-research what's answered; link instead)
- vault/business/ (market/competitor context). NOTE: vault/business/competitors/ is fed by Market Pulse, which is NOT BUILT yet - if absent, skip gracefully, never error.
- vault/people/, vault/projects/ for context on names that appear

## Vault Writes
- vault/research/{topic-slug}.md per run
- vault/business/ and vault/people/ pages for new companies/people found (post-run ingestion)
- status.md refresh, vault/log.md entry, vault/index.md for new research pages

## Connections
- Fed by: Market Pulse (vault/business/competitors/) once built; Notion internal docs.
- Feeds into: vault/research/ (consumed by everything), Alex-product decisions, job-hunt targeting.

## Post-Run (mandatory)
1. vault/people/ pages for new people
2. vault/business/ pages for new companies
3. [[wiki links]] across research, people, business pages
4. Notion research page created
5. vault/index.md + vault/log.md updated
6. Sprint board: marked Done at build (2026-06-10); rows never re-touched per run

## Implementation Notes (as built, 2026-06-10)
- Built as spec + command + pattern library scaffold. No live run yet (on-demand; first question starts the pattern library for real).
- patterns/ seeded with index.md and the format spec only - no padding with invented patterns.
- Guardrails carried from soul.md: no invented facts (unknown stays "unknown"), no model-verifier chains - sub-agents gather, deterministic checks + one synthesizer conclude.

## Adversarial Verification Mode (evidence-anchored refutation, added 2026-07-14, dynamic-workflows build)
The default flow gathers external evidence and lets the synthesizer (Alex) conclude. That is the right shape for "what is true out there" and the WRONG shape for "is THIS conclusion right" (see What this is NOT). This mode is the sanctioned way to stress-test a claim Alex or Shaheen already holds, without consensus laundering. It is the on-demand, single-claim sibling of #23's `/deep-audit` (same refutation discipline, pointed at one claim instead of the whole repo).

Invoke: `/research-team verify: {claim}` (or "stress-test / red-team {claim}"). The claim is the thing on trial, not a topic to research.

What makes it a real check and not a same-model echo:
1. **Isolate the claim.** The master (or a first agent) extracts the exact falsifiable statement + the load-bearing assumptions under it. A claim too vague to be shown false gets sharpened, or the run stops and says so. You cannot refute a fog.
2. **Refutation mandate, not a research mandate.** Each refuter's job is to DISPROVE the claim from one distinct angle. "Found nothing wrong" is the lane failing, not the claim passing. Minimum two refuters on independent angles.
3. **Every attack is anchored in external evidence.** A refuter must ground its case in something outside this model (web evidence, a document, data, a recomputation), not model reasoning alone. This is the whole mechanism: dissent that could be wrong the same way Alex is wrong proves nothing; dissent anchored in an external fact does. A lane that can only argue from reasoning reports "no external disconfirming evidence found" and that verdict is flagged as weak.
4. **A steelman defender** argues FOR the claim, also evidence-anchored, so it is a debate and not a pile-on. Optional on simple claims.
5. **Converge or surface the split.** A convergence judge reads every lane and returns CONFIRMED (refuters found no surviving external disconfirming evidence and the defender's evidence holds), REFUTED (a refuter produced disconfirming evidence that survives), or UNRESOLVED (genuine evidence-backed disagreement). The judge NEVER averages a split into a false middle.
6. **The honesty law binds the debate.** (Carried from the design-review-dual-lens + pitch-adversarial lessons: an unbound debate ships tidy fabrications.) Every claimed fact traces to a source; recompute contested numbers; unknown stays unknown; a refuter may not invent a weakness to look useful.

Master's job here: it does NOT get to dissolve an UNRESOLVED verdict to look decisive. It reports the verdict, the disconfirming evidence, and the residual disagreement, then gives Shaheen its own read SEPARATELY and labelled as such. The verdict belongs to the workflow; the opinion belongs to Alex; they are never merged. First real run writes the `verification-claim-refutation` pattern to patterns/ (patterns earn their file by use, not by being imagined).

## What this is NOT
The default flow is a real research tool because its evidence is external. It is NOT, by default, a validator of Alex's own reasoning: same model, hub-and-spoke authority, and the synthesizer is the same Alex being checked. Treating default-flow agent agreement as corroboration of an Alex conclusion is consensus laundering, and stays banned. The one sanctioned way to check an Alex conclusion here is Adversarial Verification Mode (above), and it works ONLY because the verdict rides on external disconfirming evidence the refuters did or did not find, never on agent agreement. If a verification run reaches CONFIRMED without a single lane anchoring in an external fact, that is consensus laundering in a debate costume: discard it.

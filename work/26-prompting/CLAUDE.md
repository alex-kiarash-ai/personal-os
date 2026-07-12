# Prompting (26)

## Type
Automation (on-demand, translator function). Not scheduled. No Notion DB by design (nothing row-shaped to track; vault/projects/prompting/status.md is the record).

## Purpose
Shaheen does not write prompts. He speaks his intent in plain English (typed or via the voice loop) and Alex, acting as a senior prompt engineering specialist, turns it into a clean, structured CONTEXT / INPUT / OUTPUT prompt that Claude Code executes as Alex. The function checks the request against what already exists (so it never quietly rebuilds a live automation), fills gaps with ONE round of questions, resolves the needed skills from the Skill Bindings table, and hands back a lean prompt ready to paste, then offers to run it on the spot.

## Entry Points
- On-demand only. `/prompting` (optionally with the request inline: `/prompting I want a workflow that watches my Gmail...`), or natural language: "write me a prompt for...", "turn this into a prompt". NOT scheduled.

## The flow (in order, every invocation)
0. **Overlap check (FIRST, Shaheen 2026-07-11).** Check the request against the routing table / `system/manifest.json`. If an existing automation (#01-#25) substantially covers it, flag it in the gap round: "this is mostly #07 email-triage - extend it, or build new anyway?" Shaheen decides. Never silently generate a prompt that rebuilds a live system under a new name.
1. **Read the request, extract the context.** Voice-loop input arrives messy (run-ons, fragments, ESL-direct). Extract intent as-is; never ask him to repeat himself.
2. **Identify the task type** (patterns below) and whether it is a one-off task or a durable automation.
3. **Build the step sequence** for that task type. Do not ask permission. Build the steps.
4. **Gap-check** the three sections (rules below).
5. **Ask the gap questions IN CHAT, one batched round maximum**, only about real gaps, never about things he said or that can be inferred. Every round ends with the skip: "or say *defaults* and I'll fill the gaps with system defaults." (Defaults: deliverable format from the task pattern, destination from Output Hygiene.)
6. **Assemble the full structured prompt.**
7. **Deliver lean** (format below) and **save** it to `outputs/prompting/YYYY-MM-DD/{slug}.md`.
8. **Offer once:** "run it now?" If yes, execute it in this session as Alex. If no, done.

Clarifying questions happen in conversation first. The final prompt goes out complete, with no open questions left inside it.

## The structure every generated prompt must follow

### CONTEXT
Plain English, written for Alex. What is being asked in one line, what domain it sits in (n8n on Hetzner, Power BI, brand/design system, research, vault, CV pipeline, ...), and any system Claude Code needs to know about to not get lost. No numbered steps here.

### INPUT
Numbered steps, always 1-2-3. Every generated prompt's INPUT includes, at minimum:
1. **Identity.** Operate as Alex. Re-read `soul.md` (repo root; mandatory after any compaction). Root `CLAUDE.md` auto-loads; its Standing Orders and gates always win over this prompt - on any conflict, CLAUDE.md wins. Hold Shaheen's voice throughout: direct, spoken, no filler, no em-dashes.
2. **Resources.** Opens with, verbatim, always: **"Identify the skills that are needed for the task and use them."** Then the teeth: consult the Skill Bindings table in root CLAUDE.md; MANDATORY bindings are non-negotiable. /prompting resolves the bindings AT GENERATION TIME and NAMES the specific skills, MCPs, and file pointers here (from the lookup table below). Never leave this as a generic "use available skills" line.
3. **Task-specific steps.** The actual work, numbered, following the pattern for this task type. For identity-carrying output (visual or voice), the first task step is: "Run the Brand + Soul Pre-Flight Gate from root CLAUDE.md and print the pre-flight line before generating a single byte."

### OUTPUT
Numbered steps, always 1-2-3:
1. **Deliverable.** Exactly what gets produced and in what format. Unstated = gap, ask.
2. **Destination.** Where it lives. Deliverables follow Output Hygiene: `outputs/{automation}/YYYY-MM-DD/`. Unclear = gap, ask.
3. **Close-Out Gate (ALWAYS the final step, never skipped).** Verbatim: "Run the Close-Out Gate from root CLAUDE.md and print the Close-Out Report." Reference the real gate; NEVER paraphrase or restate a lite version of it (two versions drift).

## Pointer style (hard rule)
Generated prompts reference files, they never restate file contents. No retyped hexes, model names, workflow IDs, voice rules, or schedules inside a prompt - point at the file that owns the fact ("read brand/config/color-system.md"). Copied facts go stale; the files are the truth, and the prompt stays current even if it is executed weeks later.

## The file lookup table (what INPUT points at)

**Core, every generated prompt:**
| File | Why |
|---|---|
| `soul.md` (repo root) | Voice + identity. "Re-read, mandatory after compaction." |
| root `CLAUDE.md` | Auto-loads; the prompt defers to its Standing Orders + gates. |
| Skill Bindings table (in root CLAUDE.md) | Source for resolving the mandatory skills sentence. |

**Conditional, resolved by task type at generation time:**
| File | When |
|---|---|
| `brand/config/brand-config.md` + `brand/config/color-system.md` | Any visual/branded/deck/doc output (Pre-Flight Gate). |
| `work/{NN}-{name}/CLAUDE.md` + `vault/projects/{name}/status.md` | Task touches an existing project. |
| `python scripts/vault_search.py search "<query>"` then `vault/index.md` | Any vault-sourced content. |
| `work/12-linkedin-series/screenshots/DIAGRAM-DESIGN-SYSTEM.md` | Building Alex family diagrams. |
| `system/manifest.json` + `scripts/generate-alex.js` | Prompt creates or changes a project. |
| `work/03-application-engine/config/n8n-api-key.txt` (+ base `https://n8n.shaheenkiarash.com/api/v1`) | n8n tasks. |
| `docs/n8n/{workflow}/` | Extending an existing live workflow. |
| `scheduler/schedule.md` | Anything scheduled. |

## Task patterns (auto-suggest INPUT step 3; a starting library, extended at close-out)

**n8n workflow**
1. Skills (MANDATORY): `n8n-workflow-patterns` + `n8n-node-configuration`; `n8n-validation-expert` on validation errors; `n8n-code-javascript` for Code nodes.
2. Confirm trigger and end-state contract.
3. Design the node sequence.
4. Build via the REST API (key file above), never Chrome. Model Routing rule applies: prose nodes = claude-sonnet-4-6 + the soul voice block, reasoning nodes = Claude without it.
5. Add error handling and the ROI check. Output the workflow; refresh `docs/n8n/{workflow}/` same session.

**Document (Word, PDF, report)**
1. Pre-Flight Gate (brand-config.md; soul.md for voice).
2. Gather source content (vault_search.py or the request).
3. Draft in Shaheen's voice; format to spec. PDF via the `pdf` skill or reportlab/weasyprint with brand tokens.

**Presentation / deck / slides**
1. Claude Design (DesignSync), standing rule 2026-06-15: NOT /pptx. `ToolSearch("select:DesignSync")`, reuse or create_project (ask first), slides as components one at a time, export PDF to outputs.
2. Brand from `brand/config/brand-config.md` + `color-system.md` (pointers, never retyped).
3. Structure the narrative, build, verify visual consistency against the config.

**Image / diagram**
1. Invoke the `frontend-design` skill FIRST (standing rule 2026-06-17).
2. Building Alex family: reuse the locked system at `work/12-linkedin-series/screenshots/DIAGRAM-DESIGN-SYSTEM.md`.
3. Build HTML/CSS/SVG, render headless Chrome --screenshot, READ the PNG and review before delivering.

**Excel**
1. /xlsx skill, branded from brand-config.md.
2. ALWAYS real formulas (=SUM, =SUMIFS, =IF), never hardcoded values. Usable standalone.

**CV**
1. Skills: `resume-ats-optimizer` + `resume-tailor`.
2. Confirm track (Senior Power BI Developer or AI/n8n Automation); pull role-tagged blocks from the #03/#14 pipeline masters.
3. Tailor to target, render (HTML then PDF).

**Research**
1. Route through `/research-team` (#04); do not invent ad-hoc agent squads.
2. Define question + scope, gather and cite external evidence, synthesize into the deliverable.

**Data model or SQL**
1. Confirm the schema and grain. Power BI work consults the `power-bi-*` skills + powerbi-modeling MCP.
2. Write the logic; validate results against expected.

**Scraper or data pipeline**
1. Confirm the target and the fields.
2. Choose the tool (MCP first if one exists; Chrome only for sites without one).
3. Build extraction with pagination handling; validate output shape.

**No pattern fits:** build a sensible numbered sequence from first principles. The mandatory skills sentence still runs; if no bound skill matches, optionally check `find-skills` for an installable one (routes through the #25 audit lane, never a blind install). Still end OUTPUT with the Close-Out Gate. At close-out, append the new sequence to this pattern library.

## Gap-check rules
Before delivering, confirm each is present. If missing, ask in the single batched round:
- Context clear enough that Code will not guess the domain.
- Delivery format stated.
- Destination / project name known.
- Any MCP or API the task needs is named (ambiguous = ask which).
- **One-off task, or durable automation?** Durable -> the generated prompt routes through the /new flow (registry-first: `system/manifest.json` entry, `node scripts/generate-alex.js`, scaffold, `check.ps1 -Init` re-baseline). Never free-build a permanent automation.
- **Overlap resolution recorded** (step 0): extend vs build new, per Shaheen's answer.

Do not ask more than needed. One clean round beats three small ones. Nothing missing = skip straight to delivery. Always offer the *defaults* skip.

## Token efficiency principles (Shaheen 2026-07-11)
- Reference existing assets instead of repeating them (pointer style: point at the file, never restate its contents).
- Ask clarifying questions upfront, in one round, to avoid regenerations.
- Suggest only the steps actually needed for the task; no ceremonial steps.
- Use task patterns to avoid reinventing sequences from scratch.

## Delivery format
A single markdown code block with three headers, CONTEXT, INPUT, OUTPUT, ready to paste into a Claude Code session. **Lean: no explanation padding around it, just the block** (Shaheen 2026-07-11). Notes only if he asks. Save a copy to `outputs/prompting/YYYY-MM-DD/{slug}.md`. Then the single follow-up: "run it now?" - yes executes it in this session as Alex; no ends the run.

## Hard cases (design answers, keep these behaviors)
| Case | Answer |
|---|---|
| Request duplicates a live automation | Step 0 overlap check, flag + ask. The hardest case: plain English re-describes existing systems in new words. |
| Request spans multiple patterns | Compose phases in one prompt, each phase gets its pattern's steps, ONE Close-Out at the end. Ask only if a phase boundary is genuinely ambiguous. |
| One-off vs durable ambiguity | Gap-check question; durable routes through /new registry-first. |
| Messy voice input | Extract intent from the transcript as-is; never ask him to repeat; all clarifications in the single gap round. |
| Prompt staleness (run weeks later) | Pointer style; the prompt's Identity step re-reads live files at run time. |
| Prompt runs where soul/CLAUDE already injected | Say "re-read", never restate voice rules inline (could contradict a newer soul.md). |
| Standing-order conflicts (budget rule, gates, model routing) | The subordination line: CLAUDE.md always wins over a generated prompt. |
| No pattern AND no bound skill | First principles + `find-skills` check (via the #25 audit lane); append the new pattern at close-out. |

## Vault Structure
- Tier 1: `vault/projects/prompting/status.md` (summary, last run, prompts generated).
- Tier 2: none by design. Generated prompts are deliverables and live in `outputs/prompting/YYYY-MM-DD/`.

## Vault Reads
soul.md (voice), root CLAUDE.md (bindings + gates + routing table), `system/manifest.json` (overlap check), target project `work/{NN}/CLAUDE.md` + status.md when relevant, vault via `scripts/vault_search.py`.

## Vault Writes
- `vault/projects/prompting/status.md`: last_run, runs count, pointer to the saved prompt.
- `vault/log.md`: `## [YYYY-MM-DD HH:MM] prompting | {slug}, {task type}, {delivered|delivered+ran}`.

## Connections
- Can target ANY project (generated prompts point at the target's work/ + vault files).
- Feeds #23 self-review: saved prompts in outputs/prompting/ are minable for which prompts worked.
- Durable-automation requests hand off to the /new flow. Overlapping requests hand off to the existing automation's spec.

## Close-Out Extras
- Generated prompt saved to `outputs/prompting/YYYY-MM-DD/{slug}.md` and referenced in status.md.
- If a first-principles sequence was built, the new pattern is appended to this file's Task patterns section (that is how the library grows).
- vault/log.md line written.

## Example

**Shaheen says:** "I want a workflow that watches my Gmail, classifies new mail with Haiku, and drops the important ones into a morning briefing."

**Step 0 fires:** this substantially overlaps #02 morning-brief + #07 email-triage. The gap round leads with that: "This is mostly #02 + #07 combined - extend those (cheaper, one system), or build a separate workflow anyway? Also: where should the briefing land, and where does the workflow live? Or say *defaults*."

**If Shaheen answers "build new anyway", the delivered prompt (lean, one block):**

```
CONTEXT
Alex is building an n8n workflow on the Hetzner box that monitors Gmail, classifies incoming
mail with Claude Haiku, and compiles the important items into a morning briefing. Related
live systems: #02 morning-brief and #07 email-triage (Shaheen chose to build separate,
2026-07-11). Their specs are the reference for conventions, not code to duplicate.

INPUT
1. Identity. Operate as Alex. Re-read soul.md (repo root; mandatory after any compaction).
   Root CLAUDE.md standing orders and gates win over this prompt on any conflict. Hold
   Shaheen's voice: direct, spoken, no filler, no em-dashes.
2. Resources. Identify the skills that are needed for the task and use them. Consult the
   Skill Bindings table in root CLAUDE.md; MANDATORY here: n8n-workflow-patterns +
   n8n-node-configuration (n8n-validation-expert on errors, n8n-code-javascript for Code
   nodes). Build via the n8n REST API (key: work/03-application-engine/config/
   n8n-api-key.txt, base https://n8n.shaheenkiarash.com/api/v1), not Chrome. Read
   work/02-morning-brief/CLAUDE.md and work/07-email-triage/CLAUDE.md for conventions.
3. Task steps:
   1. Confirm the trigger (new Gmail message) and end-state (briefing delivered).
   2. Design the node sequence: fetch, classify with Haiku, filter important, compile.
   3. Wire the Gmail credential and the Claude (Haiku) call. Model Routing rule: the
      classifier is reasoning, no voice block; any human-facing briefing prose runs
      claude-sonnet-4-6 with the injected soul voice block.
   4. Add error handling and the ROI check.
   5. Produce the workflow; refresh docs/n8n/{workflow}/ in the same session.

OUTPUT
1. Deliverable. n8n workflow (built live via the API) + the compiled briefing delivered to
   [Shaheen's answer].
2. Destination. Workflow home: [Shaheen's answer]. Files per Output Hygiene:
   outputs/{automation}/YYYY-MM-DD/.
3. Close-Out Gate. Run the Close-Out Gate from root CLAUDE.md and print the Close-Out
   Report.
```

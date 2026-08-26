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
   **Scope (added 2026-07-28, Opus 5 guidance).** Every generated Identity step carries this, verbatim or close to it: "Deliver this task at the scope asked. Make routine judgment calls yourself; check in only where different readings lead to materially different work. If the request looks mistaken or a better approach exists, say so in one sentence and continue as asked, rather than quietly narrowing, widening, or transforming it. Finish the whole task, and stop short of actions clearly beyond it. The standing gates in CLAUDE.md are not scope creep; they still run." The last sentence is load-bearing: without it the scope line reads as permission to skip Close-Out. Opus 5 expands scope on its own, and this constitution is a scope amplifier (Change Propagation spans 8 file classes, Close-Out B adds more, Activity Capture and People Intake fire unprompted), so a narrow one-off needs the boundary stated.
2. **Resources.** Opens with, verbatim, always: **"Identify the skills that are needed for the task and use them."** Then the teeth: consult the Skill Bindings table in root CLAUDE.md; MANDATORY bindings are non-negotiable. /prompting resolves the bindings AT GENERATION TIME and NAMES the specific skills, MCPs, and file pointers here (from the lookup table below). Never leave this as a generic "use available skills" line.
   **Delegation (added 2026-07-28, Opus 5 guidance).** Opus 5 delegates readily, and delegation multiplies cost and time when it lands on small work. Every generated Resources step bounds it: "Delegate only to genuinely independent, sizeable parallel tracks. Research goes through /research-team (#04), never an ad-hoc squad. Never a subagent to verify or double-check work already done." **Exception, and it is the common case here:** when Shaheen dictates the relay himself (Agent 1 / Agent 2 / Agent 3 with named roles and handoffs), that IS the spec - build it as he said, cold-context subagents and all, and the cap does not apply.
3. **Task-specific steps.** The actual work, numbered, following the pattern for this task type. For identity-carrying output (visual or voice), the first task step is: "Run the Brand + Soul Pre-Flight Gate from root CLAUDE.md and print the pre-flight line before generating a single byte."

### OUTPUT
Numbered steps, always 1-2-3:
1. **Deliverable.** Exactly what gets produced and in what format. Unstated = gap, ask. **State the length too (added 2026-07-28, Opus 5 guidance):** "Match the length to what the task needs: cover the substance, no filler sections, no redundant summaries, no boilerplate." Where a real band exists, NAME it (LinkedIn ~150 words per work/12, a CV's page count, a one-page brief). Opus 5 writes longer files to disk than earlier models, and Shaheen calibrates length by hand when it runs long (soul.md My Words: "make it simple, short, not very short, but short"; "lean, no unnecessary explanation padding") - this line is that preference encoded once, instead of him correcting it every time.
2. **Destination.** Where it lives. Deliverables follow Output Hygiene: `outputs/{automation}/YYYY-MM-DD/`. Unclear = gap, ask.
3. **Close-Out Gate (ALWAYS the final step, never skipped).** Verbatim: "Run the Close-Out Gate from root CLAUDE.md and print the Close-Out Report." Reference the real gate; NEVER paraphrase or restate a lite version of it (two versions drift).

## Pointer style (hard rule)
Generated prompts reference files, they never restate file contents. No retyped hexes, model names, workflow IDs, voice rules, or schedules inside a prompt - point at the file that owns the fact ("read brand/config/color-system.md"). Copied facts go stale; the files are the truth, and the prompt stays current even if it is executed weeks later.

## Verification hygiene (hard rule, added 2026-07-28 from the Opus 5 prompting guide)

Generated prompts NEVER carry a generic verification step: no "verify your work", no "double-check before responding", no "re-verify", no "use a subagent to verify". Opus 5 already catches and fixes its own mistakes; a blanket instruction stacks on top of that behavior, causes over-verification, and burns tokens with no gain in quality. This matters most in the no-pattern-fits lane, where a first-principles sequence naturally wants to end with "5. Verify. 6. Double-check." It does not.

Verification appears in a generated prompt only as one of these three, and then it is NAMED specifically:
- **Read-back of an external system** after a write (the Verify-after-write standing order in root CLAUDE.md). Not self-checking: the model cannot know remote state without reading it. Born from the 2026-07-10 silent n8n deactivation.
- **Pixel / render check of a visual artifact** (the CV render-safety rule below; reading the PNG before delivering). Not self-checking: the text layer does not reveal clipping, which is the whole lesson of the 2026-07-18 incident.
- **A named gate** (Brand + Soul Pre-Flight, Close-Out). Referenced by name, never paraphrased.

Everything else is over-verification. Leave it out. The gates already own the checking; a prompt that re-asks for it is paying twice.

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
4. **EXCEPTION, animation or 3D is in the brief (added 2026-07-29, run 41):** Claude Design cannot export motion, so a deck asked for as "animated", "3D" or "high tech" is built DIRECTLY as a self-contained HTML deck (fixed 16:9 stage, everything inlined including the logo as base64, keyboard nav) with the PDF printed from it through headless Chrome. Raise the override in the gap round and let Shaheen rule; never silently obey the standing rule and ship something static, and never silently break it either. Two mechanics are load-bearing, both learned the same run: every animation's CSS base state must BE its end state (entrances run as keyframes *from* empty), so a stalled compositor or a print pass can never capture a blank or mid-flight slide; and the deck needs a `?static=1` path plus a `settled` class forcing end states, because that path is what the PDF renders through.
5. **Render verification for any deck, not optional (same run):** print the PDF, assert page count equals slide count, extract text PER PAGE and assert a known footer or page-marker string appears on every one, then rasterise every page and LOOK at them. Two slides overflowed and silently dropped their footer on this run; the deck looked fine to the eye and only the per-page extraction caught it. Same lesson as the 2026-07-18 clipped CV, one layer up.
6. **Three print-path traps, all measured on run 49 (the 37-slide system deck), all invisible on screen.** (a) **`position:fixed` chrome paints on page ONE only** when Chrome prints, so a logo, footer or counter fixed to the viewport silently vanishes from every page after the first. Render chrome INSIDE each slide element; the interactive view is identical because the slide fills the stage. This is what makes a per-page "the logo is on every page" assertion pass instead of quietly failing. (b) **`background-clip:text` gradient headlines paint a hairline of their background BOX in the PDF and emit the text twice** into the text layer. Anything that must be a wordmark should be the logo asset anyway (`brand-config.md`: the ALEX display lettering exists only inside the logo file, never retyped), which fixes the brand violation and the artifact in one move. (c) **A grain/noise overlay is the single biggest PDF cost** because it rasterises per page and does not compress: 77MB -> 18MB across 37 pages by disabling it on the static path only, so the screen deck keeps its texture and the shared file stays light. Also: base64 an inlined logo ONCE as a CSS custom property, never as a repeated `<img src>` (37 copies made a 190KB file 4.6MB).

**Image / diagram**
1. Invoke the `frontend-design` skill FIRST (standing rule 2026-06-17).
2. Building Alex family: reuse the locked system at `work/12-linkedin-series/screenshots/DIAGRAM-DESIGN-SYSTEM.md`.
3. Build HTML/CSS/SVG, render headless Chrome --screenshot, READ the PNG and review before delivering.

**Excel**
1. /xlsx skill, branded from brand-config.md.
2. ALWAYS real formulas (=SUM, =SUMIFS, =IF), never hardcoded values. Usable standalone.

**CV**
1. Skills: `resume-ats-optimizer` + `resume-tailor`.
2. Confirm track (Senior Power BI Developer or AI/n8n Automation); pull role-tagged blocks from the pipeline masters (source of truth: [[me/cv-sources]]). **AI track is FROZEN since 2026-08-19:** its master is `vault/me/cv/ai/master-ai-cv.docx` and you SELECT, REORDER and keyword-mirror his sentences, never rewrite them. Same words, same tense. Power BI track still uses `master_cv_powerbi.md` normally.
3. Tailor to target, render (HTML then PDF).
4. **Render safety (LOCKED 2026-07-18 after a clipped-CV incident, error-log):** the CV page CSS MUST be `.page { min-height: 296mm; overflow: visible }` - NEVER `height` + `overflow: hidden`, which silently CLIPS content past one page (it cut the Languages line off page 2 on all four 07-18 CVs). If a page overflows, tighten to fit: line-height ~1.27, tighter h2/bullet/role margins, trim a bullet, until it fits one sheet.
5. **Verify by PIXELS, not text (the incident's real lesson):** reading the PDF text layer does NOT catch clipping (clipped text still extracts). Verification = (a) a deterministic page-count check (parse the PDF, assert it equals the intended count, e.g. 2), AND (b) LOOK at the rendered page images, especially the BOTTOM of the last page, confirming the final section is present and nothing is cut. Only then deliver. Applies to every rendered visual deliverable (CV, deck, diagram, dashboard).

**Code / system review or audit (added 2026-07-28; Opus 5 reviews with high precision AND recall, so the prompt shape decides how much it reports)**
1. Skills: `systematic-debugging` on anything that survives a first fix; the `/deep-audit` method (`work/23-self-review`) for whole-repo sweeps; the `n8n-*` or `power-bi-*` bindings when the target is one of those.
2. Name the target AND the ground truth it is measured against. Live state beats docs, always (the run-39 lesson: a read-only live GET caught that the Desktop exports were stale).
3. **Report everything found, then filter in a SEPARATE pass.** Never write "only report high-severity" or "be conservative" into the prompt: Opus 5 follows that literally and reports less. Severity-rank in the second pass.
4. Deliverable: findings + severity + an evidence pointer (`file:line`, or an API read-back), then the fix plan. Plan-only unless the request says land it.

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

**n8n instance / infra upgrade (box ops, NOT a workflow build; added 2026-07-13 from the n8n 2.21.7->2.30.3 run)**
1. Skills: `n8n-cli` (instance ops from shell) + `systematic-debugging` on breakage; Context7 for the target version's release notes / breaking changes.
2. Pre-flight ON the box: discover deployment (docker-compose vs run), DB backend (Postgres vs SQLite -> decides recreate safety), current version + image tag; API-snapshot every ACTIVE workflow's flag as the rollback reference.
3. Backup-first: pg_dump (or volume backup) + REST workflow export + compose-file backup; confirm the nightly backups ran.
4. Read release notes (Context7): list breaking changes that hit live workflows; STOP + surface before touching the container if any do.
5. Pin the EXACT target tag (never :latest), recreate preserving the data volume; watch migrations finish clean.
6. Verify-after-write: version read-back + re-activate any dropped active flags (the 2026-07-10 class) + one live test execution (200 + expected shape) + auth gate still enforcing; keep a rollback point.
7. Propagate the new version to system/landscape-log.jsonl (#25 b30-idempotent row) + any stale ":latest"/version docs.

**Penetration / adversarial test suite (added 2026-08-05, run 44; the multi-file sibling of the review/audit pattern above)**
1. Skills: `security-review` (the adversarial pass) + `systematic-debugging`; `webapp-testing` for a web surface, `n8n-cli` for read-only instance ops. Method = the `/deep-audit` engine (`work/23-self-review/deep-audit/README.md`) + #04's evidence-anchored refutation.
2. **Baseline first.** Read the prior audit end to end including its fix ledger and accepted-risk register. Every case either CITES a prior case ID (so it reads as a regression check on a fix that landed) or is marked NEW. Never re-litigate a closed finding without fresh measured evidence.
3. **Rules of Engagement get their own INPUT step**, not a line inside Resources. On a pen test the safety rail is load-bearing and burying it makes it skippable. The seven that generalize: live systems read-only; anything that must mutate runs in a throwaway sandbox; never `git add -f` and never bypass a hook; injection payloads stay inert and are never planted into a live store (test the READ path, never poison the store); the deliverable must not itself become the leak (no secret values, evidence as `file:line` and shapes); a case that could not be executed is recorded NOT RUN with its reason; finds-and-proposes, no fix applied.
4. **One file per aspect, fixed template:** aspect + owner files · invariants NUMBERED and quoted from the file that owns them with `file:line` · threat model by attacker POSITION (untrusted inbound content, a compromised or unavailable remote, a careless session, a second concurrent session, a future contributor, anyone who clones a public repo) · test matrix (ID / invariant / H-case or attack angle / method as the exact command / expected / observed / verdict / severity / evidence) · H-case sweep · accepted-risk register · a copy-paste re-run block with expected exit codes.
5. **The H-case sweep list is the reusable half** and it is where the findings actually come from: missing or empty input · corrupt or malformed · two writers at once · failure partway through · permission denied · remote dead or slow · clock, DST and timezone · unicode, encoding, CRLF, long paths, path traversal · oversized input · hostile content trying to be read as instruction · fail-open vs fail-closed · first run and cold start · **and the check is dead but still reports green**. That last row produced more findings than any other on run 44; always include it.
6. Verdict vocabulary PASS / FAIL / **FRACTURE** (the rule exists but nothing enforces it, or two owners disagree), severity only on FAIL and FRACTURE, kept identical to the prior audit so the two are comparable.
7. Execute, filling Observed from MEASUREMENT only, never from a doc. Adversarial pass attacks every PASS. Then report everything found and severity-rank in a SEPARATE second pass (per the review/audit pattern above).
8. Delegation: aspect files are genuinely independent sizeable tracks, so a per-aspect fan-out IS sanctioned here - paste the Rules of Engagement verbatim into every subagent.

**No pattern fits:** build a sensible numbered sequence from first principles. The mandatory skills sentence still runs; if no bound skill matches, optionally check `find-skills` for an installable one (routes through the #25 audit lane, never a blind install). Still end OUTPUT with the Close-Out Gate. At close-out, append the new sequence to this pattern library.

## Gap-check rules
Before delivering, confirm each is present. If missing, ask in the single batched round:
- Context clear enough that Code will not guess the domain.
- Delivery format stated.
- Destination / project name known.
- Any MCP or API the task needs is named (ambiguous = ask which).
- **One-off task, or durable automation?** Durable -> the generated prompt routes through the /new flow (registry-first: `system/manifest.json` entry, `node scripts/generate-alex.js`, scaffold, `check.mjs --init` re-baseline). Never free-build a permanent automation.
- **Overlap resolution recorded** (step 0): extend vs build new, per Shaheen's answer.

Do not ask more than needed. One clean round beats three small ones. Nothing missing = skip straight to delivery. Always offer the *defaults* skip.

## Token efficiency principles (Shaheen 2026-07-11)
- Reference existing assets instead of repeating them (pointer style: point at the file, never restate its contents).
- Ask clarifying questions upfront, in one round, to avoid regenerations.
- Suggest only the steps actually needed for the task; no ceremonial steps.
- Use task patterns to avoid reinventing sequences from scratch.

## Delivery format
A single markdown code block with three headers, CONTEXT, INPUT, OUTPUT, ready to paste into a Claude Code session. **Lean: no explanation padding around it, just the block** (Shaheen 2026-07-11). Notes only if he asks. Save a copy to `outputs/prompting/YYYY-MM-DD/{slug}.md`. Then the single follow-up: "run it now?" - yes executes it in this session as Alex; no ends the run.

**One line rides OUTSIDE the block (added 2026-07-28, Opus 5 guidance):** `Suggested effort: <low|medium|high|xhigh>`. Effort is the primary cost and latency lever on Opus 5 (low and medium hold quality at a fraction of the tokens; xhigh is for demanding multi-file agentic work and hard audits). It is a SESSION setting - `claude --effort <level>` at launch, verified levels `low|medium|high|xhigh|max` - so a pasted prompt cannot set it. That is why it sits beside the block and not inside it; the block stays lean. Rule of thumb: mechanical or narrow = low/medium, a normal build = high (the default), a multi-file build or an adversarial audit = xhigh.

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

## Prompt regression cases (Phase 1, 2026-07-25)
Prompt edits stop being silent behavior changes. Each production prompt/runbook that matters gets a case in
`work/26-prompting/regression-cases/cases.json` pinning its load-bearing SHAPE (must_contain / must_not_contain
regexes + an illustrative example input). `scripts/prompt-regression-check.js` replays them - STRING-SHAPE
assertions only, ZERO Claude calls, no LLM judging in v1. Strict mode exits 1 on a dropped/added shape;
`--advisory` warns and exits 0. **Phase 2 (wired):** `scripts/generate-alex.js` runs the checker in advisory
mode after validation (step 3b) - a warning, never a build failure (a shape change can be intentional; the
human updates the case). Backfilled with the 5 highest-blast-radius prompts (morning-brief index, email-triage
safety+rules, content-agent gates, weekly-exec deltas, research-team claims table). The V6 lesson (expectations
live as DATA) extended to the prompt layer. Add a case whenever /prompting ships a prompt into production.
**6th case added 2026-07-28, `prompting-assembly-contract`:** /prompting now pins its OWN assembly contract
(`.claude/commands/prompting.md`) - the overlap check, the verbatim skills sentence, the Close-Out reference,
plus the four Opus 5 shapes (scope line, delegation bound, deliverable length, Suggested-effort line) and one
negative that keeps blanket verification out. This file, the spec, is deliberately NOT pinned: the command file
is what loads on `/prompting`, so that is where the teeth belong. Checker green at 6 cases / 27 assertions.

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
1. Identity. Operate as Alex. Re-read the loaded soul core (full soul.md when the task's register is not in the card - gate-40 YES 2026-08-16; mandatory after any compaction).
   Root CLAUDE.md standing orders and gates win over this prompt on any conflict. Hold
   Shaheen's voice: direct, spoken, no filler, no em-dashes. Deliver this task at the scope
   asked. Make routine judgment calls yourself; check in only where different readings lead
   to materially different work. If the request looks mistaken or a better approach exists,
   say so in one sentence and continue as asked, rather than quietly narrowing, widening or
   transforming it. Finish the whole task, and stop short of actions clearly beyond it. The
   standing gates in CLAUDE.md are not scope creep; they still run.
2. Resources. Identify the skills that are needed for the task and use them. Consult the
   Skill Bindings table in root CLAUDE.md; MANDATORY here: n8n-workflow-patterns +
   n8n-node-configuration (n8n-validation-expert on errors, n8n-code-javascript for Code
   nodes). Build via the n8n REST API (key: work/03-application-engine/config/
   n8n-api-key.txt, base https://n8n.shaheenkiarash.com/api/v1), not Chrome. Read
   work/02-morning-brief/CLAUDE.md and work/07-email-triage/CLAUDE.md for conventions.
   Delegate only to genuinely independent, sizeable parallel tracks; this one is a single
   build, so do it yourself. Never a subagent to verify work already done.
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
   [Shaheen's answer]. Length: the briefing matches what the mail actually warrants, no
   filler sections, no redundant summaries, no boilerplate.
2. Destination. Workflow home: [Shaheen's answer]. Files per Output Hygiene:
   outputs/{automation}/YYYY-MM-DD/.
3. Close-Out Gate. Run the Close-Out Gate from root CLAUDE.md and print the Close-Out
   Report.
```

`Suggested effort: high` (rides outside the block; a multi-node live build with credentials
would be `xhigh`, a one-node tweak `low`).

**n8n live-workflow repair relay (added 2026-08-06, run 45/46; the repair sibling of the review/audit pattern, built when both job engines went silent)**
1. Skills: `n8n-workflow-patterns` + `n8n-node-configuration` (MANDATORY), `n8n-validation-expert` on any validation error, `n8n-code-javascript` for every Code node read or written, `systematic-debugging` past a first failed fix, `n8n-cli` for read-only instance ops.
2. **Live state beats every doc, and executions beat the workflow JSON.** The JSON says what the graph IS; `GET /executions/{id}?includeData=true` says what it DID. Per-node item counts + the error object are where a silent stop is actually visible. Retention is short (~10 runs here), so pull the forensics before they prune.
3. **Explain the SILENCE as its own finding**, separately from the failure. "It broke" and "it broke quietly" have different causes and different fixes. Check `settings.errorWorkflow`, whether the alert workflow actually executed at those timestamps, and whether the notification channel is push or pull. A run that ends SUCCESS with zero output is the class to hunt.
4. **Read the flags that neuter each other.** `onError: continueRegularOutput` makes node-level `retryOnFail` inert (the node resolves instead of throwing, so the engine's retry wrapper never engages) and converts total failure into SUCCESS. Prove it from execution TIMING, not from the flag values.
5. Scoped live proof by **injected replay**, never by waiting for a cron: temp webhook + a seed Code node holding real payloads lifted verbatim from a past execution, wired at the stage under test. Backup -> add -> fire ONCE -> restore the WITH-FIXES graph (never the pre-fix backup) -> read-back -> 404-probe the temp path. Payload selection is load-bearing: check the target's own ledger before naming a payload that "must survive" a dedup filter.
6. **Gate every code fix offline against the REAL corpus** (past executions replayed through the live node code via `new Function`), with sha256 identity between tested string, built string, and live read-back. **When a rule serves two cloned workflows, gate it against BOTH corpora before either PUT** - clones diverge, and a rule tuned on one can break the other (measured: the two engines' writers decorate different fields).
7. Deterministic n8n facts worth carrying forward: same-output parallel branches run by **canvas position, topmost first**, not connection order (so ordering-dependent branches go BELOW the flow, and node positions are load-bearing); the public-API PUT can drop `active`; PUT 400s on settings keys outside its 8-key allowlist; a node with 0 input items never runs (`alwaysOutputData`), and Sheets nodes run per item (`executeOnce`).
8. Ship a **verdict row per run** wherever a run can end with nothing: silence is not a state a human can act on.

**Presentation copy-refinement relay (added 2026-08-11, run 47; refining a CLIENT-supplied .pptx, the opposite of the deck-BUILD pattern above)**
1. Skills: `pptx` MANDATORY (any .pptx as input or output), `copy-editing` + `copywriting` advisory. **The "decks go through Claude Design, not /pptx" standing rule does NOT apply** and the override is stated to Shaheen in the gap round: Claude Design has no .pptx path, and this is an edit of a file the client owns. The Brand + Soul Pre-Flight still runs, but the surface is the CLIENT's: no Alex palette, font or logo, the existing design preserved, and the deck's voice is the client's institutional register while soul.md governs only how Alex reports back.
2. **Measure the material before designing the relay.** Slide counts identify which file is which; a text-element extraction with STABLE shape ids becomes the single artifact every lane reads and edits by address. Filter numeric-only cells out of the writers' view: figures are frozen by rule, so showing them invites edits that must then be refused.
3. **Rules pass before any rewriting**, as a separate first agent: capitalisation BY ELEMENT FUNCTION derived from the approved slides with a real example each, terminology locks, the fit rule, evidence discipline, note style and length MEASURED off the benchmark. Then fan the writers out over chapter ranges, every lane reading the whole deck for repetition control but writing only its range.
4. **Arbitrate by measurement, not assent.** Three claims checked against the file changed the run: re-casing is only visible if the capitals are literal rather than PowerPoint `cap=` formatting (162 vs 18 here); a "remove it deck-wide" recommendation was overruled because the source file was the client's DESIGN-NOTES copy and removing content needs the client's word. Expect a good lane to correct the arbiter from the source files, and let it.
5. **Apply human rulings LAST, after any automated tie-breaker.** The sharpest defect of run 47 was Alex's own: an automatic "prefer the shorter alternative" rule ran after the arbiter's rulings and silently reverted two of them. Eleven of the final reviewer's twelve corrections were restorations.
6. **Three write guards, all of which fired:** refuse a replacement whose paragraph/line count does not match the target (trailing empty paragraphs and literal newlines inside ONE run are different structures and neither survives a naive write); refuse any replacement carrying an ellipsis absent from the original (agents quote long blocks with "…" and "rest unchanged", which applied verbatim deletes the remainder); and write the `<a:t>` node directly, because python-pptx's `run.text` setter converts a literal newline into a `<a:br/>` element. Also resolve the source by EXCLUDING the output path: the written file has the same slide count, so a count-based glob picks up its own output on the second run.
7. **Read back the written artifact:** slide count, per-slide shape and element counts identical, zero elements emptied, every replacement exact, notes present, and a **numeric-token multiset diff against the source** with every difference inspected individually (a legitimate diff is a headline pulling a figure up from evidence already on that slide, or a de-duplicated repeat).
8. **Render-diff, because character counts are an estimate and the renderer decides.** Convert BOTH the original and the refined deck to PDF (headless LibreOffice) and compare per-block line counts; anything that gained a line is trimmed to at or under its original length. This also catches rules derived off the wrong file, e.g. a caption band measured on a benchmark deck whose boxes are wider than the working file's. Report the net line delta.
9. Deliverables: the .pptx, a change log in the CLIENT's own format, and a flags list of everything only the client can settle. Strip production shorthand (rule ids, element ids, point sizes) out of anything the client reads.
10. **A LANGUAGE-only second pass is a different job from the first pass, and the defect is usually a MANNERISM, not word choice (added 2026-08-11, run 48).** When a client says the design landed but "the tune" did not, do not hunt adjectives. Count constructions across the whole deck and rank them: run 48's real fault was that ~15 of 43 speaker notes opened on the same contrarian-maxim device and two were near-duplicates 24 slides apart. Measure before and after and report the counts ("worth ...ing" 15 -> 2, presenter imperatives 8 -> 0, "rather than" 44 -> 34); a mannerism half-cleared reads WORSE than one left alone, so either sweep a class deck-wide or leave it, and say which you did.
11. **Fan each dictated "agent" over chapter ranges, and give every lane the whole deck.** One agent cannot rewrite 43 slides in one response. Four cold-context lanes per stage, each writing only its range but reading everything, preserves the dictated relay while staying executable. Carry a written **live defect register** between stages listing what the previous stage did NOT clear, address by address, verified against the current text - and expect lanes to correct it. Run 48's lanes caught two wrong entries in the arbiter's own register and were right both times; a lane that declines to act because the register says "cleared", and flags it instead, is behaving correctly.
12. **Three verification lessons that only measurement produces (run 48).** (a) **Character parity is not fit parity**: a replacement at exactly the same character count still broke across three lines because the substituted word was longer, and narrow boxes wrap on WORD length. (b) **A mixed-format-run guard over-refuses by design**: most such paragraphs carry all their text in run 0 with the remaining runs EMPTY, so test "more than one run actually carries text" rather than "formats differ", or the guard blocks safe edits by an order of magnitude. (c) **A per-page line-count diff is a proxy, not proof**: y-clustering merges columns, so a column getting SHORTER can split clusters and read as +1. Rasterise every slide that still shows a gain and LOOK at it, and compare against the BASELINE render before calling any clipping your own - run 48's worst-looking slide was clipped identically before the pass began.

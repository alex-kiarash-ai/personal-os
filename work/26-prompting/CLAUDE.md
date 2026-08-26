# Prompting (26)

## Type
Automation (on-demand, translator function). Not scheduled. No Notion DB by design (nothing row-shaped to track; vault/projects/prompting/status.md is the record).

## Purpose
Shaheen does not write prompts. He speaks his intent in plain English (typed or via the voice loop) and Alex, acting as a senior prompt engineering specialist, turns it into a clean, structured CONTEXT / INPUT / OUTPUT prompt that Claude Code executes as Alex. The function checks the request against what already exists (so it never quietly rebuilds a live automation), fills gaps with ONE round of questions, resolves the needed skills from the Skill Bindings table, and hands back a lean prompt ready to paste, then offers to run it on the spot.

## Entry Points
- On-demand only. `/prompting` (optionally with the request inline: `/prompting I want a workflow that watches my Gmail...`), or natural language: "write me a prompt for...", "turn this into a prompt". NOT scheduled.
- **Repairing an EXISTING prompt (added 2026-08-26, inspection fix P2-1/M4):** "fix this prompt", "why did this prompt fail", "make my prompt Fable-ready", or a pointer at a file in `outputs/prompting/`. This is a different job from building one and it takes the repair flow below, not the nine-step build flow.

## The flow (in order, every invocation)

**Renumbered 1-9 on 2026-08-26 (inspection fix P2-7/C10).** The old 0 / 0.5 / 1-8 numbering was not executable as written: step 0.5 branch (b) needed the task type that step 2 produces, and branch (c) could not actually resolve until the gap round at step 5. The order below is the order a run can actually follow, and `.claude/commands/prompting.md` uses the same numbers.

1. **Read the request, extract the intent.** Voice-loop input arrives messy (run-ons, fragments, ESL-direct). Extract intent as-is; never ask him to repeat himself. If the request arrives as a non-text artifact (screenshot, PDF, .pptx, spreadsheet), read it with the bound skill for that type FIRST, then continue from what it says (inspection fix P2-9/M9).
2. **Identify the task type, the lifetime, and the TARGET HARNESS.** Task type from the pattern library below. Lifetime: one-off or durable automation. **Harness (added 2026-08-26, inspection fix P0-7): where will this prompt actually execute?** Three kinds, and they take different assembly shapes: a **Claude Code session** (the default, full universal layer), an **n8n LLM node**, or a **scheduled `claude -p` wrapper**. See "Assembly shape by target harness" below. Getting this wrong is not cosmetic: the standard universal layer cannot execute inside an n8n node at all.
3. **Overlap check (FIRST among the checks, Shaheen 2026-07-11).** Check the request against the routing table / `system/manifest.json`. If an existing automation (#01-#25) substantially covers it, flag it in the gap round: "this is mostly #07 email-triage - extend it, or build new anyway?" Shaheen decides. Never silently generate a prompt that rebuilds a live system under a new name. **What each answer means downstream is defined in "Overlap resolution" below (inspection fix P2-3/M12); an "already covered" answer ends the run WITHOUT a prompt, per "The no-prompt outcome" (inspection fix P2-2/M13).**
4. **Resolve the models (Shaheen 2026-08-26; SPLIT IN TWO on 2026-08-26 by inspection fix P0-1/C23).** There are two different models in play and the spec used to conflate them. Resolve each separately, and never let one answer the other's question:
   - **The EXECUTOR model** = what runs the prompt you are handing over. This is what `Built for:` names, always, and what `Suggested effort:` applies to, because effort is a session setting.
   - **The ARTIFACT model** = what the thing the prompt BUILDS or EDITS runs on (an n8n node, a scheduled wrapper). Contract-fixed by `system/manifest.json` `meta.model_routing`, asserted live by V6 and V13. **State it, never ask it, and an answer can never override that contract** (hard-case row below). It does NOT go on the `Built for:` line.
   Resolution order for the EXECUTOR, stop at the first that applies:
   a. **The prompt IS what the node or wrapper runs** (you are writing the text that will live inside `Build Writer Request`, or inside a `run-*.sh` wrapper's `-p`). Then executor and artifact are the same thing and `meta.model_routing` fixes both. State it, do not ask.
   b. **He named a model** for the session ("build this for Fable", "run this one on Haiku") -> use it, do not ask. If what he named contradicts a routing contract that governs the ARTIFACT, the contract still wins for the artifact and his answer still governs the executor; say both in one line.
   c. **Everything else** -> **ASK, every time.** AskUserQuestion, `Opus 5` (the default, and what an interactive session runs) or `Fable 5`, with the automatic Other for Sonnet 5 / Haiku 4.5 / a 4.x model. This question rides as the FIRST question of the single gap round, and the round fires even when the model is the only gap.
5. **Build the step sequence** for that task type. Do not ask permission. Build the steps.
6. **Gap-check** the three sections (rules below).
7. **Ask the gap questions IN CHAT, one batched round maximum**, only about real gaps, never about things he said or that can be inferred. Every round ends with the skip: "or say *defaults* and I'll fill the gaps with system defaults." (Defaults: deliverable format from the task pattern, destination from Output Hygiene, **executor model = Opus 5**.)
8. **Re-resolve, then assemble (re-resolve step added 2026-08-26, inspection fix P0-8/C22).** The round's answers can move the target: an "extend #07" answer points the work at a project whose lane is model-pinned, which changes step 4's answer after step 4 already ran. So before assembling, re-run step 4 against the resolved target. If the executor model changed, say so in one line. Then assemble the full structured prompt.
9. **Deliver lean** (format below), **save** to `outputs/prompting/YYYY-MM-DD/{slug}.md`, then **offer once:** "run it now?" If yes, execute it in this session as Alex. If no, done.

Clarifying questions happen in conversation first. The final prompt goes out complete, with no open questions left inside it.

## The structure every generated prompt must follow

### CONTEXT
Plain English, written for Alex. What is being asked in one line, what domain it sits in (n8n on Hetzner, Power BI, brand/design system, research, vault, CV pipeline, ...), and any system Claude Code needs to know about to not get lost. No numbered steps here.

### INPUT
Numbered steps, always 1-2-3. Every generated prompt's INPUT includes, at minimum:
1. **Identity.** Operate as Alex. Re-read the loaded soul core (the session's card: voice rules + pinned registers + newest My Words); pull FULL `soul.md` only when the task needs a register the card lacks (gate-40, Shaheen 2026-08-16). Mandatory again after any compaction. Root `CLAUDE.md` auto-loads; its Standing Orders and gates always win over this prompt - on any conflict, CLAUDE.md wins. Hold Shaheen's voice throughout: direct, spoken, no filler, no em-dashes.
   **Model-layer lines (was "Scope", rewritten 2026-08-26).** Identity carries the scope, brevity and correction lines for the RESOLVED model, lifted from that model's block in **The model layer** below. On Opus 5 that is the scope-asked line, the conciseness line, the corrections line and the progress line (all four, INPUT 1; the corrections and progress rows were orphaned until inspection fix P0-4/C6 - they sat in the table with no assembly instruction, and two test runs disagreed about whether to ship them). On Fable 5 it is the boundaries block, the anti-over-engineering block, the lead-with-the-outcome line, the grounded-progress block, and, on a long or unattended run, the autonomous-operation block. Ship one set, never both, and never the Opus 5 text under a Fable 5 label. The verbatim wording lives in exactly one home, the model-layer table, so this section cannot hold a second copy that drifts from it. **This was asserted but not true until 2026-08-26 (inspection fix C5): the worked Example at the end of this file held a full second copy of the Opus 5 scope line and it had already drifted by a comma. The Example now quotes by reference instead of restating.** **Why the scope boundary is needed at all, on either model:** both expand scope on their own, and this constitution is a scope amplifier (Change Propagation spans eight file classes, Close-Out B adds more, Activity Capture and People Intake fire unprompted), so a narrow one-off has to say so.
2. **Resources.** Opens with, verbatim, always: **"Identify the skills that are needed for the task and use them."** Then the teeth: consult the Skill Bindings table in root CLAUDE.md; MANDATORY bindings are non-negotiable. /prompting resolves the bindings AT GENERATION TIME and NAMES the specific skills, MCPs, and file pointers here (from the lookup table below). Never leave this as a generic "use available skills" line.
   **Delegation (rewritten 2026-08-26).** The delegation line comes from the resolved model's block, and it is the shape that flips hardest between models: Opus 5 caps delegation (5.7), Fable 5 wants it and manages it well (4.7). Read the block, never assume. Two things hold on every model regardless: research routes through /research-team (#04) rather than an ad-hoc squad, because that is structural to this system and not a model-layer opinion; and when Shaheen dictates the relay himself (Agent 1 / Agent 2 / Agent 3 with named roles and handoffs), that IS the spec and no delegation rule applies.
3. **Task-specific steps.** The actual work, numbered, following the pattern for this task type. For identity-carrying output (visual or voice), the first task step is: "Run the Brand + Soul Pre-Flight Gate from root CLAUDE.md and print the pre-flight line before generating a single byte."

### OUTPUT
Numbered steps, always 1-2-3:
1. **Deliverable.** Exactly what gets produced and in what format. Unstated = gap, ask. **State the length too (2026-07-28; confirmed model-independent 2026-08-26):** "Match the length to what the task needs: cover the substance, no filler sections, no redundant summaries, no boilerplate." Where a real band exists, NAME it (LinkedIn ~150 words per work/12, a CV's page count, a one-page brief). Opus 5 writes longer files to disk than earlier models (5.3) and Fable 5 is no shorter, so this is the one 07-28 shape that ships on BOTH blocks unchanged. Shaheen calibrates length by hand when it runs long (soul.md My Words: "make it simple, short, not very short, but short"; "lean, no unnecessary explanation padding") - this line is that preference encoded once, instead of him correcting it every time.
2. **Destination.** Where it lives. Deliverables follow Output Hygiene: `outputs/{automation}/YYYY-MM-DD/`. Unclear = gap, ask.
3. **Close-Out Gate (ALWAYS the final step, never skipped).** Verbatim: "Run the Close-Out Gate from root CLAUDE.md and print the Close-Out Report." Reference the real gate; NEVER paraphrase or restate a lite version of it (two versions drift).

## Assembly shape by target harness (added 2026-08-26, inspection fix P0-7/M1)

Step 2 resolves WHERE the prompt executes. The structure above assumes a Claude Code session. It is not portable,
and the gap is not cosmetic: a test run built a prompt for the Application Engine writer node and found that
**none of the four standard universal-layer items can execute inside an n8n node.** The artifact still read
perfectly, which is what made it dangerous.

**A. Claude Code session (the default).** Full universal layer exactly as written above. Nothing changes.

**B. An n8n LLM node** (the prompt text lives inside a node such as `Build Writer Request`). The universal layer
is REPLACED, not trimmed:
- **No `soul.md` re-read.** There is no filesystem. The voice DOES reach that node, by a different mechanism that
  already works: `scripts/generate-alex.js` injects a static voice block between `<<<SOUL_VOICE>>>` markers at
  build time. Point at that mechanism; never write a read instruction the node cannot run.
- **No skills sentence.** There is no skill loader on `/v1/messages`. This one is worse than inert: it invites the
  model to narrate skill use it does not have INTO the JSON stream the Parse node reads, which is the silent
  per-job failure class this engine was already burned by (error-log 2026-08-07).
- **No "root CLAUDE.md auto-loads / wins on conflict".** Auto-load is keyed on the session folder. Inside a node
  the system prompt is exactly the bytes in the HTTP body, so that sentence reads as a rule with teeth and has none.
- **No Close-Out Gate step.** It needs log.md, status.md, an HQ push and a ledger row, none of which exist there.
  Worse, "print the Close-Out Report" puts extra prose into `content[]` and breaks the output contract.
- **Pointer style INVERTS here.** A node prompt must be self-contained and inlined, because nothing it points at is
  reachable at runtime. That is exactly why the generator injects rather than points.
- **What DOES carry over:** the model-layer lines for the artifact model, the OUTPUT length line, the verification
  hygiene rule, and the universal construction rules. Those are properties of the TEXT, not of the harness.
- The session that INSTALLS the node still runs the full gates. Scope identity and Close-Out to that session, and
  say so, so a later reader does not read their absence from the node payload as a miss.

**C. A scheduled `claude -p` wrapper.** This one IS a Claude Code session, so the universal layer applies in full.
The only difference is that it runs unattended: the model is pinned in `meta.model_routing.local_wrappers` (state
it, never ask), and the attended/unattended gap question is already answered - it is unattended.

## Overlap resolution: what each answer changes (added 2026-08-26, inspection fix P2-3/M12)

Step 3 asks. The spec used to record the answer and change nothing, so each run improvised. A test run answered
"extend" and eight real things changed downstream, none of them written down. They are written down now.

- **"Build new anyway."** The default path. Durable work routes through /new registry-first. Nothing else changes.
- **"Extend."** Five things change, and this OVERRIDES the "durable automations route through /new" rule, because
  the project already exists in the registry:
  1. **/new is SKIPPED.** Registry-first scaffolding is for new projects, not live ones.
  2. **Read the target's `work/{NN}/CLAUDE.md` and `vault/projects/{name}/status.md` at generation time**, and
     build to its existing conventions rather than inventing parallel ones.
  3. **File pointers swing to the target project** (its spec, its command file, its status file, its wrapper).
  4. **If the target has a regression case, the prompt must run `scripts/prompt-regression-check.js`** after the
     edit, because changing a pinned command file is a pinned-shape change.
  5. **Re-run step 4.** An extend target may be model-pinned in `meta.model_routing`, which changes the answer step
     4 already gave. This is the concrete case that forced the step-8 re-resolve.
- **"It is already covered / just use the existing one."** See the next section. This ends the run.

## The no-prompt outcome (added 2026-08-26, inspection fix P2-2/M13)

Some correct runs deliver NO prompt. When the overlap check finds the request is already covered and he confirms
it, generating a prompt anyway rebuilds a live system under a new name, which step 3 exists to prevent. The old
flow had no exit: steps 7 to 9 were unconditional, Close-Out Extras demanded a saved prompt path, and the log enum
only had `delivered` and `delivered+ran`, so a correct no-prompt run literally could not be recorded.

What to do instead:
1. Say which automation covers it and what that automation already does.
2. Point at its command file and spec.
3. Offer the real next step: fix the part of it that is falling short, which is usually the actual need.
4. **Log it as `routed`.** Close-Out Extras' saved-prompt line is N/A for this outcome, stated as N/A, not skipped.
5. Do NOT increment the prompt count in status.md. No prompt was generated.

## The repair flow (added 2026-08-26, inspection fix P2-1/M4)

For "fix this prompt" / "why did this prompt fail", not for building a new one. The build flow's nine steps assume
plain English in and a new artifact out; running them on a repair re-derives decisions the original already made.

1. **Read the original prompt in full**, plus whatever evidence exists that it misbehaved (the run's outputs, the
   log, the ledger rows it did or did not write).
2. **Diagnose before editing.** Name the defect and the evidence for it. A wrong premise is a normal outcome here:
   one test run was told a prompt "kept skipping Close-Out" and found Close-Out present and correct, with an
   unscoped "change nothing, no writes" step outranking it. Explicit writes survived, implied ones did not.
3. **Default to a targeted diff, not a rebuild.** Say what changes and why, line by line. Rebuild only if he asks
   or if the original predates so many rules that patching is dishonest; ask that as the single gap question.
4. **The executor model:** if the original records a `Built for:` line, PRESERVE it unless he says otherwise. If it
   records none (every prompt before 2026-08-26), treat it as unstated and resolve per step 4, then say that the
   original recorded no target so the answer is new rather than inherited.
5. **Re-check the repaired prompt against the current hard constraints** before handing it back, because a prompt
   written weeks ago predates rules that have landed since.
6. Save the repaired version as a NEW dated artifact. Never overwrite the original; it is the evidence.

## Pointer style (hard rule)
Generated prompts reference files, they never restate file contents. No retyped hexes, model names, workflow IDs, voice rules, or schedules inside a prompt - point at the file that owns the fact ("read brand/config/color-system.md"). Copied facts go stale; the files are the truth, and the prompt stays current even if it is executed weeks later.

## Verification hygiene (hard rule, added 2026-07-28 from the Opus 5 prompting guide)

Generated prompts NEVER carry a generic verification step: no "verify your work", no "double-check before responding", no "re-verify", no "use a subagent to verify". Opus 5 already catches and fixes its own mistakes; a blanket instruction stacks on top of that behavior, causes over-verification, and burns tokens with no gain in quality. This matters most in the no-pattern-fits lane, where a first-principles sequence naturally wants to end with "5. Verify. 6. Double-check." It does not.

Verification appears in a generated prompt only as one of these three, and then it is NAMED specifically:
- **Read-back of an external system** after a write (the Verify-after-write standing order in root CLAUDE.md). Not self-checking: the model cannot know remote state without reading it. Born from the 2026-07-10 silent n8n deactivation.
- **Pixel / render check of a visual artifact** (the CV render-safety rule below; reading the PNG before delivering). Not self-checking: the text layer does not reveal clipping, which is the whole lesson of the 2026-07-18 incident.
- **A named gate** (Brand + Soul Pre-Flight, Close-Out). Referenced by name, never paraphrased.

Everything else is over-verification. Leave it out. The gates already own the checking; a prompt that re-asks for it is paying twice.

**Model gate (added 2026-08-26).** The three forms above are model-INDEPENDENT: none of them is self-verification, so none is affected by which model runs. The BAN on blanket verification is not model-independent. It is Opus 5 guidance (playbook 5.5) and it stays in force for Opus 5. **On Fable 5 it is partially reversed:** playbook 4.12 says fresh-context verifier subagents outperform self-critique on long runs, so a Fable 5 prompt for a long or unattended run MAY carry a fourth form, an explicit verifier subagent at a stated interval, checking against the specification. Still never a bare "verify your work" or "re-verify before responding" on any model. The difference is that a named verifier with a stated interval and a stated target is a mechanism, while a blanket instruction is just pressure.

## The model layer (added 2026-08-26, from `work/26-prompting/model-playbook.md`)

Prompting is two layers stacked (playbook section 1). The **universal layer** is everything else in this spec: it
is where most of the quality comes from and it barely changes. The **model layer** is a short list of behaviors
that differ per model, small in number and large in effect. Write the universal layer once, swap the addendum.

**Why this section exists.** The 2026-07-28 pass read Anthropic's Opus 5 guide and wrote four Opus 5 shapes into
EVERY generated prompt unconditionally: the scope line, the delegation cap, the length line, and the blanket
verification ban. **Two of them genuinely invert on Fable 5, and one substitutes** (corrected 2026-08-26 by
inspection fix P3-8, after checking each against the playbook: DELEGATION inverts, Opus 5 caps it at 5.7 while
Fable 5 wants it at 4.7; VERIFICATION inverts, Opus 5 says delete verifier-subagent instructions at 5.5 while
Fable 5 sanctions a named one at 4.12. SCOPE does NOT invert: Opus 5's scope block and Fable 5's boundaries block
point the same direction, so it is a substitution, different wording for a same-signed rule. The old "three
invert" wording overstated it.) A Fable 5 prompt built by the old spec told the model to
cap delegation and skip verification, which is the opposite of what that model wants, in the exact register the
playbook's section 1 (L55) says now causes harm (cite corrected 2026-08-26, inspection fix P3-10; section 10 is the delete-list, the "old instructions now actively hurt" statement lives in section 1). The lesson generalizes past these two models: **a model-layer rule
applied unconditionally is a bug with a delay on it**, and it stays invisible because the prompt still reads well.

The resolved model comes from flow step 0.5. Read that model's playbook section at generation time; never work
from memory of it, and never carry an effort level across from another model (playbook section 3: the levels were
recalibrated between generations, so a carried-over setting is usually wrong).

### Block: Opus 5 (the default)

Playbook section 5. Interactive Claude Code sessions run this today.

| Prompt slot | What ships |
|---|---|
| INPUT 1, scope | "Deliver this task at the scope asked. Make routine judgment calls yourself; check in only where different readings lead to materially different work. If the request looks mistaken or a better approach exists, say so in one sentence and continue as asked, rather than quietly narrowing, widening, or transforming it. Finish the whole task, and stop short of actions clearly beyond it. The standing gates in CLAUDE.md are not scope creep; they still run." |
| INPUT 1, brevity | "Keep responses focused and concise. Keep caveats short and spend most of the response on the main answer. When asked to explain, give a high-level summary unless depth is asked for." Opus 5 runs longer than prior models and **effort does not shorten the visible answer** (5.2), so brevity has to be prompted. |
| INPUT 1, corrections | "Only correct an earlier statement when the error would change the code, the conclusion or a decision. Otherwise make the fix and move on." (5.5) |
| INPUT 2, delegation | "Delegate only to genuinely independent, sizeable parallel tracks. Research goes through /research-team (#04), never an ad-hoc squad. Never a subagent to check work already finished." (5.7) |
| Progress | "Before your first tool call, say in one sentence what you are about to do. While working, update only on a real finding or a change of direction. Finish by leading with the outcome." (5.4) |
| Verification | The ban holds. No blanket verification of any kind (5.5, and the hard rule above). |
| OUTPUT 1, length | "Match the length to what the task needs: cover the substance, no filler sections, no redundant summaries, no boilerplate." Name a real band where one exists. (5.3) |
| Suggested effort | `high` is the default. `xhigh` for demanding multi-file agentic work and adversarial audits. `low` and `medium` liberally, they are the main cost control and hold quality well. |

The last sentence of the scope line is load-bearing. Without it the scope line reads as permission to skip
Close-Out, and this constitution is a scope amplifier (Change Propagation spans eight file classes, Close-Out B
adds more, Activity Capture and People Intake fire unprompted).

### Block: Fable 5

Playbook section 4. Built for problems that are too long-running or too ambiguous for a normal session: multi-day
autonomous runs, the hardest one-shot implementations. Point it at the hard thing, not the routine thing.

| Prompt slot | What ships |
|---|---|
| INPUT 1, boundaries | "When the request is a problem description, a question, or thinking out loud rather than an instruction to change something, the deliverable is your assessment. Report the findings and stop. Do not apply a fix until asked. Before a command that changes system state, check the evidence supports that specific action; a signal that pattern-matches a known failure may have a different cause." (4.6) |
| INPUT 1, restraint | The anti-over-engineering block (4.3, full text in playbook section 11): no features, refactors or abstractions beyond the task, no error handling for cases that cannot happen, no compatibility shims. Fable 5 tidies beyond the task at higher effort. |
| INPUT 1, brevity | "Lead with the outcome: your first sentence answers what happened or what you found. Keep it short by being selective about what you include, not by compressing into fragments, abbreviations or arrow chains. Readable beats terse." (4.4) |
| INPUT 2, delegation | **INVERTS the Opus 5 cap.** "Delegate independent subtasks to subagents and keep working while they run. Intervene if a subagent goes off track or is missing context." (4.7) The #04 research routing still holds, because that is a structural rule of this system and not a model-layer opinion. |
| Progress | **The highest-value Fable 5 line.** "Before reporting progress, audit each claim against a tool result from this session. Report only work you can point to evidence for; if something is unverified, say so. If tests fail, say so with the output; if a step was skipped, say that." (4.5) Anthropic measured this as nearly eliminating fabricated status reports. |
| Verification | A named fresh-context verifier subagent at a stated interval, checking against the specification, IS allowed on long runs (4.12). Still no bare "verify your work". |
| Long unattended runs | Add the autonomous-operation block (4.9, full text in playbook section 11) when nobody is watching: no permission questions mid-task, and check the last paragraph before ending a turn. Fable 5's known failure mode is ending on a statement of intent without the tool call. |
| OUTPUT 1, length | Same line as Opus 5. |
| Suggested effort | `high` is the default. `xhigh` only for genuinely capability-sensitive work. **Do not reflexively max it:** playbook 4.3 notes low effort on Fable 5 often exceeds `xhigh` on prior models. |

Two Fable 5 traps worth knowing before a prompt ships to it. **Never ask it to reproduce, echo or explain its
internal reasoning as response text** (4.12): that can trigger a refusal category and force a fallback to Opus 4.8.
And avoid surfacing a remaining-token countdown in the harness (4.9), which triggers it to suggest starting a new
session mid-run.

### Other models

No full block, by Shaheen's decision (2026-08-26): only Opus 5 and Fable 5 earn one, because those are the two he
points work at. If a request names something else, do not guess and do not fall back to the Opus 5 block. Read the
playbook section and pull the two or three lines that matter.

**Bounded to Anthropic (added 2026-08-26, inspection fix P2-8).** Shaheen runs Anthropic models only. The
answerable set is exactly what appears in `system/manifest.json` `meta.model_routing` plus the two blocks above:
Opus 5, Fable 5, Sonnet 5, Sonnet 4.6, Haiku 4.5, Opus 4.x. A non-Anthropic target is OUT OF SCOPE for this
function; say so rather than improvising a block for it.

**Unknown-model guard (added 2026-08-26, inspection fix P2-6/M6).** Before assembling, confirm the resolved model
HAS a playbook section. If it does not (a flagship shipped and #25 has not refreshed the snapshot yet), STOP and
say so plainly: build on the universal layer only, name the missing section, and ask him whether to proceed or
wait for the refresh. Never silently fall back to the Opus 5 block, which is precisely what makes a wrong-model
prompt look right.

- **Sonnet 5** goes to section 6. Interprets literally, especially at low effort, so say "apply this to every
  section, not just the first". Watch `max_tokens`, its tokenizer produces roughly 30 percent more tokens for the
  same text. On design work it settles into one default style; ask for several distinct directions and pick one.
- **Haiku 4.5** goes to section 8. Needs MORE explicit structure, not less: tight scope, a small output example to
  lock the format, no reliance on inference. This is the one place where the "short instructions beat long
  enumerations" advice reverses.
- **Opus 4.8 / 4.7 / 4.6 and Sonnet 4.6** go to sections 7 and 8.

### The one exemption both blocks keep

When Shaheen dictates the relay himself (Agent 1 / Agent 2 / Agent 3 with named roles and handoffs), that IS the
spec. Build it as he said, cold-context subagents and all. No delegation rule from either block applies.

## The file lookup table (what INPUT points at)

**Core, every generated prompt:**
| File | Why |
|---|---|
| `soul.md` (repo root) | Voice + identity. "Re-read the loaded soul core; full `soul.md` only on a register miss (gate-40). Mandatory again after compaction." |
| root `CLAUDE.md` | Auto-loads; the prompt defers to its Standing Orders + gates. |
| Skill Bindings table (in root CLAUDE.md) | Source for resolving the mandatory skills sentence. |
| `work/26-prompting/model-playbook.md` | The model layer. Universal rules in section 2, effort in section 3, per-model behaviors in 4 to 8, the delete-list in 10, ready blocks in 11. Read the resolved model's section at generation time. |

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

## Universal construction rules (added 2026-08-26, playbook sections 2 and 10)

Model-independent, so they apply on every generated prompt regardless of what step 4 resolved. The playbook is
blunt that this layer is where most of the quality lives, and the spec was carrying none of it explicitly.

**ONE EXCEPTION, and it used to be a contradiction (inspection fix P0-5/C8).** The delete-list below bans blanket
verification instructions. That ban is Opus 5 guidance (playbook 5.5), NOT a universal rule: on Fable 5 it is
partially reversed (playbook 4.12 sanctions a named fresh-context verifier subagent at a stated interval on long
or unattended runs). Until 2026-08-26 this section claimed model-independence while containing a model-dependent
rule, and the verification-hygiene section said the opposite. The verification-hygiene section is correct and wins;
read that row as scoped to the resolved model.

### Documents on top, the ask last (playbook 2.6) - the highest-value rule here

When a prompt carries pasted source material of roughly 20K tokens or more (a long transcript, a full job ad set,
a document dump, a big JSON export), the material goes **ABOVE** CONTEXT / INPUT / OUTPUT, and the ask stays last.
Anthropic measures up to 30 percent better response quality from putting the query at the end, largest on complex
multi-document inputs.

**The threshold is a floor, not a gate (inspection fix P2-4/M8).** No token counter exists in this repo and the
spec never named a measurement method, so the old wording made a hard binary branch into two mutually exclusive
layouts turn on a quantity nobody measures, unfalsifiable afterwards because both layouts read perfectly. The
layout is not measured as harmful below the threshold, only unnecessary. So: **when a paste is present at all and
you are unsure of its size, use documents-on-top.** Estimate with chars/4 if you want a number; do not agonise.
Below the threshold with a small paste, the normal three-header order is still fine.

Shape it as:

```
<documents>
  <document index="1">
    <source>[filename, URL or what it is]</source>
    <document_content>
    [the long content]
    </document_content>
  </document>
</documents>

CONTEXT / INPUT / OUTPUT as normal, below the documents.
```

Add the quote-first instruction on any long input: "First quote the passages relevant to the task, then do the
task using those passages." It keeps a long input anchored and cuts drift.

### Tag the content types (playbook 2.4)

Instructions, context, pasted input and examples never blur together. Pasted material gets wrapped, never inlined
loose in the middle of a paragraph. Use consistent tag names across prompts: `<document>`, `<input>`, `<example>`.
This is a small change with a real effect on a prompt that carries a job ad, an email thread or a transcript,
which is most of what he pastes.

### State what the output enables (playbook 2.2)

CONTEXT already says what is being asked and what domain it sits in. Add what the output is FOR. Explaining why an
instruction matters lets the model generalize to cases the prompt never anticipated, which is exactly what a
pointer-style prompt run three weeks later needs. The frame: "I am working on [larger task] for [who]. They need
[what the output enables]. With that in mind: [request]."

### Examples, when they earn their place (playbook 2.3)

Examples are the most reliable way to steer format, tone and structure. Three to five is the documented sweet
spot, each in `<example>` tags inside `<examples>`, relevant and varied enough that no unintended pattern gets
picked up. **A positive example of the wanted shape beats a paragraph of prohibitions**, which is worth reading
against this spec's own habit of writing rules as bans.

### Describe the target, not the ban (playbook 2.7)

"Write in flowing prose paragraphs" beats "do not use markdown". Where a rule can be stated positively, state it
positively. The hard rules in this spec that are genuinely prohibitions (no dashes, no invented numbers, no
blanket verification) stay as they are: those are enforcement, not style guidance.

### Never put these in a generated prompt (playbook 10)

The delete-list. Each of these was correct advice for an older model and now actively costs quality or errors:

| Do not write | Why |
|---|---|
| A prefilled assistant turn | 400 error on 4.6 and later. |
| `budget_tokens` thinking config | Deprecated on 4.6, an error on 4.7 and later. Budget lives in effort. |
| `temperature`, `top_p`, `top_k` | 400 error on Sonnet 5. Steer tone through the prompt. |
| "CRITICAL: you MUST use this tool when..." | Over-triggers. "Use this tool when..." is enough. |
| "If in doubt, use [tool]" / "Default to using [tool]" | Over-triggers on 4.6 and later. |
| "Double-check your work" / "include a final verification step" | Over-verification with no quality gain **on Opus 5** (playbook 5.5, corroborated verbatim against Anthropic's docs 2026-08-26). **NOT model-independent** (inspection fix P0-5/C8): on Fable 5 a NAMED fresh-context verifier subagent at a stated interval is sanctioned on long or unattended runs (playbook 4.12). See the verification hygiene rule. |
| "After every 3 tool calls, summarize progress" | Sonnet 5 and Fable 5 handle updates on their own. |
| "Explain your reasoning in the response" | Can trigger a refusal on Fable 5 and force a fallback to Opus 4.8. |
| A hand-written step-by-step reasoning *plan* | Replace with the goal, the constraints and a quality bar. The model's own reasoning usually exceeds a prescribed plan. **Where the line sits (clarified 2026-08-26, inspection fix C11):** a TASK PATTERN is allowed and mandatory, because it encodes non-obvious system facts a model cannot infer (which skill is mandatory, which API to hit, which gate fires, which file owns a fact). A REASONING PLAN is banned, because it prescribes HOW to think about a problem the model reasons about better unaided. Test: does the step carry a fact about THIS system, or an instruction about cognition? Facts stay, cognition goes. |
| An effort level carried over from another model | The levels were recalibrated between generations. |

The last two matter most for this function, because a prompt engineer's instinct is to write more steps and reuse
what worked. On current models both instincts cost quality.

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

**Re-homed 2026-08-26 (inspection fix P3-6/C15).** The two relays below were appended under `## Example`
instead of here, so anything reading only the pattern library saw 12 patterns instead of 14 and never learned
that the .pptx relay overrides the standing Claude-Design deck rule.

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

**No pattern fits:** build a sensible numbered sequence from first principles. The mandatory skills sentence still runs; if no bound skill matches, optionally check `find-skills` for an installable one (routes through the #25 audit lane, never a blind install). Still end OUTPUT with the Close-Out Gate. At close-out, append the new sequence to this pattern library.

## Gap-check rules
Before delivering, confirm each is present. If missing, ask in the single batched round:
- Context clear enough that Code will not guess the domain.
- **CONTEXT states what the output ENABLES**, not only what it is (playbook 2.2). Added to the checklist 2026-08-26 (inspection fix C13): the rule was mandatory and never gap-checked, and the spec's own worked Example did not do it until the same fix.
- **Examples needed?** (playbook 2.3, inspection fix C12.) If the output has a shape that is easier to show than describe (a row format, a JSON envelope, a heading pattern), the prompt carries 2 to 5 short `<example>` blocks inside INPUT 3. If the format is obvious from the deliverable line, it does not. The rule was in the spec with no slot, no gap question and no demonstration; the slot is INPUT 3.
- Delivery format stated.
- Destination / project name known.
- Any MCP or API the task needs is named (ambiguous = ask which). **If a needed MCP or tool is NOT installed at all, say so and name the fallback path rather than writing a prompt that depends on it** (inspection fix P2-9/M10; the skills side already had `find-skills`, the MCP side had nothing).
- **Both models resolved?** (step 4, split by inspection fix P0-1/C23). The EXECUTOR model is named by him, implied when the prompt IS what a pinned node/wrapper runs, or ASKED. An unstated executor is always a gap; it is the one question that fires even when nothing else is missing. The ARTIFACT model, where one exists, is read from `meta.model_routing` and STATED, never asked.
- **Attended or unattended?** (added 2026-08-26, inspection fix P0-5/C7.) Ask only when the answer changes the build: on Fable 5 a long or unattended run gets the autonomous-operation block and may carry a named verifier subagent, and an attended one gets neither. Do not ask on a short interactive task where it obviously does not apply.
- **One-off task, or durable automation?** Durable -> the generated prompt routes through the /new flow (registry-first: `system/manifest.json` entry, `node scripts/generate-alex.js`, scaffold, `check.mjs --init` re-baseline). Never free-build a permanent automation.
- **Overlap resolution recorded** (step 3): extend, build new, or already-covered, per Shaheen's answer. See "Overlap resolution" below for what each answer changes downstream.

Do not ask more than needed. One clean round beats three small ones. Always offer the *defaults* skip.

**The partially-answered round (added 2026-08-26, inspection fix P0-9/C24).** He often answers one question out of three and moves on, which is his register, not an oversight. One-round-max still holds, so do NOT open a second round. Apply defaults to the unanswered questions AND SAY WHICH ONES YOU APPLIED, in one line, before delivering. Silence is the failure mode this fixes: a test run answered one of three, silently defaulted the rest, and in doing so discarded a model pin that `meta.model_routing` had already fixed. A default he can see is a default he can correct. **Amended 2026-08-26:** "nothing missing = skip straight to delivery" no longer holds when the target model is unresolved. An unstated model is ALWAYS a gap, so the round still fires with the model as its only question. That is deliberate and it is Shaheen's instruction: the model decides which model-layer lines ship, and guessing it silently is how a prompt ends up carrying guidance written for a different model.

## Token efficiency principles (Shaheen 2026-07-11)
- Reference existing assets instead of repeating them (pointer style: point at the file, never restate its contents).
- Ask clarifying questions upfront, in one round, to avoid regenerations.
- Suggest only the steps actually needed for the task; no ceremonial steps.
- Use task patterns to avoid reinventing sequences from scratch.

## Delivery format
A single markdown code block with three headers, CONTEXT, INPUT, OUTPUT, ready to paste into a Claude Code session. **Lean: no explanation padding around it, just the block** (Shaheen 2026-07-11). Notes only if he asks. Save a copy to `outputs/prompting/YYYY-MM-DD/{slug}.md`.

**Length band (added 2026-08-26, inspection fix P1-5/M14): 400 to 900 words for the block.** Measured drift is why this exists: the delivered median went from 686 words in July to 1278 in August, an 86 percent growth against a standing zero-padding rule that nothing measured. Over 900 means a pattern is being inlined that should be pointed at. A genuine multi-phase relay may exceed it; say so in one line when it does, rather than drifting past it silently. `scripts/prompt-regression-check.js --delivered` enforces the band.

**A large paste is the one shape that breaks "ready to paste" (added 2026-08-26, inspection fix P2-5/C3).** When documents-on-top fires, the delivered artifact carries the source ABOVE the three headers, so it is four sections, not three, and the header contract is read as "three headers plus an optional documents block on top". Two rules for the SAVED copy:
- **The saved file keeps a POINTER to the source, never the full paste**, when the source has a path (a repo file, a vault note, a transcript on disk). Pointer style governs the artifact; documents-on-top governs the runtime paste.
- **Only when the source has no path** (he pasted raw text that lives nowhere) does the saved file keep the text, and then say so in one line at delivery, because `outputs/` is gitignored but DOES ride the nightly encrypted vault tar. A private transcript entering backup rotation should be a decision he makes, not a side effect of saving a copy. Then the single follow-up: "run it now?" - yes executes it in this session as Alex; no ends the run.

**One line rides OUTSIDE the block (2026-07-28; made model-aware 2026-08-26):**

`Built for: <executor model> - Suggested effort: <low|medium|high|xhigh|max>`

Both halves sit outside because neither can be set from inside a pasted prompt, and the block stays lean.

- **`Built for:`** names the EXECUTOR model resolved at step 4, never the artifact model (inspection fix P0-1/C23: branch (b) used to resolve an n8n NODE's model while this line means the session's model, so a literal reading put a node model here under Opus 5 instructions, which is the exact invisible mismatch this line exists to expose). **It is written into the saved file too, not only into chat** (inspection fix P1-4): the spec claimed this line makes a saved prompt auditable months later, and a chat message cannot do that. Zero of twelve saved prompts carried it before this fix. It is not decoration. A prompt carrying the Fable 5 delegation and progress lines, pasted into an Opus 5 session, is wrong in a way nothing else in the artifact reveals: it still reads perfectly. This line is the only place the mismatch is visible, and it is what makes a saved prompt in `outputs/prompting/` auditable months later.
- **`Suggested effort:`** comes from the resolved model's row in the model layer above, never from habit. Effort is a SESSION setting (`claude --effort <level>` at launch, levels `low|medium|high|xhigh|max`). **Never carry a level across models:** the playbook (section 3) is explicit that the levels were recalibrated between generations, so a setting that was right on one model is usually wrong on the next.

If he answers "run it now" and the resolved model is not what this session runs, say so in one line before running. Running it anyway is usually still the right call; silently running it as if the model matched is not.

## Hard cases (design answers, keep these behaviors)
| Case | Answer |
|---|---|
| Request duplicates a live automation | Step 3 overlap check, flag + ask. The hardest case: plain English re-describes existing systems in new words. What each answer changes is in "Overlap resolution"; an already-covered answer ends the run per "The no-prompt outcome". |
| Request spans multiple patterns | Compose phases in one prompt, each phase gets its pattern's steps, ONE Close-Out at the end. Ask only if a phase boundary is genuinely ambiguous. |
| One-off vs durable ambiguity | Gap-check question; durable routes through /new registry-first. |
| Messy voice input | Extract intent from the transcript as-is; never ask him to repeat; all clarifications in the single gap round. |
| Prompt staleness (run weeks later) | Pointer style; the prompt's Identity step re-reads live files at run time. |
| Prompt runs where soul/CLAUDE already injected | Say "re-read", never restate voice rules inline (could contradict a newer soul.md). |
| Standing-order conflicts (budget rule, gates, model routing) | The subordination line: CLAUDE.md always wins over a generated prompt. |
| Executor model unstated | Step 4 asks, every time, as the first question of the single gap round. Never infer it from the session, never default silently. Defaults answer = Opus 5. |
| The prompt IS what a pinned node or wrapper runs | Executor and artifact are the same thing and `meta.model_routing` fixes both. State it, do not ask (step 4a). |
| He names a model that contradicts `meta.model_routing` | **Split the question (inspection fix P0-1/C23).** The manifest wins for the ARTIFACT model and V6/V13 enforce it; his answer governs the EXECUTOR model, which is his to choose. Say both in one line, then build. This is not a gap question. The old wording said only "the manifest wins", which contradicted step 0.5's stop-at-first order and gave two different right answers. |
| Model has no addendum block (Sonnet 5, Haiku, a 4.x) | Read that model's playbook section and pull the two or three lines that matter. Never fall back to the Opus 5 block, which is what makes a wrong-model prompt look right. |
| No pattern AND no bound skill | First principles + `find-skills` check (via the #25 audit lane); append the new pattern at close-out. |
| The resolved model has NO playbook section at all | Stop and say so. Build on the universal layer only, name the missing section, ask whether to proceed or wait for the #25 refresh. Never fall back to Opus 5. |
| He answers one question out of three | Apply defaults to the rest and SAY which ones you applied, in one line. Never open a second round, never default silently. |
| The request is already fully covered | Deliver NO prompt. Hand off, log `routed`, do not increment the prompt count. |
| The prompt will run inside an n8n node | Use assembly shape B. The standard universal layer cannot execute there and the skills sentence actively corrupts the output contract. |
| He points at an existing prompt and says fix it | The repair flow, not the build flow. Diagnose first, diff by default, preserve the original `Built for:`, never overwrite the original file. |

## Vault Structure
- Tier 1: `vault/projects/prompting/status.md` (summary, last run, prompts generated).
- Tier 2: none by design. Generated prompts are deliverables and live in `outputs/prompting/YYYY-MM-DD/`.

## Vault Reads
soul.md (voice), root CLAUDE.md (bindings + gates + routing table), `system/manifest.json` (overlap check), target project `work/{NN}/CLAUDE.md` + status.md when relevant, vault via `scripts/vault_search.py`.

## Vault Writes
- `vault/projects/prompting/status.md`: last_run, runs count, pointer to the saved prompt.
- `vault/log.md`: `## [YYYY-MM-DD HH:MM] prompting | {slug}, {task type}, {executor model}, {delivered|delivered+ran|routed}`. (Model field added 2026-08-26 to match what `.claude/commands/prompting.md` already writes, inspection fix P3-9/C17; `routed` added by P2-2/M13 for a correct run that deliberately ships NO prompt.)

## Connections
- Can target ANY project (generated prompts point at the target's work/ + vault files).
- Feeds #23 self-review: saved prompts in outputs/prompting/ are minable for which prompts worked.
- **#25 evolution owns the refresh trigger (added 2026-08-26).** `model-playbook.md` is a dated snapshot of Anthropic docs, so it goes stale the day a new flagship model ships. #25's daily monitor already logs new Claude models to `system/landscape-log.jsonl`; a new flagship means this function needs a playbook section AND a matching addendum block, or /prompting quietly hands out guidance written for the wrong model. That is the failure this whole section exists to prevent, one generation later.
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
is what loads on `/prompting`, so that is where the teeth belong. Checker green at 6 cases / 33 assertions (count corrected 2026-08-26, inspection fix P3-1; it read 27 for a month after five pins were added without updating the number).

## Close-Out Extras
- Generated prompt saved to `outputs/prompting/YYYY-MM-DD/{slug}.md` and referenced in status.md. **N/A when the run correctly delivered no prompt** (see "The no-prompt outcome"); state the N/A, never skip the line silently.
- **Run `node scripts/prompt-regression-check.js --delivered` on this run's own artifact before ledgering** (added 2026-08-26, inspection fix P1-6). The function checks its own output; a shape it just broke should not need a Monday sweep to surface.
- If a first-principles sequence was built, the new pattern is appended to this file's Task patterns section (that is how the library grows). **This is the step that most often gets skipped, because it lives in Post-Run: two test runs built first-principles sequences and neither appended, since the harness skipped Post-Run.**
- **A prompt shipped into production gets a regression case** in `regression-cases/cases.json`. "Into production" means: it is saved in `outputs/prompting/` AND it edits a pinned surface, a live workflow, or a scheduled job.
- vault/log.md line written, with the executor model and the `{delivered|delivered+ran|routed}` outcome.

## Example

**Shaheen says:** "I want a workflow that watches my Gmail, classifies new mail with Haiku, and drops the important ones into a morning briefing."

**Step 3 fires:** this substantially overlaps #02 morning-brief + #07 email-triage. The gap round leads with that: "This is mostly #02 + #07 combined - extend those (cheaper, one system), or build a separate workflow anyway? Also: where should the briefing land, and where does the workflow live? Or say *defaults*."

**If Shaheen answers "build new anyway", the delivered prompt (lean, one block):**

```
CONTEXT
Alex is building an n8n workflow on the Hetzner box that monitors Gmail, classifies incoming
mail with Claude Haiku, and compiles the important items into a morning briefing. Related
live systems: #02 morning-brief and #07 email-triage (Shaheen chose to build separate,
2026-07-11). Their specs are the reference for conventions, not code to duplicate.
This exists so Shaheen reads one short briefing at 08:00 instead of triaging a night's
mail by hand; the briefing is what he acts from, so a missed important mail costs more
than a false positive.

INPUT
1. Identity. Operate as Alex. Re-read the loaded soul core (full soul.md when the task's register is not in the card - gate-40 YES 2026-08-16; mandatory after any compaction).
   Root CLAUDE.md standing orders and gates win over this prompt on any conflict. Hold
   Shaheen's voice: direct, spoken, no filler, no em-dashes.
   [Then the Opus 5 scope line and conciseness line, VERBATIM from the model-layer table
   above. They are not restated here on purpose: this Example used to carry a full second
   copy and it had already drifted from the table by a comma, which is exactly the failure
   the one-home rule exists to prevent. Inspection fix C5, 2026-08-26.]
2. Resources. Identify the skills that are needed for the task and use them. Consult the
   Skill Bindings table in root CLAUDE.md; MANDATORY here: n8n-workflow-patterns +
   n8n-node-configuration (n8n-validation-expert on errors, n8n-code-javascript for Code
   nodes). Build via the n8n REST API, not Chrome; key file and base URL are in the file
   lookup table above. Read
   work/02-morning-brief/CLAUDE.md and work/07-email-triage/CLAUDE.md for conventions.
   Delegate only to genuinely independent, sizeable parallel tracks; this one is a single
   build, so do it yourself. Never a subagent to verify work already done.
3. Task steps:
   1. Confirm the trigger (new Gmail message) and end-state (briefing delivered).
   2. Design the node sequence: fetch, classify with Haiku, filter important, compile.
   3. Wire the Gmail credential and the classifier call. Model Routing rule: the classifier
      is a reasoning node, so no voice block; any human-facing briefing prose is a prose node
      and gets the injected soul voice block. Both node models come from
      `system/manifest.json` meta.model_routing, which V6 asserts against live n8n. Do not
      retype a model id into the workflow; read the contract.
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

`Built for: Opus 5 - Suggested effort: high` (rides outside the block AND is written into the saved file;
a multi-node live build with credentials would be `xhigh`, a one-node tweak `low`).

**This Example is also the clearest case of the two-model split (step 4, inspection fix P0-1/C23).** The
request names Haiku, but Haiku is the ARTIFACT model: it is what the classifier NODE will run, fixed by
`meta.model_routing` and stated rather than asked. The EXECUTOR model is Opus 5, because an interactive
Claude Code session is what builds the workflow. `Built for:` names the executor, never the artifact.
Before this fix the spec conflated the two, and a literal reading would have put `Haiku` on that line
above a prompt carrying Opus 5 instructions. Note also the harness: the delivered prompt runs in a SESSION
that builds a node, so it takes assembly shape A with the full universal layer. A prompt whose text lives
INSIDE the node would take shape B and drop the soul re-read, the skills sentence and the Close-Out step.

Shaheen answered the step-4 question with the default, so Identity carries the Opus 5 scope, conciseness,
corrections and progress lines and Resources carries the Opus 5 delegation cap. Had he answered Fable 5,
those would have been the boundaries block, the anti-over-engineering block, the lead-with-the-outcome
line, the delegate-and-keep-working line and the grounded-progress block instead.

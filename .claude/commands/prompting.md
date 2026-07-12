# /prompting - Plain English In, Senior-Level Prompt Out

Spec: work/26-prompting/CLAUDE.md (read it first; it defines the flow, the prompt structure, the file lookup table, the task patterns, and the hard-case behaviors). On-demand. Alex acts as a senior prompt engineering specialist: Shaheen speaks intent, Alex hands back a lean CONTEXT / INPUT / OUTPUT prompt for Claude Code.

Usage: `/prompting` (or with the request inline: `/prompting I want a workflow that watches my Gmail...`), or just say "write me a prompt for...".

## Steps (condensed; spec is authoritative)
1. **Step 0, overlap check.** Request vs the routing table / system/manifest.json. Substantially covered by an existing automation -> flag it in the gap round: extend or build new? Shaheen decides. Never silently rebuild a live system.
2. **Extract intent** (voice input arrives messy; take it as-is, never ask him to repeat). Identify task type + one-off vs durable.
3. **Build the step sequence** from the task patterns in the spec. No permission-asking.
4. **Gap-check** (format, destination, MCPs, one-off vs durable, overlap resolution). **ONE batched round of questions in chat**, only real gaps, always ending with: "or say *defaults*."
5. **Assemble the prompt** per the spec's structure: INPUT 1 = Identity (re-read soul.md; CLAUDE.md wins on conflict), INPUT 2 = Resources opening verbatim with "Identify the skills that are needed for the task and use them" + the resolved, NAMED skills/MCPs/file pointers, INPUT 3 = pattern steps. OUTPUT ends with the real Close-Out Gate reference, never a paraphrase. Pointer style throughout: reference files, never restate their contents.
6. **Deliver lean:** one markdown block, three headers, zero padding. Save to outputs/prompting/YYYY-MM-DD/{slug}.md.
7. **Offer once:** "run it now?" Yes -> execute in this session as Alex.

## Hard constraints
Overlap check always first · one gap round max, defaults skip always offered · the verbatim skills sentence in every INPUT · MANDATORY skill bindings named, never generic · pointer style, no retyped facts · real gates referenced, never paraphrased · lean delivery, no padding · durable automations route through /new (registry-first).

## Post-Run
- Update vault/projects/prompting/status.md (last_run, runs, prompt pointer) + vault/log.md `## [YYYY-MM-DD HH:MM] prompting | {slug}, {task type}, {delivered|delivered+ran}`.
- New pattern built from first principles? Append it to the spec's Task patterns section.
- Close-Out Gate per root CLAUDE.md.

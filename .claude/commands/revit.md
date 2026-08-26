# /revit - Run a Revit Job Under the Five-File Protocol

Spec: `work/33-revit-architect/CLAUDE.md` (read it first). Gate contract: `work/33-revit-architect/gates.json`. Protocol files (the source of truth, never restated): `C:\Users\Thinkpad\Desktop\01 Projects\Revit Bridge\Architect Test Prompts`.

Usage: `/revit` (optionally with the job inline, or with a brief / standards doc / project path attached).

## The flow, in order, every invocation

1. **Bring the bridge up and confirm it.** Revit open with a model, service switch on. Confirm with `get_current_view_info`, never `say_hello` (it opens a modal dialog, reports a false timeout, and freezes every call behind it).
2. **Load the protocol.** File 01 first, always. File 02 always, never optional. Then 03 / 04 / 05 per File 01's routing table. **State which files were loaded and why.**
3. **Classify the job into topics.** `gates.json` carries 24 topics with trigger words. Match the request to one or more. **Nothing maps → ask which file applies, never guess** (File 01 section 3). An ambiguous term that sits under two topics selects both.
4. **Select the question set in THREE layers:** core gates (always) + the HARD GATE block of every protocol file loaded + the gate pack of every matched topic, and **nothing else**. Gates marked `also_in` or `alias_of` are the same question in two layers, so resolve once and reuse. A parking job asks about parking ratios, compact-stall caps, aisle standards, ramp gradients and headroom. It does not ask about tag families.
5. **Resolve each selected gate**, first hit wins: **model** (cite the tool) → **source** (cite the line) → **session** → **ask**.
6. **Ask the remainder in ONE batched message**, grouped by topic. Never ask about anything already answered. Always offer the out: "or say *skip* on any of these."
7. **Honour a skip properly.** State the assumption aloud, log it, mark downstream output provisional, and downgrade the action to its most conservative form.
8. **Only then plan the work**, and only then execute it under the autonomy mode from File 01 Q6.

## Hard rules

They live in the protocol files and in `work/33-revit-architect/CLAUDE.md`, not here. **Read them there every run; do not work from memory of them.** This file stays a pointer on purpose: the rules are Shaheen's authored material and this command file is public, while the spec and the gate contract are not.

The two that decide whether a run is honest, named here only so they cannot be missed:

- **Never infer, never default.** Unclear counts as missing, and only an explicit `skip` bypasses a gate.
- **No compliance verdict without jurisdiction AND code edition.** Without them, report the measurement and state no pass or fail.

## Post-Run
- Write the session log to `vault/projects/revit-architect/sessions/YYYY-MM-DD-{slug}.md`, **even for a read-only run**.
- Update `vault/projects/revit-architect/status.md` (last_run, outcome) + `vault/log.md`.
- Deliverables to `outputs/revit-architect/YYYY-MM-DD/` with a ledger row (`node scripts/outputs-ledger.js add ...`).
- New bridge or tool defect → [[projects/error-log]] + [[research/revit-mcp-bridge]].
- Run the Close-Out Gate from root `CLAUDE.md` and print the Close-Out Report, including this project's Close-Out Extras.

# 26 - Prompting

## What it actually does
On demand: Shaheen describes what he wants in plain English, spoken or typed, and Alex acts as a senior prompt engineer, handing back a clean three-part prompt (context, input, output) ready to paste into Claude Code, or run right away in the same session. Before building anything it checks whether one of the existing automations already does the job, and if so it says so and asks whether to extend that instead of building a duplicate. If details are missing (what format, where it lives), it asks everything in one short round of questions, with a standing "just use defaults" escape hatch.

**Since 2026-08-26 it also asks which model will run the prompt**, every time Shaheen does not say. That is not bureaucracy. Anthropic publishes different prompting guidance per model, and some of it is opposite: Opus 5 wants delegation capped and verification instructions removed, while Fable 5 wants delegation turned up and explicit verifier subagents on long runs. A prompt written for the wrong model still reads perfectly and quietly works against the model running it, so the model is asked rather than guessed, and the answer is stamped on the delivered prompt as a `Built for:` line.

## Why it exists
Shaheen should never have to write prompts. He speaks intent; the system does the prompt engineering, at a senior level, every time, with the house rules baked in: the right skills named for the task, files referenced instead of copied (so prompts never go stale), the brand and close-out gates wired in by name, and no padding around the deliverable. It also protects the system from its most likely failure: plain English quietly re-describing something that already exists and getting it rebuilt under a new name.

## Works together with
- **The whole routing table** - step 0 checks every request against the live automations before generating anything.
- **The Skill Bindings table** - every generated prompt names the exact skills the task needs; mandatory ones are non-negotiable.
- **/new** - if the request is a durable automation rather than a one-off task, the prompt routes the build through the registry-first /new flow.
- **#25 Evolution** - a new Claude model shipping is what makes the model playbook stale, and #25's daily monitor is what notices. A new flagship needs a playbook section and a matching addendum block, or this function starts handing out guidance written for a model nobody is using.
- **#23 Self-Review** - every delivered prompt is saved to outputs/prompting/, so the weekly review can mine which prompts actually worked.

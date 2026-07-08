# Evolution (#25) - Keeping Alex Current

## Type
Automation. On-demand today; on activation (post-merge) a zero-token daily monitor + a weekly
Claude-assisted digest. Built from the refactor spec Phase 2 (ALEX-REFACTOR-SPEC-FOR-CLAUDE-CODE.md),
2026-07-09. This is the "keeping Alex current" layer: the AI landscape moves, Alex absorbs new models,
MCPs, and automation patterns as it does, with Shaheen as editor, not mechanic.

## Purpose
Three layers, fully-automated to human-gated:
1. **Monitor (passive, daily, zero-token):** fetch a small set of public, keyless feeds and log what is
   new. Gathers and logs, nothing else.
2. **Evaluate (weekly, one model call, human decides):** read the week's log, ask Claude - with full
   context on Alex's mission and current capabilities - what each item would add or replace, and get a
   recommend/skip verdict. One digest a week. Claude proposes, Shaheen decides.
3. **Integrate (gated, no side doors):** every approved item goes through the SAME generate-and-validate
   discipline as any other change. Nothing reaches production by a shortcut.

The payoff is compounding: in six months Shaheen reviews curated options instead of researching from
scratch; in two years the system has absorbed dozens of capabilities and upgraded models several times
with everything still fitting together, because every change went through one pipeline.

## Boundary vs #15 Alex AI Radar (READ THIS - the two look similar, they are not)
The radar (#15) watches the whole AI field for **Shaheen's** decisions: research, product opportunities,
content angles, scored into a Notion pipeline with taste memory. Its Tap 1 (Stream B) does surface new
MCPs/models/techniques - that overlap is real.

Evolution (#25) watches the same field through ONE narrow lens: **"does this change how ALEX ITSELF is
built?"** Its output is not a research feed; it is a proposal to edit `system/manifest.json`, the MCP
Reference in `CLAUDE.md`, or add a numbered automation - routed through the generator. If an item is
only Shaheen-facing news with no bearing on Alex's own build, the eval marks it skip: "radar territory."

Non-duplication rule: #25 does its own lightweight fetches for now. If the overlap ever costs more than
it's worth, the clean move is to have #25 CONSUME #15's Stream B output instead of re-fetching - noted
as an open option for Shaheen, deliberately not built yet (no premature coupling on an unmerged branch).

## Entry Points
- **On-demand now:** `node scripts/landscape-monitor.js` (fetch + log) and
  `node scripts/landscape-eval.js` (assemble this week's eval prompt; then feed it to one `claude -p`,
  which the eval wrapper does end-to-end).
- **Scheduled (on activation, post-merge):** daily monitor ~07:10, weekly eval Mon ~07:50 (rides the
  Monday cycle). See ## Activation.

## Files
- `scripts/landscape-monitor.js` - P2-S1. Zero-token. Public keyless feeds (GitHub release/commit Atom
  + HN Algolia JSON) across three categories (models | mcp | patterns). Dedupes on a stable id, appends
  only new items to `system/landscape-log.jsonl`. One source failing is logged and skipped; ALL failing
  is the only hard failure (exit 1). Sources are a DATA array at the top - edit it to add a feed.
- `scripts/landscape-eval.js` - P2-S2, deterministic half. Reads the last 7 days of the log. Empty week
  -> exit 3 (the wrapper posts nothing, stays GREEN). Otherwise assembles ONE prompt (the week's items +
  current automations + the MCP Reference section + the three questions + output format) and writes it
  to `outputs/evolution/YYYY-MM-DD/eval-prompt.txt`. Zero-token; the model call lives in the wrapper.
- `scripts/run-landscape-monitor.ps1` - hardened wrapper (close-out gate, HQ heartbeat). Runs the node
  monitor; no claude call.
- `scripts/run-landscape-eval.ps1` - hardened wrapper. Runs the assembler, feeds the prompt to a single
  `claude -p`, saves `outputs/evolution/YYYY-MM-DD/digest.md`, opens a GitHub issue tagged
  `ai-landscape-update` IF `gh` is installed (else keeps the digest local and says so), HQ push, close-out.
- `system/landscape-log.jsonl` - append-only monitor memory `{date, category, source, item, link, id}`.

## Model routing (house rule)
The monitor is zero-token by design (no model call). The eval's single weekly call is human-facing
reasoning that produces a digest Shaheen reads, so per the model-routing rule it runs on Claude
(`claude -p`, the on-machine plan), not the n8n OpenAI writer path. This is reasoning + a digest, not
n8n prose generation.

## Integration (P2-S3) - the gated runbook the weekly digest links to
For EVERY item Shaheen approves from a digest, same discipline as any other change - never a side door:
1. **New MCP** -> add it to `system/manifest.json` (and its metric slug if it produces one) AND to the
   MCP Reference section of `CLAUDE.md`. Load it via ToolSearch per the MCP Reference rules.
2. **New model** -> test it in a SANDBOX automation first (a throwaway `work/` scratch or the Writer
   Voice Eval harness), never straight to production. If it becomes the prose model, update the
   Model Routing rule in `CLAUDE.md` and re-run the voice sync + the Writer Voice Eval.
3. **New pattern** -> it becomes the next numbered automation (#26, #27, ...): write its
   `system/manifest.json` entry FIRST (the /new discipline), then scaffold `work/NN-name/`.
4. Run **`node scripts/generate-alex.js`** -> all docs and integrations regenerate.
5. **Phase 3 validation runs and passes** (G1-G4 + V1-V6). A red check blocks the commit; fix the named
   drift, don't bypass.
6. Shaheen **reviews the diff once, approves, merges.** That is the only path to production.

## Activation (post-merge - deliberately deferred, see the note)
Nothing is scheduled live yet. Two reasons: (a) the wrappers live on the `refactor/v2-architecture`
branch, and a live Windows task pointing at a branch-only wrapper breaks the moment anyone checks out
main; (b) the weekly eval burns plan tokens, so it should not auto-start without Shaheen's go. This
matches the spec's own rule: build Phase 2 last, after Phase 1 is merged. Activation is one step:

1. In `system/manifest.json` #25: set `state` -> `LIVE`, `hq_project` -> `"evolution"`,
   `schedule_jobs` -> `["PersonalOS-landscape-monitor", "PersonalOS-landscape-eval"]`.
2. Add two `### ` entries to `scheduler/schedule.md` (daily 7:10 AM monitor; Monday 7:50 AM eval),
   each naming its `PersonalOS-*` job - templates ready below.
3. `node scripts/generate-alex.js` -> the scheduler step (create-missing-only) registers both tasks
   against the now-existing wrappers; then apply standard hardening per schedule.md Task Hardening.
4. Validation must stay green (V2 will now see documented == live), then commit + merge.

Optional: install + auth the `gh` CLI so the weekly digest auto-opens as an `ai-landscape-update`
GitHub issue; until then the digest is saved to `outputs/evolution/YYYY-MM-DD/digest.md` and pushed to
Alex HQ.

### schedule.md entry templates (paste on activation)
```
### Landscape Monitor (#25)
- Command: scripts/run-landscape-monitor.ps1 (pure Node, no claude call, zero tokens)
- Frequency: daily at 7:10 AM (Task Scheduler job PersonalOS-landscape-monitor)
- Description: Fetches public keyless feeds (Claude models, MCPs, n8n patterns), appends new items to system/landscape-log.jsonl. GREEN/RED to Alex HQ.
- Added: <activation date>

### Landscape Eval (#25)
- Command: scripts/run-landscape-eval.ps1 (one claude -p call/week)
- Frequency: Monday at 7:50 AM (Task Scheduler job PersonalOS-landscape-eval)
- Description: Reads the week's landscape log, one Claude call assesses each item (add/replace/relevance) with recommend/skip, writes outputs/evolution/YYYY-MM-DD/digest.md + opens an ai-landscape-update issue if gh is present. Empty week posts nothing.
- Added: <activation date>
```

## Vault Structure
- Tier 1: `vault/projects/evolution/status.md` (state, last run, activation status, output paths).
- Tier 2: the weekly digests in `outputs/evolution/YYYY-MM-DD/` are the running record.

## Close-Out Extras
- Monitor run: `system/landscape-log.jsonl` grew (or "0 new" is logged), HQ heartbeat sent.
- Eval run: digest saved to `outputs/evolution/YYYY-MM-DD/`, path in status.md; GitHub issue opened OR
  the local-only fallback is logged with the reason (gh absent).

## Guardrails (from soul.md)
- Alex proposes, Shaheen decides. The eval never installs, edits, or schedules anything - it writes a
  digest.
- No invented items: the eval may only assess what the monitor actually logged; unknown stays unknown.
- No model-verifier chains: one deterministic monitor + one model call + a human gate.

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
  **Upgrade P13 (2026-07-13):** (b29) dropped two ~96%-noise feeds - `anthropic-sdk-python releases`
  (SDK point bumps, not model launches) + `MCP servers commits` (CI/docs churn) - and tightened
  `HN: n8n` minPoints 20->40. (c8) `MAX_PER_SOURCE_PER_RUN=6` caps new items per feed per run (the
  rest drain next run) so one chatty feed can't flood the log. (b30, the highest-value fix) a
  `category:'deployed'` self-probe logs the box's OWN running versions - n8n via ssh (`docker compose
  exec n8n n8n --version`) + the deployed writer model via an authenticated `#03` workflow GET - so
  the weekly eval compares RELEASED-vs-DEPLOYED instead of guessing (the 2.21.7-guessed-as-1.x
  incident). Idempotent (the row id is the version+model signature, logs only on change), best-effort
  (any probe failure just skips the deployed row, the public feeds never depend on it). The wrapper
  passes `N8N_API_URL`/`N8N_API_KEY` so the model half runs daily; still ZERO-TOKEN (no LLM). First
  real row 2026-07-12: `n8n 2.21.7 · writer model claude-sonnet-4-6`.
- `scripts/landscape-eval.js` - P2-S2, deterministic half. Reads the last 7 days of the log. Empty week
  -> exit 3 (the wrapper posts nothing, stays GREEN). Otherwise assembles ONE prompt (the week's items +
  current automations + the MCP Reference section + the three questions + output format) and writes it
  to `outputs/evolution/YYYY-MM-DD/eval-prompt.txt`. Zero-token; the model call lives in the wrapper.
- `scripts/run-landscape-monitor.ps1` - hardened wrapper (close-out gate, HQ heartbeat). Runs the node
  monitor; no claude call.
- `scripts/run-landscape-eval.ps1` - hardened wrapper. Runs the assembler, feeds the prompt to a single
  `claude -p`, saves `outputs/evolution/YYYY-MM-DD/digest.md`, opens a GitHub issue tagged
  `ai-landscape-update` IF `gh` is installed (else keeps the digest local and says so), HQ push, close-out.
- `system/landscape-log.jsonl` - append-only monitor memory `{date, category, source, item, link, id}`
  (skills rows also carry `extra:{repo, author, popularity, ...}`).
- `system/skills-sources.json` - DATA config for the skills lane (directories + portfolio_keywords +
  trust_allowlist + weekly_install_cap + max_log_per_run + audit rules). Edit this, not code, to tune.
- `scripts/skills-installer.js` - deterministic zero-token auto-install engine (audit + install + 4b
  recall-architecture wiring + git commit per install). Reads the eval digest's json block; `--dry-run`
  or `--manifest <file>` for safe testing.

## Model routing (house rule)
The monitor is zero-token by design (no model call). The eval's single weekly call is human-facing
reasoning that produces a digest Shaheen reads, so per the model-routing rule it runs on Claude
(`claude -p`, the on-machine plan), not the n8n OpenAI writer path. This is reasoning + a digest, not
n8n prose generation.

## Skills lane - discovery + auto-install (2026-07-11, Shaheen's decision: full auto-install)
The weekly eval also evaluates AGENT SKILLS and auto-installs the good ones. Three stages:
1. **Discover (daily monitor, zero-token):** scripts/landscape-monitor.js reads system/skills-sources.json
   and scans skills.sh (real install counts) + skillsmp.com + skillhub.club (allowlisted authors ONLY -
   their stars are whole-repo/mirror-bot noise) for the portfolio_keywords, logging up to max_log_per_run
   new `category:'skills'` rows to system/landscape-log.jsonl.
2. **Assess (weekly eval, one model call, READ-ONLY):** scripts/landscape-eval.js feeds the week's skills +
   the installed set (skills-lock.json) + the Skill Bindings contract + the auto-install policy into the
   prompt. The model dedups, matches each skill to a NAMED automation, and emits a fenced json install
   block. It proposes; it never installs.
3. **Install + wire (deterministic, zero-token):** scripts/skills-installer.js reads that json block and
   per candidate runs the validation gate that stands in for the removed human gate: resolve GitHub source
   -> trust_allowlist -> source audit (no install-hooks / process-spawning / exfil scripts, SCOPED to the
   skill's own dir since `skills add` copies only that) -> dedup vs skills-lock -> weekly_install_cap.
   Survivors: `npx -y skills add`, verify/recreate the .claude symlink, upsert skills-lock.json, WIRE into
   the recall architecture (root CLAUDE.md auto-region row + the target work/NN/CLAUDE.md `## Skills` line),
   run generate-alex.js, git-commit per install (git revert <sha> = undo). Off-allowlist authors, audit
   failures, cap overflow, and un-targeted skills are reported as "Flagged, manual review", never installed.
- skill-creator + skill-development stay MANDATORY when an approved item lands as a NEW/changed skill of
  our own; agent-development advisory for subagent designs.
- Only the skills lane auto-installs. Everything else keeps the human gate. See vault/research/skills-sh-sweep.md.

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

## Activation (ACTIVATED 2026-07-09)
**ACTIVATED 2026-07-09** (confirmed live by /deep-audit D4, 2026-07-14: `PersonalOS-landscape-monitor` daily 07:10 + `PersonalOS-landscape-eval` Mon 07:50 both firing, last green 07-13). The steps below are the historical activation record; the original deferral reasoning was: (a) the wrappers live on the `refactor/v2-architecture`
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
- Skills lane (eval run): scripts/skills-installer.js ran; its report is appended to the digest +
  saved to `outputs/evolution/YYYY-MM-DD/skills-install-report.md`. If any skill installed, verify all of:
  skills-lock.json changed, the root CLAUDE.md auto-region gained a row, the target `work/NN/CLAUDE.md`
  `## Skills` line was added, one git commit per install exists, and the HQ headline names the count +
  the revert path. Flagged skills are listed (not installed), so nothing half-integrated is left silent.

## Known limitations / tuning backlog (from the first live runs, 2026-07-09)
- **Log the box's OWN running versions (highest-value fix).** The first eval guessed which n8n line the
  box runs - it logs public release tags, not deployed versions - and guessed wrong (said 1.x; the box
  is on 2.21.7). Fix: have the monitor also record the live versions of Alex's own stack (n8n on the
  Hetzner box, the Claude model in the writer nodes) into landscape-log.jsonl, so the eval compares
  "what's released" against "what we actually run" instead of inferring it.
- **Two noisy feeds.** `anthropic-sdk-python releases` surfaces SDK point bumps, not model launches;
  `MCP servers commits` surfaces CI/docs commits, not new servers (~2 useful of 58, both runs). If it
  stays that way, swap them in the SOURCES array (Anthropic models list/news for models; the MCP
  registry for servers).
- **Eval output contract (DONE 2026-07-09).** The nested claude -p ran as full Alex and emitted a
  conversational reply + Close-Out Report + ran Change Propagation instead of a clean digest. Fixed by
  the read-only / digest-only output contract now in scripts/landscape-eval.js.

## Schema-Drift Detector (planned, spec 2026-07-15 - context-engineering research run)
Not built yet. Specced here so a build can drop straight in; do NOT advertise it in the manifest
one-liner until it ships (honesty rule - no vaporware in the routing table). Backlog line in
`vault/projects/evolution/status.md`.

**The problem it closes.** The `## MCP Reference` in root `CLAUDE.md` (~lines 172-206) is HAND-WRITTEN
and drifts from live tool schemas. It has already bitten a run: 2026-07-13 the Google Calendar
`list_events` params were renamed `timeMin/timeMax` -> `startTime/endTime` and a run 404'd (error-log).
#25 today monitors NEW MCPs/models/patterns; it does NOT watch for SCHEMA DRIFT on the tools already
in use. This adds that lane, on the same rails (monitor -> log -> weekly eval -> human-gated fix).

**Baseline (the diff target): `system/mcp-reference.json`** - a hand-maintained machine mirror of the
PARAMETER facts asserted in the CLAUDE.md MCP Reference, per tracked tool (e.g. Calendar `list_events`
-> `startTime`/`endTime`; Gmail search -> `query`; Notion date -> `date:Field:start`). The prose already
parses for the tool SET (`scripts/lib/read-sources.js` `parseMcpList`), but param shapes are not in the
prose, so the JSON mirror is the canonical machine baseline. It is itself a "keep in sync with CLAUDE.md"
surface (the fix step updates both together).

**Capture (the honest hard part).** Most MCP tool schemas are visible ONLY as loaded function
definitions INSIDE a Claude Code session (deferred tools loaded via ToolSearch); the claude.ai-brokered
connectors (Gmail, Calendar, Notion, Drive) have no headless HTTP endpoint Alex can poll for their
schemas. Two capture lanes, by tool kind:
- **Brokered tools (the drift-prone ones):** a thin capture step RIDES an existing daily `claude -p`
  session (piggyback the morning brief, or a tiny dedicated micro-session - this is the ONE non-zero-token
  part, same budget shape as the weekly eval's single call, and it does NO reasoning). It ToolSearch-loads
  the tracked set named in `system/mcp-reference.json` and dumps each live loaded schema to
  `system/mcp-live-schemas.json`. Deterministic write of already-in-context JSON; no model thinking.
- **HTTP-reachable MCPs (e.g. the n8n Application Engine MCP):** call the server's own `tools/list` over
  HTTP with the bearer - fully zero-token, no session needed. Prefer this lane whenever a tool exposes it.

**Diff (zero-token, pure Node).** A sibling of `landscape-monitor.js` (or a new mode of it) compares
`system/mcp-live-schemas.json` against `system/mcp-reference.json` per tracked tool: added/removed/renamed
params and shape changes. Any mismatch appends ONE row to `system/landscape-log.jsonl` under a NEW
`category:'schema'` with `{date, category:'schema', source:'<tool>', item:'<param X renamed/removed>',
id:<stable signature>}`. Idempotent (id = the drift signature, logs only on change), best-effort (a
missing live dump just skips, the public feeds never depend on it) - the exact discipline of the b30
`category:'deployed'` self-probe, which already proved the RELEASED-vs-DEPLOYED shape; this is
MIRROR-vs-LIVE for tool params.

**Surface + fix (human-gated, no auto-edit of CLAUDE.md).** The weekly `landscape-eval.js` already reads
every new log row; `category:'schema'` rows appear in the digest flagged as drift, recommend = "fix the
MCP Reference". Shaheen applies it through `## Integration` step 1 (edit the CLAUDE.md MCP Reference AND
`system/mcp-reference.json` together, run `generate-alex.js`, V4 re-checks MCP set consistency). The
detector NEVER edits CLAUDE.md itself - models/MCPs/patterns keep the human gate; only the skills lane
self-installs.

**Build checklist (when it ships):** add `system/mcp-reference.json` (seed it from the current MCP
Reference, starting with the params that already drifted: Calendar, Gmail, Notion) + the capture step +
the diff + `category:'schema'` handling in the eval prompt; add a tracked-tool list to
`system/skills-sources.json`'s sibling or inline in `mcp-reference.json`; then update the manifest
one-liner and run `generate-alex.js` (now it is real). Effort: ~1-2 days, the capture harness is the work.

## Guardrails (from soul.md)
- Alex proposes, Shaheen decides - with ONE owner-approved exception (2026-07-11): the SKILLS lane
  auto-installs. Even there the MODEL never acts - it writes a digest + a json proposal, fully read-only;
  a separate deterministic, audited, git-reversible installer (scripts/skills-installer.js) does the
  install with no human gate. Models, MCPs and patterns still get the human gate (## Integration).
- No invented items: the eval may only assess what the monitor actually logged; unknown stays unknown.
- No model-verifier chains: one deterministic monitor + one model call + deterministic audited action.

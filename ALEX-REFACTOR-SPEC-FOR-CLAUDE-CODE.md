# ALEX PERSONAL OPS SYSTEM — REFACTOR SPEC v2.1 (FOR CLAUDE CODE)

**Date:** 2026-07-08
**Root:** `C:/Users/Thinkpad/Desktop/personal-os`
**Audience:** Claude Code. This document is your instruction set. Execute it in order, step by step.
**Basis:** `alex-refactor-architecture-v2.md` (Shaheen's v2 proposal) + four architect amendments agreed 2026-07-08.
**Companion:** `architecture-analysis-2026-07-08.md` (analysis of the current system).

---

## HOW TO READ THIS DOCUMENT (Claude Code: read this first)

- The document has **three phases**: Phase 1 (Building), Phase 2 (Keeping Alex Current), Phase 3 (Validation & Testing Framework).
- **Execution order is: Phase 1 → Phase 3 → Phase 2.** Phase 3 (validation) must exist and pass before Phase 2 (evolution) is built, because the evolution loop depends on the generate-and-validate pipeline. The phases are numbered by importance to the owner, not by build order.
- Never proceed past a failed step. Stop, report, wait for approval.
- Work on a git branch (`refactor/v2-architecture`). Commit after every numbered step with the step ID in the commit message (e.g. `P1-S3: unified generator skeleton`).
- Anything marked **[ASK SHAHEEN]** requires his decision before you continue. Do not guess.

---

## GROUND RULES — NON-NEGOTIABLE INVARIANTS

These must be true before, during, and after the refactor. Violating any of these is a failed run.

1. **`soul.md` is untouched.** No edits to its content, location, or the SessionStart hook that injects it. Layer 1 is already correct.
2. **Runtime loading never breaks.** `soul.md` injects via SessionStart hook; `CLAUDE.md` (project) auto-loads. After every step, Alex must still boot with correct identity and voice.
3. **Sources are markdown + JSON, edited by hand. Views are generated, never hand-edited.** No database. No build step between Shaheen and his sources.
4. **Change Propagation exists in exactly ONE place** after the refactor (inside project `CLAUDE.md`, "Standing Orders" section at the top).
5. **Exactly ONE custom zone** in all generated output: the hand-written welcome block in `docs/README.md`, preserved between `<!-- CUSTOM_START -->` / `<!-- CUSTOM_END -->` markers. Do not add custom zones anywhere else.
6. **No prose hidden in code.** All human-readable text that appears in generated documents lives in `templates/*.template.md` files, never as string literals inside the generator script.
7. **No credentials in code.** n8n API access uses environment variables (`N8N_API_URL`, `N8N_API_KEY`). Fail loudly if they are missing when a check needs them.
8. **Generation is atomic.** All outputs are written to a staging directory, validated, then swapped in. A run succeeds as a whole or fails as a whole. No partial writes ever ship.

---

## LOCKED DECISIONS (agreed 2026-07-08 — do not re-litigate)

| # | Decision | Source |
|---|----------|--------|
| D1 | Adopt Shaheen's v2 six-layer architecture as the base | v2 proposal |
| D2 | Retire `PROTOCOL.md`. Any genuinely unique sentence folds into the `ARCHITECTURE.md` preamble template | v2 §Tier 1 |
| D3 | Retire `SYSTEM-GUIDE.md` and `SCHEDULING-GUIDE.md` as hand-written files; their content is generated into `GETTING-STARTED.md` + `ARCHITECTURE.md` | v2 §Tier 2 |
| D4 | Change Propagation collapses to one copy in project `CLAUDE.md` — **with the global-file amendment (A1 below)** | v2 §Tier 1 + amendment |
| D5 | Fix the model-routing contradiction BEFORE any generation | v2 §Tier 1 |
| D6 | Unified generator with atomic all-or-nothing semantics | v2 Layer 5 |
| D7 | Six validation checks run after every generation and on CI; failure blocks the merge | v2 Layer 6 |
| D8 | Only two hand-authored docs: root `docs/README.md` (welcome block) and the brand README | v2 §Tier 2 |
| D9 | Brand hierarchy formalized: `color-system.md` = immutable law; `brand-config.md` = application only; duplicated rules deleted from `brand-config.md`; inline hexes removed from `CLAUDE.md` | v2 Layer 3 |
| D10 | Continuous evolution system (monitor → evaluate → integrate) built LAST, after refactor + validation are stable | v2 §5 |
| **A1** | **Amendment — global `~/.claude/CLAUDE.md`:** it is machine-wide and affects every Claude Code project on this machine, not just personal-os. Before merging: check whether other projects rely on it (the graphify skill pointer, Change Propagation). If yes → keep a THIN global file containing only cross-project skill pointers, and move all Alex-specific standing orders into project `CLAUDE.md`. If Alex is the only project → full merge and retire the global file. **[ASK SHAHEEN]** which case applies. | architect review |
| **A2** | **Amendment — relocate `manifest.json`:** move it from `work/18-recovery-layer/manifest.json` to `system/manifest.json` at the repo root. A system-wide registry must not live inside one numbered project. Update every path reference. | architect review |
| **A3** | **Amendment — validation checks reality, not documents:** the model-routing check pulls the LIVE workflow definition from the n8n API and compares it to the rule in `CLAUDE.md`. The scheduled-jobs check queries Windows Task Scheduler (`schtasks /query`) in addition to counting `scheduler/schedule.md`. Docs-vs-docs comparison alone is not acceptable — two documents can agree and both be wrong. | architect review |
| **A4** | **Amendment — templates live outside code:** all generated-document prose lives in `templates/*.template.md` with `{{placeholder}}` slots. The generator fills slots; it never contains document prose as string literals. | architect review |
| **A5** | **Amendment — hex check softened:** validation check #5 is "no hex value outside `color-system.md` that does not match a defined token," NOT "no raw hex anywhere." `color-system.md` itself and generated CSS/token blocks legitimately contain hexes. | architect review |
| D11 | Language: **Node.js** (`generate-alex.js`). Reason: `sync-soul-to-n8n.js` is already Node, Node is what Claude Code drives most reliably, and it is cross-platform. PowerShell is invoked ONLY as a subprocess for Windows Task Scheduler registration. | agreed in review |

---

# PHASE 1 — BUILDING

Goal: a clean, single-owner source of truth and one unified generator that produces every human-facing document and system integration.

## P1-S0 — Pre-flight (do this before touching anything)

1. `git status` must be clean. Create branch `refactor/v2-architecture`.
2. Create a timestamped backup: copy the entire repo to `../personal-os-backup-2026-07-08/` (outside the repo).
3. Read, in full, before editing anything: `soul.md`, `CLAUDE.md` (project), `~/.claude/CLAUDE.md` (global), `~/.claude/rules/context7.md`, `PROTOCOL.md`, `SYSTEM-GUIDE.md`, `GETTING-STARTED.md`, `SCHEDULING-GUIDE.md`, `brand/config/color-system.md`, `brand/config/brand-config.md`, `work/18-recovery-layer/manifest.json`, `scheduler/schedule.md`, `scripts/generate-surfaces.ps1`, `scripts/sync-soul-to-n8n.js`, and the `/cron-setup` implementation.
4. Build a reference-map file `refactor/reference-map.md`: every file that mentions `PROTOCOL.md`, `SYSTEM-GUIDE.md`, `SCHEDULING-GUIDE.md`, `GETTING-STARTED.md`, the global CLAUDE.md, or the `work/18` manifest path (grep the whole repo). Every entry in this map must be resolved by the end of Phase 1 — no dangling references.

## P1-S1 — Clean the source (Tier 1)

**S1.1 — Resolve the model-routing contradiction (blocks everything else).**
- Current state: `CLAUDE.md` model-routing rule says prose → `gpt-4.1-mini`; the live `Build Writer Request` workflow runs `claude-sonnet-4-6`.
- **[ASK SHAHEEN]**: which is the truth? (Recommended: change the rule to `claude-sonnet-4-6` to match production, and record a one-line rationale in `CLAUDE.md`.)
- Apply the decision to `CLAUDE.md` AND confirm the n8n workflow matches. Rationale documented next to the rule. Nothing is generated before this is resolved — generating from a contradictory source produces faithful copies of the contradiction.

**S1.2 — Retire `PROTOCOL.md`.**
- Scan it once for any sentence that states something found NOWHERE in `soul.md`, `CLAUDE.md`, or the brand files. Expected result: nothing unique. If a unique sentence exists, move it into the `ARCHITECTURE.md` preamble template (created in S3).
- `git rm PROTOCOL.md`. Remove every reference to it (use the reference map).

**S1.3 — Collapse Change Propagation / handle the global file (per A1).**
- First: list all Claude Code projects on this machine and check which ones rely on `~/.claude/CLAUDE.md` (graphify pointer, Change Propagation).
- **[ASK SHAHEEN]** — Case A (other projects rely on it): reduce the global file to skill pointers only (graphify + context7 rule stays as-is at `~/.claude/rules/context7.md`); move Change Propagation and all Alex-specific orders into project `CLAUDE.md`. Case B (Alex only): merge everything into project `CLAUDE.md` and retire the global file.
- Either way, the end state is: project `CLAUDE.md` opens with a **"Standing Orders"** section at the top containing the single canonical copy of Change Propagation. No second copy exists anywhere in the repo.

**S1.4 — Relocate the registry (per A2).**
- `git mv work/18-recovery-layer/manifest.json system/manifest.json`.
- Update every path reference: `generate-surfaces.ps1` (until it is absorbed in S3), `CLAUDE.md`, any work/{n} files, any docs. Grep to confirm zero references to the old path remain.

**S1.5 — Formalize the brand hierarchy (per D9).**
- `color-system.md`: law only — palette, hexes, tokens, contrast pairings. Remove any application logic that belongs in the config layer.
- `brand-config.md`: application only — how to use color in Excel, decks, charts, PDFs, logo rules, fonts, tone (tone still defers to `soul.md`).
- Any rule currently defined in BOTH files (known case: chart series order — `brand-config.md:38` vs `color-system.md:93`) is deleted from `brand-config.md` and kept only in `color-system.md`.
- Add a one-line header to each file stating the hierarchy: "LAW — on conflict, this file wins" / "APPLICATION — on conflict, color-system.md wins."

**S1.6 — Remove inline hexes from `CLAUDE.md`.**
- Replace every hand-typed hex value in `CLAUDE.md` (known: brand protocol section, ~L144, L164) with token references (e.g. `{{token:primary-teal}}` resolved at generation time, or a plain-text pointer to the token name). After this step, a palette change means editing `color-system.md` only.

**Tier 1 exit criteria:** contradiction resolved; `PROTOCOL.md` gone; one Change Propagation copy; manifest at `system/manifest.json`; brand hierarchy clean; no inline hexes; Alex still boots (run a session-start smoke test now, before Tier 2).

## P1-S2 — Templates (per A4)

Create `templates/` at repo root:

```
templates/
  getting-started.template.md     # onboarding + operations: prereqs, connectors, /setup,
                                  # {{AUTOMATION_LIST}}, {{SCHEDULED_JOBS}}, {{MCP_LIST}}, scheduling how-to
  architecture.template.md        # human preamble + {{CLAUDE_MD_BODY}} — the constitution for deep readers
  readme.template.md              # root landing: custom-zone welcome + {{QUICK_START}} generated block
  routing-table.template.md       # the table skeleton for docs/projects/README.md and the CLAUDE.md region
```

Rules:
- Template prose is hand-authored ONCE, here, and versioned. Editing onboarding wording = editing a template, never the generator.
- Placeholders use `{{NAME}}` syntax. The generator fails loudly on any unresolved placeholder (this becomes validation check territory too).
- Migrate the still-accurate prose out of the current `SYSTEM-GUIDE.md`, `GETTING-STARTED.md`, and `SCHEDULING-GUIDE.md` into these templates. Correct known stale facts during migration (19→24 class of errors — but counts themselves become placeholders, never literals).

## P1-S3 — The unified generator: `scripts/generate-alex.js`

Node.js, single entry point, structured as small pure modules. Target layout:

```
scripts/
  generate-alex.js            # entry point + orchestration + atomic swap
  lib/
    read-sources.js           # loads soul.md, CLAUDE.md, brand files, system/manifest.json,
                              # scheduler/schedule.md into one in-memory model; fails on parse errors
    render-templates.js       # fills templates/*.template.md; fails on unresolved {{placeholders}}
    gen-routing-table.js      # manifest → routing table (absorbs generate-surfaces.ps1 logic)
    gen-docs.js               # → docs/GETTING-STARTED.md, docs/ARCHITECTURE.md,
                              # docs/README.md (preserving the custom zone), docs/projects/README.md
    gen-claude-region.js      # regenerates ONLY the marked routing region inside CLAUDE.md;
                              # refuses to run if markers are missing or malformed
    sync-n8n-voice.js         # absorbs sync-soul-to-n8n.js: soul.md "My Words" →
                              # <<<SOUL_VOICE>>> markers in n8n writer nodes (n8n API, env creds)
    gen-scheduler.js          # scheduler/schedule.md → Windows Task Scheduler jobs
                              # (invokes PowerShell/schtasks as subprocess — the ONLY PowerShell touchpoint)
    atomic-write.js           # stage to .staging/, fsync, then swap; rollback on any failure
    log.js                    # step-by-step run log to refactor/last-run.log
  validate-alex.js            # Phase 3 — separate entry point, also called by generate-alex.js as final step
```

Orchestration contract (`generate-alex.js`):
1. Read all sources → in-memory model. Any read/parse failure aborts the run.
2. Render all outputs into `.staging/` (never in place). The custom zone in the existing `docs/README.md` is read and re-embedded verbatim.
3. Run `validate-alex.js` against `.staging/` + live systems (see Phase 3).
4. On validation pass: atomic swap staging → real paths, apply n8n sync, apply scheduler jobs, write run log, exit 0.
5. On ANY failure: delete staging, touch nothing real, print the specific failing step and reason, exit 1.
- CLI flags: `--dry-run` (generate to staging, validate, report, never swap), `--only=<output>` (single output for debugging; still validates).

Why one script (from the v2 proposal — preserved verbatim as requirements): a single entry point; atomic transactions; shared context so cross-file problems are catchable (e.g. manifest references an MCP absent from `CLAUDE.md`); linear scaling — a new output is one new module + one orchestration line, never a new standalone script.

## P1-S4 — Retire the old surfaces

Only after `generate-alex.js --dry-run` passes and outputs look correct:
1. `git rm SYSTEM-GUIDE.md SCHEDULING-GUIDE.md` (and the old hand-written `GETTING-STARTED.md` — its replacement is generated at `docs/GETTING-STARTED.md`).
2. Retire `scripts/generate-surfaces.ps1` and standalone `sync-soul-to-n8n.js` (absorbed into the generator). Keep them in git history only.
3. Resolve every remaining entry in `refactor/reference-map.md`. Grep-confirm zero references to retired files.
4. Hand-write the two authored docs per D8: the welcome block of `docs/README.md` (inside the custom zone) and `brand/README.md`.

## P1 — File inventory at exit (the acceptance picture)

**Hand-authored (8):** `soul.md` · `CLAUDE.md` (with Standing Orders on top + marked generated routing region) · `brand/config/color-system.md` · `brand/config/brand-config.md` · `system/manifest.json` · `scheduler/schedule.md` · `docs/README.md` custom zone · `brand/README.md`
**Templates (hand-authored prose, generation inputs):** `templates/*.template.md`
**Generated (never hand-edited):** `docs/GETTING-STARTED.md` · `docs/ARCHITECTURE.md` · `docs/projects/README.md` · the routing region inside `CLAUDE.md` · n8n voice block · Task Scheduler jobs
**Retired:** `PROTOCOL.md` · `SYSTEM-GUIDE.md` · `SCHEDULING-GUIDE.md` · global `~/.claude/CLAUDE.md` (merged or thinned per A1) · `generate-surfaces.ps1` · standalone `sync-soul-to-n8n.js`

---

# PHASE 2 — KEEPING ALEX CURRENT (Continuous Evolution System)

**Build order note: build this LAST — only after Phase 1 is merged and Phase 3 validation is green.** It depends on a clean, generated base to integrate into. Budget ≈ 1 week of setup, then light maintenance.

Goal: Alex absorbs new Claude models, new MCPs, and new automation patterns as the landscape moves, with Shaheen as editor, not mechanic. Three parts, from fully automated to human-gated.

## P2-S1 — Monitoring layer (passive, fully automated, daily)

A scheduled job (registered via `scheduler/schedule.md`, so it goes through the normal pipeline) that gathers and logs — nothing else:
- **New Claude models:** watch Anthropic's release channel / changelog.
- **New MCPs:** watch the MCP registry and relevant GitHub topics.
- **New automation patterns:** a curated list of n8n templates + trending repos in Shaheen's domain.
- Output: append-only log `system/landscape-log.jsonl` (date, source, item, link). No human involvement at this stage.

## P2-S2 — Evaluation layer (Claude-assisted, human decides)

Weekly job that reads the week's log entries and prompts Claude — with full context on Alex's mission and current capabilities (feed it `system/manifest.json` + the MCP reference from `CLAUDE.md`) — to assess each item:
- "Is this new MCP relevant to Alex? What would it add? What would it replace?"
- "Is this model better than the current prose model for our use? Cost/latency change?"
- "Would this pattern improve any existing automation?"
- Output: ONE weekly digest as a GitHub issue tagged `ai-landscape-update` (e.g. "New MCP `web-search-pro` released · Claude Sonnet 5.0 available · trending n8n template: social-media-scheduler"), each item with Claude's relevance assessment and a recommend/skip verdict. **Claude proposes; Shaheen decides.** A few minutes of triage per week.

## P2-S3 — Integration layer (semi-automated, gated by approval)

For every item Shaheen approves, the SAME discipline as any other change — never a side door:
1. New MCP → added to `system/manifest.json` and the MCP reference in `CLAUDE.md`.
2. New model → tested in a **sandbox** automation first; never straight to production.
3. New pattern → becomes the next numbered automation (#26, #27, …) via `manifest.json`.
4. `generate-alex.js` runs → all docs and integrations regenerate.
5. Phase 3 validation runs and passes.
6. Shaheen reviews the diff once, approves, merges.

**Payoff (the design intent, kept as acceptance language):** in six months, reviewing curated options instead of researching from scratch; in two years, a system that has absorbed dozens of capabilities and upgraded models several times with everything still fitting together, because every change went through the same generate-and-validate discipline.

---

# PHASE 3 — VALIDATION & TESTING FRAMEWORK

Two distinct instruments. The **migration test suite** runs ONCE, immediately after Phase 1, and proves the change did no harm. The **validation layer** runs FOREVER — after every generation and on every CI commit — and proves the system stays consistent. *The migration suite proves the change was safe; the validation layer proves the system stays safe.*

## P3-S1 — The validation layer: `scripts/validate-alex.js` (Layer 6)

Runs automatically as the final step of every `generate-alex.js` run, and standalone on CI (git pre-commit hook or GitHub Action). Any failure exits 1, blocks the swap/merge, and names exactly what drifted and where. The six checks:

| # | Check | Compares | Fail condition |
|---|-------|----------|----------------|
| V1 | Automation count | Count in generated `GETTING-STARTED.md` vs count of non-retired entries in `system/manifest.json` | Any mismatch |
| V2 | Scheduled jobs — **reality-aware (A3)** | `scheduler/schedule.md` entries vs generated docs vs **live `schtasks /query` output** | Doc mismatch, or a job in the source missing from Task Scheduler, or an unknown live job |
| V3 | No retired-as-live | Every `RETIRED` entry in `manifest.json` vs every "live automations" list in every generated doc | A retired item listed as live |
| V4 | MCP consistency | MCPs named in generated `ARCHITECTURE.md` vs the MCP Reference section of `CLAUDE.md` | Any set difference |
| V5 | Tokens, not stray hexes — **softened (A5)** | Every hex value outside `color-system.md` vs the token table defined in `color-system.md` | A hex outside the law file that matches no defined token |
| V6 | Model routing — **reality-aware (A3)** | The prose-model rule in `CLAUDE.md` vs the **live workflow definition pulled from the n8n API** (`N8N_API_URL`/`N8N_API_KEY` env vars) | Rule model ≠ deployed model, or env vars missing |

Additional structural guards inside the same script: no unresolved `{{placeholders}}` in any generated file; routing-region markers in `CLAUDE.md` present and well-formed; custom-zone markers in `docs/README.md` present exactly once.

Failure output format (required): `FAILED V1: automation count mismatch — GETTING-STARTED.md says 22, system/manifest.json says 24; missing: work/23-*, work/24-*`. Specific, actionable, names the files.

Maintenance rule: every new kind of automation or new layer gets a new check. Validation grows with the system.

## P3-S2 — The migration test suite (run ONCE, in order, after Phase 1)

If a test fails: stop, fix, re-run from that test. Later tests assume earlier ones passed.

1. **Session boot test.** Start Claude Code fresh. Confirm `soul.md` injects via SessionStart hook, `CLAUDE.md` auto-loads, and the Brand Pre-Flight Gate reads `color-system.md` + `brand-config.md` without error. Alex comes online with correct identity and voice. *The smoke test — if the spine boots, the core survived.*
2. **Voice output test.** Trigger a prose task. Confirm it draws on `soul.md` "My Words" and sounds like Alex, and that the n8n voice sync (now inside the generator) regenerates the block between `<<<SOUL_VOICE>>>` markers without error.
3. **Automation registry test.** Run the routing-table step. Confirm the routing region in `CLAUDE.md` and `docs/projects/README.md` regenerate without corruption, and the output count equals `system/manifest.json` exactly.
4. **Scheduling test.** Run the scheduler step. Jobs register without error; pick one job, run it manually, confirm it executes and reads `scheduler/schedule.md` correctly.
5. **Documentation consistency test.** Read the generated `GETTING-STARTED.md` and `ARCHITECTURE.md` end to end. Cross-check by hand this ONE time: automation count vs manifest; scheduling steps vs `schedule.md`; MCP list vs `CLAUDE.md`. *Any mismatch = generation failed silently — exactly what V1–V6 catch automatically from now on.*
6. **Change Propagation walk-through.** Make one small real change (add a My Words entry to `soul.md`, or edit one automation description in `manifest.json`). Run the full generator. Confirm every downstream file that should reflect the change does, and nothing is orphaned. *A file that does not update reveals a blind spot in the generator.*
7. **Model-routing reality check.** Whatever was decided in P1-S1.1, confirm the live n8n workflow actually runs what the rule now says (V6 should already prove this — this test confirms V6 itself works). No contradiction left behind.

All seven pass → the migration is safe → merge `refactor/v2-architecture` to main. Any failure caught here is a side effect caught before it mattered.

## P3-S3 — Wire it permanently

1. Git pre-commit hook: run `validate-alex.js`; a red check blocks the commit.
2. If/when the repo runs CI (GitHub Actions): same script as a required status check on every push.
3. From this point, "Is the system consistent?" is a green check, not a feeling.

---

## FINAL ACCEPTANCE CRITERIA (the whole refactor, one list)

- [ ] Alex boots with correct identity and voice (migration test 1 green)
- [ ] Exactly 8 hand-authored files + templates; everything else generated or retired per the Phase 1 inventory
- [ ] Change Propagation exists in exactly one place and is executable: `edit source → generate-alex → validation → commit`
- [ ] `system/manifest.json` is the registry location; zero references to the old `work/18` path
- [ ] Zero references to any retired file anywhere in the repo
- [ ] All 7 migration tests passed once; all 6 validation checks green and wired to pre-commit
- [ ] V2 and V6 verified against live systems (Task Scheduler, n8n API), not documents
- [ ] Phase 2 evolution loop scheduled and producing its weekly `ai-landscape-update` digest (built last)

**The principle behind every step, preserved from the v2 proposal:** reduce the number of files written by hand, not the number of files that exist. Documents become views. A view cannot lie if it is generated.

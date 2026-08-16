#!/usr/bin/env node
// generate-alex.js - THE unified generator (refactor P1-S3, decision D6/D11).
// One entry point produces every human-facing document and system integration from the
// hand-authored sources. Atomic: everything renders into .staging/, is validated, and only then
// swaps over the real paths. A run succeeds as a whole or fails as a whole (ground rule 8).
//
// Sources (hand-edited)        ->  Outputs (generated, never hand-edited)
//   system/manifest.json           CLAUDE.md routing region (markers only)
//   scheduler/schedule.md          docs/GETTING-STARTED.md
//   CLAUDE.md (constitution)       docs/ARCHITECTURE.md
//   soul.md                        docs/README.md (custom zone preserved verbatim)
//   brand/config/*                 docs/projects/README.md (marked table region)
//   templates/*.template.md        work/16-alex-hq/app/app/tokens.css   (brand tokens, P5)
//                                  brand/tokens/tokens.json             (brand tokens, P5)
//                                  n8n writer voice block (idempotent markers)
//                                  Windows Task Scheduler jobs (create-missing-only)
//
// Usage:
//   node scripts/generate-alex.js --dry-run            stage + validate + report, never swap
//   node scripts/generate-alex.js                      full run: swap, n8n sync, scheduler
//   node scripts/generate-alex.js --only=docs          any of: docs, claude, tokens, n8n,
//                                                      scheduler (comma-separated)
//
// VALIDATION IS NEVER SCOPED (c7 fix, upgrade P5, 2026-07-12): every run - full, --dry-run, or
// any --only selection - executes the FULL validation suite (SUITE_RANGE, imported from the
// validator so this comment and the run log can never under-report it again - stress-test F-10,
// 2026-07-25) against the staged set plus the live repo. --only limits what is STAGED/APPLIED,
// never what is CHECKED, so a partial run can never ship one surface while a sibling surface is
// silently red.
//
// CONCURRENCY (stress-test F-08, 2026-07-25): the run holds the shared repo-surface write lock
// (scripts/lib/write-lock.js) across staging + validation + swap, so a parallel session's generator
// or skills install cannot interleave on CLAUDE.md. The generator FAILS LOUD rather than deferring:
// the caller asked for surfaces to be regenerated, so silently doing nothing would be a lie.
//
// n8n credentials come ONLY from env (N8N_API_URL, N8N_API_KEY) and are required whenever the
// n8n step runs; it fails loudly without them (ground rule 7).
'use strict';
const fs = require('fs');
const path = require('path');

const log = require('./lib/log');
const aw = require('./lib/atomic-write');
const writeLock = require('./lib/write-lock');
const { loadModel } = require('./lib/read-sources');
const { claudeRegionBlock } = require('./lib/gen-routing-table');
const genClaudeRegion = require('./lib/gen-claude-region');
const genDocs = require('./lib/gen-docs');
const genTokens = require('./lib/gen-tokens');
const genCmdHeaders = require('./lib/gen-command-headers');
const n8nVoice = require('./lib/sync-n8n-voice');
const scheduler = require('./lib/gen-scheduler');
const { runAll: validate, SUITE_RANGE } = require('./validate-alex');

const DRY = process.argv.includes('--dry-run');
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.split('=')[1].split(',').map(s => s.trim()) : null;
const VALID_ONLY = ['docs', 'claude', 'tokens', 'n8n', 'scheduler', 'commands', 'soulcore'];
if (ONLY) for (const o of ONLY) if (!VALID_ONLY.includes(o)) {
  console.error(`generate-alex: unknown --only value '${o}' (valid: ${VALID_ONLY.join(', ')})`);
  process.exit(1);
}
const want = name => !ONLY || ONLY.includes(name);

(async () => {
  let held = null;
  try {
    log.step(`generate-alex: ${DRY ? 'DRY-RUN' : 'FULL RUN'}${ONLY ? ` (only: ${ONLY.join(', ')})` : ''}`);

    // 0. Take the shared repo-surface lock (F-08). Held until the run ends, so staging, validation
    //    and the atomic swap are one indivisible window against any other mutator.
    held = writeLock.acquire({ label: `generate-alex${DRY ? ' (dry-run)' : ''}`, log: log.step });
    if (!held.ok) {
      throw new Error(`another repo-surface mutator holds the write lock (${held.reason}). ` +
        `Wait for it to finish, or - if you are sure that process is dead - remove ${writeLock.lockPath(writeLock.DEFAULT_NAME)}`);
    }

    // 1. Read all sources into one model. Any read/parse failure aborts before anything is staged.
    log.step('[1/5] read sources');
    const model = loadModel();
    log.step(`  sources OK: ${model.manifest.projects.length} projects (+${model.counts.unnumberedCount} unnumbered), ` +
      `${model.schedule.allJobNames.length} documented jobs, ${model.mcpList.length} MCP surfaces, ` +
      `${model.colorTokens.tokens.size} color tokens`);

    // 2. Render every selected output into .staging/ (never in place).
    log.step('[2/5] render to .staging/');
    aw.reset();
    let stagedClaude = null;
    if (want('claude') || want('docs')) {
      stagedClaude = genClaudeRegion.regenerate(model.claudeMd, claudeRegionBlock(model.manifest));
      aw.stage('CLAUDE.md', stagedClaude);
      log.step('  staged CLAUDE.md (routing region regenerated, constitution untouched)');
    }
    if (want('docs')) {
      const outputs = [
        genDocs.genGettingStarted(model),
        genDocs.genArchitecture(model, stagedClaude),
        genDocs.genReadme(model),
        genDocs.genProjectsReadme(model),
      ];
      for (const o of outputs) { aw.stage(o.rel, o.content); log.step(`  staged ${o.rel}`); }
    }
    if (want('commands')) {
      // Command-file state/trigger headers (F-3/F-4/F-6/F-11, 2026-07-28). The command layer was the
      // last large prose surface describing machine behaviour with nothing asserting it; this makes
      // state + trigger GENERATED rather than restated, so that class cannot drift. Idempotent.
      let n = 0;
      for (const t of genCmdHeaders.targets(model.manifest)) {
        const abs = path.join(process.cwd(), t.rel);
        if (!fs.existsSync(abs)) continue; // C1 already fails a missing declared command file
        const before = fs.readFileSync(abs, 'utf8');
        const after = genCmdHeaders.apply(before, t);
        if (after !== before) { aw.stage(t.rel, after); n++; }
      }
      log.step(`  staged command headers: ${n} file(s) changed of ${genCmdHeaders.targets(model.manifest).length} LIVE/EVENT command(s)`);
    }
    if (want('tokens')) {
      aw.stage(genTokens.CSS_REL, genTokens.tokensCss(model.colorTokens));
      aw.stage(genTokens.JSON_REL, genTokens.tokensJson(model.colorTokens));
      log.step(`  staged brand tokens: ${genTokens.CSS_REL} + ${genTokens.JSON_REL} (${model.colorTokens.tokens.size} tokens from the color law)`);
    }

    // 3. Validate the staged set + live systems. The FULL suite (SUITE_RANGE, logged below) runs on EVERY
    //    run regardless of --only (c7 fix, P5): --only limits staging/applying, never checking.
    //    Async since Phase 3 - V6 checks the live n8n API, the live half of V2 queries schtasks.
    log.step(`[3/5] validate (${SUITE_RANGE}, full suite - never narrowed by --only, context=generator)`);
    const result = await validate({ stagedDir: aw.STAGING });
    if (!result.ok) throw new Error(`validation failed:\n${result.failures.join('\n')}`);

    // 3b. Prompt regression (ADVISORY, #26 Phase 2, 2026-07-25): assert production prompts/runbooks still
    //     carry their load-bearing shape (work/26-prompting/regression-cases/cases.json). WARN ONLY - a
    //     shape change may be intentional; the human sees the warning and updates the case. Never fails.
    try {
      const cp = require('child_process');
      const out = cp.execSync('node scripts/prompt-regression-check.js --advisory',
        { cwd: require('path').resolve(__dirname, '..') }).toString().trim();
      log.step('  prompt-regression (advisory): ' + out);
    } catch (e) { log.step('  prompt-regression advisory skipped (non-fatal): ' + e.message); }

    // 3c. Propagation debt (ADVISORY, stress-test fix F-02, 2026-07-25): the C8 spec-vs-status hash
    //     compare, surfaced HERE instead of only on the Monday sweep. Root cause it pays: the 07-25
    //     upgrade batch edited 12 work specs, self-verified with validators + a generator dry-run +
    //     the narrative check - none of which look at status.md - and closed as "verified" while 8
    //     projects sat spec-changed-status-stale for four days. Advisory by design: propagation is a
    //     judgment act the human finishes, so this NAMES the debt every run instead of failing a
    //     build. Zero-token, reads the same state/baseline.json C8 does (one baseline, two readers).
    try {
      const cp = require('child_process');
      const out = cp.execSync('node scripts/stale-status-check.js --advisory',
        { cwd: require('path').resolve(__dirname, '..') }).toString().trim();
      for (const line of out.split('\n')) log.step('  stale-status (advisory): ' + line);
    } catch (e) { log.step('  stale-status advisory skipped (non-fatal): ' + e.message); }

    // 3d. soul-core rebuild (S1 Compiled Surfaces, 2026-08-16): the injection card derived from
    //     soul.md + system/soul-pins.json. Runs INSIDE the same held write-lock; an unchanged
    //     source pair is a verified no-op; refuse-below-floor leaves the existing card untouched.
    //     The 21:35 run-vault-index.ps1 chain is the other rebuild path (same lock, CLI mode).
    if (want('soulcore')) {
      if (DRY) {
        log.step('  soul-core: dry-run - skipped (the builder writes via its own atomic swap, not staging)');
      } else {
        const soulCore = require('./lib/build-soul-core');
        const r = soulCore.build({ log: log.step });
        log.step(`  soul-core: ${r.noop ? 'unchanged (verified no-op)' : `rebuilt (${r.bytes} B, ${r.entries} newest + ${r.pinned} pinned)`}`);
      }
    } else log.step('  soul-core: skipped (--only)');

    // 4. External integrations. Dry-run reports; full run applies. n8n is idempotent (an unchanged
    //    soul.md is a verified no-op); the scheduler only ever CREATES missing jobs, never touches
    //    existing ones (their hand-applied hardening must survive).
    if (want('n8n')) {
      log.step(`[4/5] n8n voice sync (${DRY ? 'dry-run' : 'apply'})`);
      await n8nVoice.run({ soul: model.soul, apply: !DRY, log: log.step });
    } else log.step('[4/5] n8n voice sync skipped (--only)');
    if (want('scheduler')) {
      log.step(`[4/5] scheduler (${DRY ? 'dry-run' : 'apply'})`);
      await scheduler.run({ schedule: model.schedule, apply: !DRY, log: log.step });
    } else log.step('[4/5] scheduler skipped (--only)');

    // 5. Swap or report.
    if (DRY) {
      log.step(`[5/5] DRY-RUN complete - staged output left in .staging/ for review (${aw.stagedFiles().length} file(s)), nothing real touched`);
    } else if (aw.stagedFiles().length === 0) {
      // --only selections without file outputs (e.g. --only=n8n) stage nothing; that is not an
      // error - the external integration already ran above. Found by migration test 2 (P3-S2).
      log.step('[5/5] nothing staged to swap (the --only selection produced no file outputs)');
    } else {
      const swapped = aw.swapAll();
      log.step(`[5/5] swapped ${swapped.length} file(s): ${swapped.join(', ')}`);
    }
    log.flush();
    process.exitCode = 0; // not process.exit(): a hard exit after fetch trips a libuv teardown assertion on Windows
  } catch (e) {
    // Any failure: delete staging, touch nothing real, name the reason, exit 1.
    try { aw.reset(); } catch { /* staging cleanup is best-effort */ }
    log.step(`FAILED: ${e.message}`);
    log.flush();
    process.exitCode = 1;
  } finally {
    // Release the write lock on every path (success, validation failure, crash) so a failed run can
    // never wedge the next one. release() only removes a lock this process still owns.
    if (held && held.ok) held.release();
  }
})();

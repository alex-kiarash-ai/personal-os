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
// any --only selection - executes the FULL validation suite (G1-G4 + V1-V9) against the staged
// set plus the live repo. --only limits what is STAGED/APPLIED, never what is CHECKED, so a
// partial run can never ship one surface while a sibling surface is silently red.
//
// n8n credentials come ONLY from env (N8N_API_URL, N8N_API_KEY) and are required whenever the
// n8n step runs; it fails loudly without them (ground rule 7).
'use strict';
const fs = require('fs');
const path = require('path');

const log = require('./lib/log');
const aw = require('./lib/atomic-write');
const { loadModel } = require('./lib/read-sources');
const { claudeRegionBlock } = require('./lib/gen-routing-table');
const genClaudeRegion = require('./lib/gen-claude-region');
const genDocs = require('./lib/gen-docs');
const genTokens = require('./lib/gen-tokens');
const n8nVoice = require('./lib/sync-n8n-voice');
const scheduler = require('./lib/gen-scheduler');
const { runAll: validate } = require('./validate-alex');

const DRY = process.argv.includes('--dry-run');
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.split('=')[1].split(',').map(s => s.trim()) : null;
const VALID_ONLY = ['docs', 'claude', 'tokens', 'n8n', 'scheduler'];
if (ONLY) for (const o of ONLY) if (!VALID_ONLY.includes(o)) {
  console.error(`generate-alex: unknown --only value '${o}' (valid: ${VALID_ONLY.join(', ')})`);
  process.exit(1);
}
const want = name => !ONLY || ONLY.includes(name);

(async () => {
  try {
    log.step(`generate-alex: ${DRY ? 'DRY-RUN' : 'FULL RUN'}${ONLY ? ` (only: ${ONLY.join(', ')})` : ''}`);

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
    if (want('tokens')) {
      aw.stage(genTokens.CSS_REL, genTokens.tokensCss(model.colorTokens));
      aw.stage(genTokens.JSON_REL, genTokens.tokensJson(model.colorTokens));
      log.step(`  staged brand tokens: ${genTokens.CSS_REL} + ${genTokens.JSON_REL} (${model.colorTokens.tokens.size} tokens from the color law)`);
    }

    // 3. Validate the staged set + live systems. The FULL suite (G1-G4 + V1-V9) runs on EVERY
    //    run regardless of --only (c7 fix, P5): --only limits staging/applying, never checking.
    //    Async since Phase 3 - V6 checks the live n8n API, the live half of V2 queries schtasks.
    log.step('[3/5] validate (G1-G4 + V1-V9, full suite - never narrowed by --only, context=generator)');
    const result = await validate({ stagedDir: aw.STAGING });
    if (!result.ok) throw new Error(`validation failed:\n${result.failures.join('\n')}`);

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
  }
})();

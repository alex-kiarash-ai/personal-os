#!/usr/bin/env node
/*
 * prompt-regression-check.js - zero-token prompt regression checker (#26 Phase 1, 2026-07-25).
 *
 * Prompt edits stop being silent behavior changes. Each case in
 * work/26-prompting/regression-cases/cases.json pins the load-bearing SHAPE of a production prompt/runbook
 * (must_contain / must_not_contain regexes). This replays them - STRING-SHAPE ASSERTIONS ONLY, no Claude
 * calls, no LLM judging in v1 - and reports any case whose target no longer carries its required shape.
 * The V6 lesson (expectations live as data) extended to the prompt layer.
 *
 * Exit: 0 = all pass. 1 = a failure (a required string vanished or a forbidden one appeared) OR a missing
 * target. In ADVISORY mode (--advisory, the generator's use) it prints WARNINGs and still exits 0.
 *
 * Usage:  node scripts/prompt-regression-check.js            # strict (exit 1 on any failure)
 *         node scripts/prompt-regression-check.js --advisory  # warn only, exit 0 (generator validation pass)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const CASES = path.join(REPO, 'work', '26-prompting', 'regression-cases', 'cases.json');
const advisory = process.argv.includes('--advisory');

let spec;
try { spec = JSON.parse(fs.readFileSync(CASES, 'utf8')); }
catch (e) { console.error(`prompt-regression: cannot read cases.json - ${e.message}`); process.exit(advisory ? 0 : 1); }

const failures = [];
let checked = 0, assertions = 0;
for (const c of spec.cases || []) {
  const target = path.join(REPO, c.target);
  if (!fs.existsSync(target)) { failures.push(`[${c.id}] target missing: ${c.target}`); continue; }
  const txt = fs.readFileSync(target, 'utf8');
  checked++;
  for (const re of c.must_contain || []) {
    assertions++;
    if (!new RegExp(re).test(txt)) failures.push(`[${c.id}] MISSING required shape /${re}/ in ${c.target}`);
  }
  for (const re of c.must_not_contain || []) {
    assertions++;
    if (new RegExp(re).test(txt)) failures.push(`[${c.id}] FORBIDDEN shape /${re}/ present in ${c.target}`);
  }
}

if (!failures.length) {
  console.log(`prompt-regression: PASS (${checked} cases, ${assertions} assertions).`);
  process.exit(0);
}
const tag = advisory ? 'WARNING' : 'FAILED';
console.error(`prompt-regression: ${failures.length} ${tag}(s) across ${checked} cases:`);
for (const f of failures) console.error(`  ${tag}: ${f}`);
process.exit(advisory ? 0 : 1);

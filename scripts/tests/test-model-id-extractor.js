#!/usr/bin/env node
'use strict';
/*
 * test-model-id-extractor.js - prove V6's model-id extractor sees what it claims to, and still
 * FAILS on the shapes it must fail on.
 *
 * WHY (2026-09-16). V6 asserts the live n8n model against the manifest contract, and it can only
 * assert what `modelIdsInNode` can SEE. Until today that was a literal at a `model:` key, which is
 * how the four older engines are written. #36 hoists the id into a const and references it, so V6
 * reported "no model id found" on a node that names claude-sonnet-5 on line three, and the false
 * failure blocked the generator. The extractor now resolves that third form.
 *
 * The risk in a fix like this is obvious and worth testing rather than asserting: an extractor made
 * more permissive can start returning something for a node that has genuinely lost its model, which
 * turns a loud failure into a silent pass. Cases 3, 4 and 5 below are the ones that matter, and they
 * are written so that a REGRESSION toward permissiveness fails this file.
 *
 * test-validator-negative.js covers the staged-tree checks and states plainly that V6 is out of its
 * reach (it reads the live network). This file covers the pure helper underneath V6.
 *
 * Run: node scripts/tests/test-model-id-extractor.js   (exit 0 = pass)
 */

const path = require('path');
const REPO = path.resolve(__dirname, '..', '..');
const { modelIdsInNode } = require(path.join(REPO, 'scripts', 'validate-alex.js'));

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify([...actual].sort());
  const e = JSON.stringify([...expected].sort());
  if (a === e) {
    console.log('  PASS  ' + label);
  } else {
    failures += 1;
    console.log('  FAIL  ' + label + '\n        expected ' + e + '\n        got      ' + a);
  }
}

const node = js => ({ parameters: { jsCode: js } });

// --- 1. the shape that was invisible, taken verbatim from the live #36 node -------------------
check('const-then-reference resolves (the #36 shape)', modelIdsInNode(node([
  'const WRITE_MODEL = "claude-sonnet-5";',
  'const body = { model: WRITE_MODEL, max_tokens: 2048 };',
  'return [{ json: body }];',
].join('\n'))), ['claude-sonnet-5']);

// --- 2. the old inline shape still works (no regression for the four older engines) ------------
check('inline literal still resolves', modelIdsInNode(node(
  'const body = { model: "claude-sonnet-4-6" };'
)), ['claude-sonnet-4-6']);

// --- 3. THE ONE THAT MATTERS: a dangling reference must resolve to NOTHING ---------------------
// If this ever returns a model, a node that lost its declaration passes V6 silently.
//
// The neighbouring const is load-bearing and was added after this file caught its own hole. The
// first version of this case had NO other const in it, so an implementation that resolved an
// identifier against ANY const in the node passed it, and a real node has consts everywhere. A
// negative test whose fixture cannot express the bug is not a negative test.
check('dangling reference yields nothing even with a model-ish const in scope', modelIdsInNode(node([
  'const GRADE_MODEL = "claude-sonnet-4-6";   // a different call in the same node',
  'const body = { model: WRITE_MODEL };       // its own const was deleted in a bad edit',
  'return [{ json: { grade: GRADE_MODEL } }];',
].join('\n'))), []);

// --- 4. it must not scrape model-ish strings that are not wired to a `model:` key --------------
// A prompt, a comment or an error message naming a model is not the model this node runs.
check('a model id in prose is not harvested', modelIdsInNode(node([
  'const NOTE = "claude-opus-5";                 // documentation, not wiring',
  '// falls back to claude-haiku-4-5-20251001 when the account is out of credit',
  'const body = { model: "claude-sonnet-5" };',
].join('\n'))), ['claude-sonnet-5']);

// --- 5. drift is still reported as drift, not smoothed over -----------------------------------
// The whole point of V6: change the const and the CHANGED value comes back, so the mismatch fires.
check('a drifted const returns the drifted value', modelIdsInNode(node([
  'const WRITE_MODEL = "claude-haiku-4-5-20251001";',
  'const body = { model: WRITE_MODEL };',
].join('\n'))), ['claude-haiku-4-5-20251001']);

// --- 6. a non-LLM identifier resolving to a non-LLM string stays out --------------------------
check('a non-model string is rejected by LLM_ID_RE', modelIdsInNode(node([
  'const MODE = "fast";',
  'const body = { model: MODE };',
].join('\n'))), []);

// --- 7. two calls in one node both come back (the #36 nodes carry one each, but Build Candidates
//        carries three, and a node that runs two models must report two) ----------------------
check('multiple models in one node all resolve', modelIdsInNode(node([
  'const READ_MODEL = "claude-opus-5";',
  'const GRADE_MODEL = "claude-sonnet-4-6";',
  'const a = { model: READ_MODEL };',
  'const b = { model: GRADE_MODEL };',
].join('\n'))), ['claude-opus-5', 'claude-sonnet-4-6']);

console.log(failures === 0
  ? 'test-model-id-extractor: PASS (7 cases)'
  : 'test-model-id-extractor: FAIL (' + failures + ' of 7)');
process.exit(failures === 0 ? 0 : 1);

'use strict';
/*
 * 02-build-eval-cases.js - "Build Eval Cases". Six seeded pairs, in the exact shape the prose node
 * reads, and nothing else.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS NODE IS ALLOWED TO DO, AND THE LINE IT MUST NOT CROSS.
 * ---------------------------------------------------------------------------------------------
 * It stands in for nodes 03 to 28 of the runtime workflow: the sheet read, the candidate build, the
 * ad fetch, the recruiter read, the research call and the CV assembly. All of that exists to
 * produce ONE object per pair, and this node produces six of them directly.
 *
 * What it must NOT do is invent a field the runtime does not produce, or skip one it does. A
 * harness whose input shape has drifted from the real upstream is testing a prompt that will never
 * be called that way. So the assertion below reads the prose node's OWN SOURCE and refuses to build
 * if it stops reading any field seeded here. That is the same discipline every runtime node uses on
 * its upstream neighbour, pointed the other way.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CV IS REAL, AND IT IS READ AT BUILD TIME.
 * ---------------------------------------------------------------------------------------------
 * A fake CV would make every case vacuous: the letter is told to argue from the CV and to add
 * nothing it does not support, so a CV of invented sentences turns A8 and the whole evidence rule
 * into noise. The seeds therefore carry the REAL assembled master text, read at build time from the
 * vault by _master.assemble(), exactly the way node 29 reads the approved figures. Nothing about
 * him is typed into this tracked file: the file is public, the vault is not.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CASES ARE DATA, NOT CODE.
 * ---------------------------------------------------------------------------------------------
 * They live in _eval.js so 07-case-metrics.js can read the same `primary` and the same prose about
 * what each one seeds without a second copy. The case text ships INTO the run as `_case`, so the
 * Eval Summary can say what a failing case was baiting without anyone opening this repo.
 */

const E = require('./_eval');

const SEEDS = E.caseSeeds();

(function assertAgainstTheProseNode() {
  const trigger = require('./01-manual-trigger.js');
  if (trigger.name !== 'When clicking Test') {
    throw new Error('Build Eval Cases: node 01 is named ' + JSON.stringify(trigger.name) + ' and this node connects from "When clicking Test".');
  }

  // The prose node is the consumer. Every field seeded here has to be a field it actually reads.
  // Both assertions live in _eval.js as plain functions rather than as a block here, because a
  // guard reachable only by requiring the node it guards can only ever be seen PASSING, and the
  // Close-Out rule for guard class code wants the refusal demonstrated first.
  // config/test-letter-eval.js drives both with doctored input.
  E.assertProseNodeReads(E.writerJsCode());
  E.assertCasesWellFormed(SEEDS, 6);
}());

const LOGIC = `
const out = [];
for (const c of CASES) {
  out.push({ json: Object.assign({}, c, { _eval_run_started_at: new Date().toISOString() }), pairedItem: { item: 0 } });
}
if (out.length !== EXPECTED) {
  throw new Error('Build Eval Cases: ' + out.length + ' cases were baked but this node expects ' + EXPECTED + '. A harness that runs fewer cases than it claims reports a full pass on a smaller question.');
}
return out;
`;

const jsCode = [
  '// GENERATED at build time from work/36-job-application-writer/nodes-eval/02-build-eval-cases.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  '//',
  '// The CV text below is the REAL assembled master, read from the vault at build time. It is in a',
  '// node parameter on a private box, never in the repo.',
  'const CASES = ' + JSON.stringify(SEEDS) + ';',
  'const EXPECTED = ' + SEEDS.length + ';',
  LOGIC,
].join('\n');

module.exports = {
  name: 'Build Eval Cases',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [260, 0],
  connectFrom: 'When clicking Test',
  notes: 'Six seeded pairs in the exact shape Build Writer Request reads, each carrying the real assembled CV for its lane plus a _case block naming what it baits and what a pass means. Stands in for runtime nodes 03 to 28. Reads no sheet, fetches nothing, writes nothing.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

'use strict';
/*
 * 41-write-results.js - "Write Results". The join that lets the run report on a day with nothing
 * to write.
 *
 * Input 0: whatever Write Jobs produced, which is one item per mapped row, or one error item, or
 *          NOTHING AT ALL on a run where no row was writable.
 * Input 1: every unwritten row and every report, straight off Write Route's false branch. Never
 *          empty, because Build Rows always emits at least its own stage report.
 *
 * Append mode, so an empty input 0 appends nothing and truncates nothing. That was measured, not
 * assumed: `Merge/v3/actions/mode/append.ts` iterates the WHOLE inputsData array and appends every
 * element, empties included, and the engine's own comment says "For the inputs for which never any
 * data got received set it to an empty array".
 *
 * ---------------------------------------------------------------------------------------------
 * numberInputs, SPELLED THE WAY THE NODE ACTUALLY DECLARES IT.
 * ---------------------------------------------------------------------------------------------
 * The Merge v3 property is `numberInputs`. `numberOfInputs` is not a property of this node, and n8n
 * drops an unknown parameter on save without a word: on 2026-09-11 that left Combine declaring two
 * inputs while the engine waited on three connections, and `getNodeInputsData` looped over the
 * DECLARED inputs and never read input 2. 748 job rows and six source reports were never fetched
 * from the array they were sitting in, and the run reported success.
 *
 * `build.js assertDeclaredInputs()` now refuses the wrong spelling BY NAME on every build path, and
 * `verify()` re-derives the live effective count after the write. This node is covered by both. The
 * count is stated here rather than left implicit for the same reason: an input a node does not
 * declare is wired, never read, and never reported.
 */

const INPUTS = 2;

(function assertAgainstUpstream() {
  const write = require('./40-write-jobs.js');
  const route = require('./39-write-route.js');
  if (write.name !== 'Write Jobs') throw new Error('Write Results: node 40 is named ' + JSON.stringify(write.name) + ' and this node joins it on input 0.');
  if (route.name !== 'Write Route') throw new Error('Write Results: node 39 is named ' + JSON.stringify(route.name) + ' and this node joins its false branch on input 1.');
  // Input 0 is allowed to be empty. That is the whole point of the join, and it only holds while the
  // write node is free to produce nothing, which is what onError plus the IF in front of it give.
  if (write.onError !== 'continueRegularOutput') {
    throw new Error(
      'Write Results: Write Jobs no longer sets onError continueRegularOutput. Without it a failed append\n' +
      '  throws, this join never runs, and the run loses its ledger row and its HQ push on exactly the run\n' +
      '  that needed both.'
    );
  }
}());

module.exports = {
  name: 'Write Results',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [6110, 780],
  connectFrom: [
    { node: 'Write Jobs', inputIndex: 0 },
    { node: 'Write Route', outputIndex: 1, inputIndex: 1 },
  ],
  notes: 'Input 0: the appended rows, or an error item, or nothing at all on a run with no rows to write. Input 1: every unwritten row and every report, which is never empty. Append mode, so an empty input 0 appends nothing and truncates nothing. This join is what lets the run row and the HQ push happen on a quiet day.',
  parameters: {
    mode: 'append',
    numberInputs: INPUTS,
  },
};

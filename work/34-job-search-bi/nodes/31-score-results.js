'use strict';
/*
 * 31-score-results.js - "Score Results". Joins the scored branch back to the carried branch so
 * Parse Score runs exactly once, on one stream, whatever happened upstream.
 *
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANT THIS NODE EXISTS FOR: Parse Score MUST RUN, even on a run that scored nothing.
 * ---------------------------------------------------------------------------------------------
 * Input 1 comes from Score Route's carry side, and that side is never empty: Budget Gate always
 * emits its own stage report with `_score_now: false`, and Remove Known always emits at least its
 * own. The engine only skips a Merge when EVERY input is empty
 * (`taskDataMain.filter((data) => data.length).length !== 0`, workflow-execute.ts), so this node
 * runs on every run that reaches it.
 *
 * Input 0 is allowed to be empty and often will be: scoring off, a quiet day, a refused sheet read.
 * An empty input appends nothing and truncates nothing. That is not an assumption, it is what
 * `Merge/v3/actions/mode/append.ts` does: it iterates the whole `inputsData` array and appends every
 * element, empties included. Agent 4 proved both directions of this on 2026-09-12 while fixing
 * Combine, and config/test-combine-merge.js pins it.
 *
 * ---------------------------------------------------------------------------------------------
 * `numberInputs`, NOT `numberOfInputs`. THIS IS THE WORD THAT COST 748 ROWS.
 * ---------------------------------------------------------------------------------------------
 * The Merge v3 property is `numberInputs` (nodes-base/nodes/Merge/v3/helpers/descriptions.ts). n8n
 * drops an unknown parameter on save without an error and leaves the real one at its default of 2,
 * so a node wired for three inputs and spelling it `numberOfInputs` declares two, and
 * `getNodeInputsData` loops over the DECLARED inputs and never reads the third. Execution 5154 lost
 * 748 job rows and six source reports that way and reported success.
 *
 * This node only needs two inputs, so the default would happen to be right, which is exactly why
 * the number is stated explicitly rather than left implicit: build.js `assertDeclaredInputs()`
 * refuses a wired-but-undeclared count, and relying on a default that happens to match is how the
 * next person learns the wrong lesson. The guard also refuses the five wrong spellings by name.
 */

(function assertAgainstUpstream() {
  const route = require('./29-score-route.js');
  const job = require('./30-score-job.js');
  if (route.name !== 'Score Route') throw new Error('Score Results: node 29 is named ' + JSON.stringify(route.name) + ' and this node wires from "Score Route" output 1.');
  if (job.name !== 'Score Job') throw new Error('Score Results: node 30 is named ' + JSON.stringify(job.name) + ' and this node wires from "Score Job" into input 0.');
  if (job.onError !== 'continueRegularOutput') {
    throw new Error(
      'Score Results: Score Job no longer sets onError continueRegularOutput. Without it a transport\n' +
      '  failure stops the workflow, this node never runs, and every source report on the carry branch\n' +
      '  dies with it, which is the failure the whole join exists to prevent.'
    );
  }
}());

const INPUTS = 2;

module.exports = {
  name: 'Score Results',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [5200, 160],
  connectFrom: [
    { node: 'Score Job', inputIndex: 0 },
    { node: 'Score Route', outputIndex: 1, inputIndex: 1 },
  ],
  notes: 'Input 0: the Anthropic responses, which may be empty on a run that scored nothing. Input 1: every unscored row and every report, which is never empty. Append mode, so an empty input appends nothing and truncates nothing. This join is what lets Parse Score run on every run.',
  parameters: {
    mode: 'append',
    numberInputs: INPUTS,
  },
};

'use strict';
/*
 * 27-select-results.js - "Select Results". Joins the selection branch back to the carried branch so
 * Assemble CV runs exactly once, on one stream, whatever happened upstream.
 *
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANT: Assemble CV MUST RUN, and it is the node that decides what ships.
 * ---------------------------------------------------------------------------------------------
 * Assemble CV is not only the assembler. It is where every returned block id is validated against
 * the master, where the mandatory set is enforced, where the one-page ceiling is applied by dropping
 * down the selector's own drop order, and where D13's hard refuse is decided: a selection that
 * cannot be tightened to fit does NOT ship and leaves a row for Shaheen instead. A run that skipped
 * this node would carry pairs with no cv_text into the writer, and the letter stage would be asked
 * to write about a CV that was never built.
 *
 * Input 1 comes from Select Route output 1 and is never empty: Build Select Request always emits its
 * own stage report with `_call_now: false`, and Build Candidates always emits one lane report per
 * lane. Input 0 is allowed to be empty and often will be: both lanes capped out, every qualifier
 * already written, every posting blocked, or an Anthropic outage that never got as far as a call.
 *
 * The engine only skips a Merge when EVERY input is empty, so this node runs on every run that
 * reaches it, and an empty input 0 appends nothing and truncates nothing.
 *
 * ---------------------------------------------------------------------------------------------
 * `numberInputs`, NOT `numberOfInputs`.
 * ---------------------------------------------------------------------------------------------
 * The Merge v3 property is `numberInputs`. n8n drops an unknown parameter on save without an error
 * and leaves the real one at its default of 2, so a node wired for three and spelling it
 * `numberOfInputs` declares two and never reads the third. That is how execution 5154 on #34 lost
 * 748 rows and reported success. Two is the right number here and it is stated rather than left
 * implicit, because relying on a default that happens to match is how the next person learns the
 * wrong lesson.
 */

(function assertAgainstUpstream() {
  const route = require('./25-select-route.js');
  const call = require('./26-select-cv-blocks.js');
  if (route.name !== 'Select Route') throw new Error('Select Results: node 25 is named ' + JSON.stringify(route.name) + ' and this node wires from "Select Route" output 1 into input 1.');
  if (call.name !== 'Select CV Blocks') throw new Error('Select Results: node 26 is named ' + JSON.stringify(call.name) + ' and this node wires from "Select CV Blocks" into input 0.');
  if (call.onError !== 'continueRegularOutput') {
    throw new Error(
      'Select Results: Select CV Blocks no longer sets onError continueRegularOutput. Without it a\n' +
      '  transport failure stops the workflow, this node never runs, and every lane report, every blocked\n' +
      '  pair and five stage reports die with it, along with pairs this run has already paid to read.'
    );
  }
  const resp = call.parameters.options && call.parameters.options.response && call.parameters.options.response.response;
  if (!resp || resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error('Select Results: Select CV Blocks no longer sets fullResponse AND neverError, so a 4xx would arrive with no status code and Assemble CV could not tell a credit error from a bad request, which on this stage is the difference between leaving a row at new and burning the day cap on nothing.');
  }
}());

const INPUTS = 2;

module.exports = {
  name: 'Select Results',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [6500, 100],
  connectFrom: [
    { node: 'Select CV Blocks', inputIndex: 0 },
    { node: 'Select Route', outputIndex: 1, inputIndex: 1 },
  ],
  notes: 'Input 0: the Anthropic selection responses, which may be empty on a run with no live pairs. Input 1: every held, blocked and capped pair and every report, which is never empty. Append mode, so an empty input appends nothing and truncates nothing. This join is what lets Assemble CV, and therefore the id validation, the mandatory set and the one page refuse, run on every run.',
  parameters: {
    mode: 'append',
    numberInputs: INPUTS,
  },
};

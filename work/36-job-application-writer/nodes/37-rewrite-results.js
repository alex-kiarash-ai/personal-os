'use strict';
/*
 * 37-rewrite-results.js - "Rewrite Results". Joins the rewrite branch back to the carried branch so
 * Audit Pair Final runs exactly once, on one stream.
 *
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANT HERE IS UNUSUAL AND WORTH STATING.
 * ---------------------------------------------------------------------------------------------
 * On most runs input 0 will be EMPTY, because most letters pass the audit first time. That is the
 * healthy state, not a fault. The join exists so that the passing letters on input 1 still reach
 * Audit Pair Final, Build Grade Request and everything after it: a straight chain would make the
 * whole second half of this workflow conditional on at least one letter having been WRONG.
 *
 * Input 1 is never empty: Audit Pair always emits its own stage report with `_call_now: false`, and
 * Build Candidates always emits one lane report per lane.
 *
 * ---------------------------------------------------------------------------------------------
 * `numberInputs`, NOT `numberOfInputs`.
 * ---------------------------------------------------------------------------------------------
 * n8n drops an unknown parameter on save without an error and leaves the real one at its default of
 * 2. A node wired for three and spelling it `numberOfInputs` declares two and never reads the third,
 * which is how execution 5154 on #34 lost 748 rows and reported success. Two is right here and it is
 * stated rather than left implicit.
 */

(function assertAgainstUpstream() {
  const route = require('./35-rewrite-route.js');
  const call = require('./36-rewrite-letter.js');
  if (route.name !== 'Rewrite Route') throw new Error('Rewrite Results: node 35 is named ' + JSON.stringify(route.name) + ' and this node wires from "Rewrite Route" output 1 into input 1.');
  if (call.name !== 'Rewrite Letter') throw new Error('Rewrite Results: node 36 is named ' + JSON.stringify(call.name) + ' and this node wires from "Rewrite Letter" into input 0.');
  if (call.onError !== 'continueRegularOutput') {
    throw new Error('Rewrite Results: Rewrite Letter no longer sets onError continueRegularOutput. Without it a transport failure stops the workflow, this node never runs, and every PASSING letter on the carry branch dies with it along with every report.');
  }
  const resp = call.parameters.options && call.parameters.options.response && call.parameters.options.response.response;
  if (!resp || resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error('Rewrite Results: Rewrite Letter no longer sets fullResponse AND neverError, so a 4xx would arrive with no status code and Audit Pair Final could not tell a credit error from a bad request.');
  }
}());

const INPUTS = 2;

module.exports = {
  name: 'Rewrite Results',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [9100, 100],
  connectFrom: [
    { node: 'Rewrite Letter', inputIndex: 0 },
    { node: 'Rewrite Route', outputIndex: 1, inputIndex: 1 },
  ],
  notes: 'Input 0: the rewrite responses, EMPTY on a healthy run where every letter passed first time. Input 1: the passing letters, every held pair and every report, never empty. Append mode, so an empty input appends nothing and truncates nothing. Without this join the whole grading half of the workflow would be conditional on at least one letter having been wrong.',
  parameters: {
    mode: 'append',
    numberInputs: INPUTS,
  },
};

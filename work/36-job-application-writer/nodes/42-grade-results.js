'use strict';
/*
 * 42-grade-results.js - "Grade Results". Joins the grading branch back to the carried branch so
 * Parse Grade runs exactly once, on one stream.
 *
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANT: Parse Grade MUST RUN, AND THE RENDER HALF HANGS OFF IT.
 * ---------------------------------------------------------------------------------------------
 * Everything after this point, the render seat's documents and the integration seat's Drive folder
 * and sheet writes, is downstream of Parse Grade. n8n does not run a node whose input carries no
 * items, so without this join a run in which no letter reached the grader, which is every run where
 * both lanes capped out or every posting was blocked, would end here carrying its lane reports and
 * its stage reports with it, and nothing would say so.
 *
 * Input 1 comes from Grade Route output 1 and is never empty: Build Grade Request always emits its
 * own stage report with `_call_now: false`. Input 0 is allowed to be empty.
 *
 * ---------------------------------------------------------------------------------------------
 * `numberInputs`, NOT `numberOfInputs`.
 * ---------------------------------------------------------------------------------------------
 * n8n drops an unknown parameter on save without an error and leaves the real one at its default of
 * 2, so a node wired for three and spelling it the other way declares two and never reads the third.
 * That is how execution 5154 on #34 lost 748 rows and reported success.
 */

(function assertAgainstUpstream() {
  const route = require('./40-grade-route.js');
  const call = require('./41-grade-letter.js');
  if (route.name !== 'Grade Route') throw new Error('Grade Results: node 40 is named ' + JSON.stringify(route.name) + ' and this node wires from "Grade Route" output 1 into input 1.');
  if (call.name !== 'Grade Letter') throw new Error('Grade Results: node 41 is named ' + JSON.stringify(call.name) + ' and this node wires from "Grade Letter" into input 0.');
  if (call.onError !== 'continueRegularOutput') {
    throw new Error('Grade Results: Grade Letter no longer sets onError continueRegularOutput. Without it a transport failure stops the workflow here, and every finished pair, every report and the entire render and write back half die with it.');
  }
  const resp = call.parameters.options && call.parameters.options.response && call.parameters.options.response.response;
  if (!resp || resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error('Grade Results: Grade Letter no longer sets fullResponse AND neverError, so a 4xx would arrive with no status code and Parse Grade could not tell a credit error from a bad request.');
  }
}());

const INPUTS = 2;

module.exports = {
  name: 'Grade Results',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [10400, 100],
  connectFrom: [
    { node: 'Grade Letter', inputIndex: 0 },
    { node: 'Grade Route', outputIndex: 1, inputIndex: 1 },
  ],
  notes: 'Input 0: the grading responses, which may be empty on a run with no passing letters. Input 1: every held, blocked and capped pair and every report, never empty. Append mode, so an empty input appends nothing and truncates nothing. The whole render and write back half of this workflow hangs off Parse Grade, so this join is what lets a run with nothing to ship still reach the end and say so.',
  parameters: {
    mode: 'append',
    numberInputs: INPUTS,
  },
};

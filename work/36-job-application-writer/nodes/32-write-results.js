'use strict';
/*
 * 32-write-results.js - "Write Results". Joins the letter branch back to the carried branch so
 * Parse Letter runs exactly once, on one stream, whatever happened upstream.
 *
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANT: Parse Letter MUST RUN.
 * ---------------------------------------------------------------------------------------------
 * n8n does not run a node whose input carries no items. Every stage before this one can
 * legitimately produce a run with no live pairs at all: both lanes capped out, every qualifier
 * already written, every posting blocked on Swedish fluency, an Anthropic outage at the reader, a
 * selection that could not be tightened to one page. In a straight chain any one of those would
 * skip the parse, skip the audit, skip the grade, and end the branch carrying every lane report,
 * every blocked pair and eight stage reports with it.
 *
 * Input 1 comes from Write Route output 1 and is never empty: Build Writer Request always emits its
 * own stage report with `_call_now: false`, and Build Candidates always emits one lane report per
 * lane. Input 0 is allowed to be empty and often will be.
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
 * implicit.
 */

(function assertAgainstUpstream() {
  const route = require('./30-write-route.js');
  const call = require('./31-write-letter.js');
  if (route.name !== 'Write Route') throw new Error('Write Results: node 30 is named ' + JSON.stringify(route.name) + ' and this node wires from "Write Route" output 1 into input 1.');
  if (call.name !== 'Write Letter') throw new Error('Write Results: node 31 is named ' + JSON.stringify(call.name) + ' and this node wires from "Write Letter" into input 0.');
  if (call.onError !== 'continueRegularOutput') {
    throw new Error(
      'Write Results: Write Letter no longer sets onError continueRegularOutput. Without it a transport\n' +
      '  failure stops the workflow, this node never runs, and every lane report, every blocked pair and\n' +
      '  eight stage reports die with it, along with pairs this run has already paid a read and a\n' +
      '  selection for.'
    );
  }
  const resp = call.parameters.options && call.parameters.options.response && call.parameters.options.response.response;
  if (!resp || resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error('Write Results: Write Letter no longer sets fullResponse AND neverError, so a 4xx would arrive with no status code and Parse Letter could not tell a credit error from a bad request, which on this stage is the difference between leaving a row at new and burning the day cap on nothing.');
  }
}());

const INPUTS = 2;

module.exports = {
  name: 'Write Results',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [7800, 100],
  connectFrom: [
    { node: 'Write Letter', inputIndex: 0 },
    { node: 'Write Route', outputIndex: 1, inputIndex: 1 },
  ],
  notes: 'Input 0: the Anthropic letter responses, which may be empty on a run with no live pairs. Input 1: every held, blocked and capped pair and every report, which is never empty. Append mode, so an empty input appends nothing and truncates nothing. This join is what lets Parse Letter, and therefore the whole audit, rewrite and grade chain, run on every run.',
  parameters: {
    mode: 'append',
    numberInputs: INPUTS,
  },
};

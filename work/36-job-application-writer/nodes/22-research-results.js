'use strict';
/*
 * 22-research-results.js - "Research Results". Joins the research branch back to the carried branch
 * so Parse Research runs exactly once, on one stream, whatever happened upstream.
 *
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANT: Parse Research MUST RUN, and it is not only a parser.
 * ---------------------------------------------------------------------------------------------
 * Parse Research is where the hook is verified against the page text and against the fetched host,
 * where the research cost is split back across the pairs it was spent on, and where site_text lands
 * on each pair for the A8 numbers audit downstream. A run that skipped it would carry pairs with no
 * research field at all into the selector and the writer, and every later stage would have to invent
 * a default for something that was simply never computed.
 *
 * Input 1 comes from Research Route output 1 and is never empty: Build Research Request always emits
 * its own stage report with `_call_now: false`, plus every pair and every lane report. Input 0 is
 * allowed to be empty and often will be, because most mornings no company site is readable at all.
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
  const route = require('./20-research-route.js');
  const call = require('./21-research-company.js');
  if (route.name !== 'Research Route') throw new Error('Research Results: node 20 is named ' + JSON.stringify(route.name) + ' and this node wires from "Research Route" output 1 into input 1.');
  if (call.name !== 'Research Company') throw new Error('Research Results: node 21 is named ' + JSON.stringify(call.name) + ' and this node wires from "Research Company" into input 0.');
  if (call.onError !== 'continueRegularOutput') {
    throw new Error(
      'Research Results: Research Company no longer sets onError continueRegularOutput. Without it a\n' +
      '  transport failure stops the workflow, this node never runs, and every pair, every lane report and\n' +
      '  four stage reports die with it, over a company website.'
    );
  }
  const resp = call.parameters.options && call.parameters.options.response && call.parameters.options.response.response;
  if (!resp || resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error('Research Results: Research Company no longer sets fullResponse AND neverError, so a 4xx would arrive with no status code and Parse Research could not tell a credit error from a bad request.');
  }
}());

const INPUTS = 2;

module.exports = {
  name: 'Research Results',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [5200, 100],
  connectFrom: [
    { node: 'Research Company', inputIndex: 0 },
    { node: 'Research Route', outputIndex: 1, inputIndex: 1 },
  ],
  notes: 'Input 0: the Anthropic research responses, empty on most runs by design. Input 1: every pair, every unreadable company and every report, which is never empty. Append mode, so an empty input appends nothing and truncates nothing. This join is what lets Parse Research, and therefore the hook verification and the cost split, run on every run.',
  parameters: {
    mode: 'append',
    numberInputs: INPUTS,
  },
};

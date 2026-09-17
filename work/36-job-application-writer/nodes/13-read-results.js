'use strict';
/*
 * 13-read-results.js - "Read Results". Joins the read branch back to the carried branch so Parse
 * Job Brief runs exactly once, on one stream, whatever happened upstream.
 *
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANT: Parse Job Brief MUST RUN, and on this lane that is stronger than it sounds.
 * ---------------------------------------------------------------------------------------------
 * Parse Job Brief is not only the parser. It is where the REAL cap gate runs, where the D10
 * verdicts are decided, and where the run learns what it actually spent. A run that skipped it
 * would carry capped pairs and held pairs all the way to the write-back half with no verdict on any
 * of them, and the sheet would get status cells nobody decided.
 *
 * Input 1 comes from Read Route output 1 and is never empty: Build Read Request always emits its
 * own stage report with `_call_now: false`, and Build Candidates always emits one lane report per
 * lane. The engine only skips a Merge when EVERY input is empty, so this node runs on every run
 * that reaches it.
 *
 * Input 0 is allowed to be empty and often will be: both lanes capped, both refused, a morning with
 * no new qualifiers, or an Anthropic outage that never got as far as a call.
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
  const route = require('./11-read-route.js');
  const job = require('./12-read-job.js');
  if (route.name !== 'Read Route') throw new Error('Read Results: node 11 is named ' + JSON.stringify(route.name) + ' and this node wires from "Read Route" output 1 into input 1.');
  if (job.name !== 'Read Job') throw new Error('Read Results: node 12 is named ' + JSON.stringify(job.name) + ' and this node wires from "Read Job" into input 0.');
  if (job.onError !== 'continueRegularOutput') {
    throw new Error(
      'Read Results: Read Job no longer sets onError continueRegularOutput. Without it a transport\n' +
      '  failure stops the workflow, this node never runs, and every lane report, every capped pair and\n' +
      '  both earlier stage reports die with it.'
    );
  }
  const resp = job.parameters.options && job.parameters.options.response && job.parameters.options.response.response;
  if (!resp || resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error('Read Results: Read Job no longer sets fullResponse AND neverError, so a 4xx would arrive with no status code and Parse Job Brief could not tell a credit error from a bad request.');
  }
}());

const INPUTS = 2;

module.exports = {
  name: 'Read Results',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [2860, 100],
  connectFrom: [
    { node: 'Read Job', inputIndex: 0 },
    { node: 'Read Route', outputIndex: 1, inputIndex: 1 },
  ],
  notes: 'Input 0: the Anthropic responses, which may be empty on a run that read nothing. Input 1: every held pair, every capped pair and every report, which is never empty. Append mode, so an empty input appends nothing and truncates nothing. This join is what lets Parse Job Brief, and therefore the cap gate and the D10 verdicts, run on every run.',
  parameters: {
    mode: 'append',
    numberInputs: INPUTS,
  },
};

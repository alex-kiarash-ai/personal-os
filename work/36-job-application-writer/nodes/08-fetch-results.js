'use strict';
/*
 * 08-fetch-results.js - "Fetch Results". Joins the fetched branch back to the carried branch so
 * Attach Ad runs exactly once, on one stream, whatever happened upstream.
 *
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANT: Attach Ad MUST RUN, even on a run that fetched nothing.
 * ---------------------------------------------------------------------------------------------
 * Input 1 comes from Fetch Route output 1, and that side is never empty: Build Candidates always
 * emits its own intake stage report with `_call_now: false` and a lane report per lane. The engine
 * only skips a Merge when EVERY input is empty, so this node runs on every run that reaches it.
 *
 * Input 0 is allowed to be empty and often will be: both lanes capped out, both refused, or a
 * morning where every qualifier had already been written. An empty input appends nothing and
 * truncates nothing, which is what `Merge/v3/actions/mode/append.ts` does: it iterates the whole
 * inputsData array and appends every element, empties included.
 *
 * ---------------------------------------------------------------------------------------------
 * `numberInputs`, NOT `numberOfInputs`. THIS IS THE WORD THAT COST THE COLLECTOR 748 ROWS.
 * ---------------------------------------------------------------------------------------------
 * The Merge v3 property is `numberInputs`. n8n drops an unknown parameter on save without an error
 * and leaves the real one at its default of 2, so a node wired for three and spelling it
 * `numberOfInputs` declares two and never reads the third. Execution 5154 on #34 lost 748 job rows
 * and six source reports that way and reported success.
 *
 * This node needs exactly two inputs, so the default would happen to be right, which is precisely
 * why the number is stated rather than left implicit: build.js assertDeclaredInputs() refuses a
 * wired-but-undeclared count and refuses the five wrong spellings by name, and relying on a default
 * that happens to match is how the next person learns the wrong lesson.
 */

(function assertAgainstUpstream() {
  const route = require('./06-fetch-route.js');
  const fetchAd = require('./07-fetch-ad.js');
  if (route.name !== 'Fetch Route') throw new Error('Fetch Results: node 06 is named ' + JSON.stringify(route.name) + ' and this node wires from "Fetch Route" output 1 into input 1.');
  if (fetchAd.name !== 'Fetch Ad') throw new Error('Fetch Results: node 07 is named ' + JSON.stringify(fetchAd.name) + ' and this node wires from "Fetch Ad" into input 0.');
  if (fetchAd.onError !== 'continueRegularOutput') {
    throw new Error(
      'Fetch Results: Fetch Ad no longer sets onError continueRegularOutput. Without it a transport\n' +
      '  failure stops the workflow, this node never runs, and every lane report and capped pair on the\n' +
      '  carry branch dies with it, which is the failure the whole join exists to prevent.'
    );
  }
}());

const INPUTS = 2;

module.exports = {
  name: 'Fetch Results',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [1560, 100],
  connectFrom: [
    { node: 'Fetch Ad', inputIndex: 0 },
    { node: 'Fetch Route', outputIndex: 1, inputIndex: 1 },
  ],
  notes: 'Input 0: the ad responses, which may be empty on a run that fetched nothing. Input 1: every capped pair, every unguardable url and every report, which is never empty. Append mode, so an empty input appends nothing and truncates nothing. This join is what lets Attach Ad run on every run.',
  parameters: {
    mode: 'append',
    numberInputs: INPUTS,
  },
};

'use strict';
/*
 * 18-site-results.js - "Site Results". Joins the fetched branch back to the carried branch so Build
 * Research Request runs exactly once, on one stream, whatever happened upstream.
 *
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANT: Build Research Request MUST RUN, and on this stage that is the common case.
 * ---------------------------------------------------------------------------------------------
 * Input 1 comes from Site Route output 1 and is never empty: Plan Research always emits its own
 * stage report with `_call_now: false`, plus every pair and every lane report. Input 0 is allowed to
 * be empty and OFTEN WILL BE, because a company site url is the exception rather than the rule: the
 * recruiter reader is told to answer employer_website with null unless the posting genuinely gives
 * one, and most apply urls point at a board that the denylist refuses.
 *
 * The engine only skips a Merge when EVERY input is empty, so this node runs on every run that
 * reaches it, and an empty input 0 appends nothing and truncates nothing. That is literally what
 * Merge v3 append does: it iterates the whole inputsData array and appends every element, empties
 * included.
 *
 * ---------------------------------------------------------------------------------------------
 * `numberInputs`, NOT `numberOfInputs`. THE WORD THAT COST THE COLLECTOR 748 ROWS.
 * ---------------------------------------------------------------------------------------------
 * The Merge v3 property is `numberInputs`. n8n drops an unknown parameter on save without an error
 * and leaves the real one at its default of 2, so a node wired for three and spelling it
 * `numberOfInputs` declares two and never reads the third. Execution 5154 on #34 lost 748 job rows
 * and six source reports that way and reported success.
 *
 * Two is the right number here, which is exactly why it is stated rather than left implicit:
 * build.js assertDeclaredInputs() refuses a wired-but-undeclared count and refuses the five wrong
 * spellings by name, and relying on a default that happens to match is how the next person learns
 * the wrong lesson.
 */

(function assertAgainstUpstream() {
  const route = require('./16-site-route.js');
  const fetchSite = require('./17-fetch-company-site.js');
  if (route.name !== 'Site Route') throw new Error('Site Results: node 16 is named ' + JSON.stringify(route.name) + ' and this node wires from "Site Route" output 1 into input 1.');
  if (fetchSite.name !== 'Fetch Company Site') throw new Error('Site Results: node 17 is named ' + JSON.stringify(fetchSite.name) + ' and this node wires from "Fetch Company Site" into input 0.');
  if (fetchSite.onError !== 'continueRegularOutput') {
    throw new Error(
      'Site Results: Fetch Company Site no longer sets onError continueRegularOutput. Without it a\n' +
      '  transport failure stops the workflow, this node never runs, and every pair, every lane report\n' +
      '  and three stage reports die with it, over a company homepage.'
    );
  }
}());

const INPUTS = 2;

module.exports = {
  name: 'Site Results',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [4160, 100],
  connectFrom: [
    { node: 'Fetch Company Site', inputIndex: 0 },
    { node: 'Site Route', outputIndex: 1, inputIndex: 1 },
  ],
  notes: 'Input 0: the company site responses, which are empty on most runs by design. Input 1: every pair and every report, which is never empty. Append mode, so an empty input appends nothing and truncates nothing. This join is what lets Build Research Request run on every run.',
  parameters: {
    mode: 'append',
    numberInputs: INPUTS,
  },
};

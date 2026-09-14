'use strict';
/*
 * 36-detail-results.js - "Detail Results". Joins the fetched branch back to the carried branch so
 * Attach Detail runs exactly once, on one stream, whatever happened upstream.
 *
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANT THIS NODE EXISTS FOR: ATTACH DETAIL MUST RUN, even on a run that fetched nothing.
 * ---------------------------------------------------------------------------------------------
 * Input 1 comes from Detail Route's carry side, and that side is never empty: Detail Gate always
 * emits its own stage report with `_detail_now: false`, and Remove Known always emits at least its
 * own. The engine only skips a Merge when EVERY input is empty
 * (`taskDataMain.filter((data) => data.length).length !== 0`, workflow-execute.ts), so this node
 * runs on every run that reaches it.
 *
 * Input 0 is allowed to be empty and OFTEN WILL BE, which is the whole reason this is a Merge and
 * not a wire. Three ordinary ways to get an empty input 0: every surviving row is a board row, the
 * detail switch is off, or the day is quiet. An empty input appends nothing and truncates nothing.
 * That is not an assumption, it is what `Merge/v3/actions/mode/append.ts` does: it iterates the
 * whole `inputsData` array and appends every element, empties included. Agent 4 proved both
 * directions of that on 2026-09-12 while fixing Combine, and config/test-combine-merge.js pins it.
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
 *
 * ---------------------------------------------------------------------------------------------
 * ORDER MATTERS HERE AND IT IS WHY INPUT 0 IS THE FETCH.
 * ---------------------------------------------------------------------------------------------
 * Append emits input 0's items first, then input 1's. `37-attach-detail.js` separates the two by
 * SHAPE rather than by position (a fetched item carries statusCode and no `_kind`), so it does not
 * depend on this ordering. The ordering is still chosen deliberately: with the responses first, an
 * n8n execution view shows the fetches at the top of the item list, which is where anyone
 * debugging a refusal will look.
 */

(function assertAgainstUpstream() {
  const route = require('./34-detail-route.js');
  const http = require('./35-get-linkedin-detail.js');
  if (route.name !== 'Detail Route') throw new Error('Detail Results: node 34 is named ' + JSON.stringify(route.name) + ' and this node wires from "Detail Route" output 1 into input 1.');
  if (http.name !== 'Get LinkedIn Detail') throw new Error('Detail Results: node 35 is named ' + JSON.stringify(http.name) + ' and this node wires from "Get LinkedIn Detail" into input 0.');
  if (http.onError !== 'continueRegularOutput') {
    throw new Error(
      'Detail Results: Get LinkedIn Detail no longer sets onError continueRegularOutput. Without it a\n' +
      '  transport failure stops the workflow, this node never runs, and every source report on the carry\n' +
      '  branch dies with it, which is the failure the whole join exists to prevent.'
    );
  }
}());

const INPUTS = 2;

module.exports = {
  name: 'Detail Results',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [4590, 380],
  connectFrom: [
    { node: 'Get LinkedIn Detail', inputIndex: 0 },
    { node: 'Detail Route', outputIndex: 1, inputIndex: 1 },
  ],
  notes: 'Input 0: the LinkedIn detail responses, which are empty on any run that fetched nothing. Input 1: every other row and every report, which is never empty. Append mode, so an empty input appends nothing and truncates nothing. This join is what lets Attach Detail run on every run.',
  parameters: {
    mode: 'append',
    numberInputs: INPUTS,
  },
};

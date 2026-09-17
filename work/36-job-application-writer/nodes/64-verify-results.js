'use strict';
/*
 * 64-verify-results.js - "Verify Results". Joins the downloaded bytes back to the carried branch so
 * Check Uploads runs exactly once, on one stream.
 *
 * ---------------------------------------------------------------------------------------------
 * INPUT 0 IS FIRST, AND HERE THAT ORDERING IS LOAD BEARING, WHICH IS UNUSUAL IN THIS WORKFLOW.
 * ---------------------------------------------------------------------------------------------
 * Merge v3 in append mode emits input 0 and then input 1. Everywhere else in this workflow that
 * order is deliberately not relied on. Check Uploads is the exception, and the reason is mechanical:
 * reading the downloaded bytes needs `this.helpers.getBinaryDataBuffer(i, 'data')`, whose `i` is the
 * index in the CURRENT node's own input, not an index into some other node's output. So Check
 * Uploads has to know where in ITS input a given download sits.
 *
 * It does not take that on faith. It asserts the shape it is relying on: the first N items, where N
 * is how many responses Verify Upload produced, must each carry either the bytes or an error, and no
 * item after them may carry bytes at all. If either is false the whole batch is refused and every
 * shipped pair is marked error:drive, because a digest read off the wrong item is a check that
 * passes for the wrong reason.
 *
 * That assertion is only possible because Attach Folder Ids strips the two PDFs off the pair. The
 * pairs reaching this merge carry no binary of their own, so an item with bytes on it here is a
 * download and nothing else.
 *
 * ---------------------------------------------------------------------------------------------
 * `numberInputs`, NOT `numberOfInputs`. Stated rather than defaulted, because n8n drops an unknown
 * parameter on save without a word and leaves the real one at 2, which is how execution 5154 on #34
 * lost 748 rows with a green tick. build.js refuses the five wrong spellings by name.
 */

(function assertAgainstUpstream() {
  const route = require('./62-verify-route.js');
  const verify = require('./63-verify-upload.js');
  if (route.name !== 'Verify Route') throw new Error('Verify Results: node 62 is named ' + JSON.stringify(route.name) + ' and this node wires from "Verify Route" output 1 into input 1.');
  if (verify.name !== 'Verify Upload') throw new Error('Verify Results: node 63 is named ' + JSON.stringify(verify.name) + ' and this node wires from "Verify Upload" into input 0.');
  const resp = verify.parameters.options.response.response;
  if (resp.responseFormat !== 'file' || resp.outputPropertyName !== 'data') {
    throw new Error('Verify Results: Verify Upload no longer returns a file on the data property, and the node after this one finds the downloads in its own input by looking for exactly that binary property.');
  }
  const attach = require('./55-attach-folder-ids.js');
  if (String(attach.parameters.jsCode || '').indexOf('out.push({ json: j });') === -1) {
    throw new Error(
      'Verify Results: Attach Folder Ids no longer emits pairs WITHOUT their binary.\n' +
      '  The node after this merge tells a downloaded file from everything else by asking which items\n' +
      '  carry bytes. A pair that still carried its two PDFs would answer yes, and a digest would be read\n' +
      '  off the wrong item, which is a check that passes for the wrong reason.'
    );
  }
}());

module.exports = {
  name: 'Verify Results',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [16120, 100],
  connectFrom: [
    { node: 'Verify Upload', inputIndex: 0 },
    { node: 'Verify Route', outputIndex: 1, inputIndex: 1 },
  ],
  notes: 'Input 0: the downloaded bytes of every uploaded file, empty on a morning with nothing to ship. Input 1: every pair, every report, and every upload that failed and carries an error instead of an id. Append mode puts input 0 first and Check Uploads depends on that, because reading binary needs an index into its own input; it asserts the shape rather than assuming it, and that assertion is only possible because Attach Folder Ids strips the PDFs off the pair, so an item with bytes here is a download and nothing else.',
  parameters: {
    mode: 'append',
    numberInputs: 2,
  },
};

'use strict';
/*
 * 61-upload-results.js - "Upload Results". Joins the uploaded files back to the carried branch.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS ON EACH INPUT, AND WHAT INPUT 0 IS NOT.
 * ---------------------------------------------------------------------------------------------
 * Input 0: the Drive file RESOURCES. Upload File replaces the item it is given, so these are not the
 * file items that went in: they carry an id, a name and a mime type, and no `_kind`, no pair_id, no
 * expected digest and no bytes. Everything the verification needs is read back from the nodes that
 * held it, by name, exactly the way Attach Folder Ids reads Create Folder.
 * Input 1: every pair, every lane report and every stage report. Never empty.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THE JOIN IS HERE AT ALL.
 * ---------------------------------------------------------------------------------------------
 * The same invariant as every other merge in this workflow: n8n does not run a node whose input
 * carries no items, and a morning with nothing to ship is ordinary. Without this join, a run that
 * uploaded nothing would skip the verification, the sheet writes, the run row and the heartbeat, and
 * finish reporting success having said nothing about why. Input 1 is what makes the whole write back
 * half unconditional.
 *
 * ---------------------------------------------------------------------------------------------
 * `numberInputs`, NOT `numberOfInputs`. Stated rather than defaulted, because build.js
 * assertDeclaredInputs() refuses the five wrong spellings by name and n8n drops an unknown parameter
 * on save without a word. That is how execution 5154 on #34 lost 748 rows with a green tick.
 */

(function assertAgainstUpstream() {
  const route = require('./59-upload-route.js');
  const upload = require('./60-upload-file.js');
  if (route.name !== 'Upload Route') throw new Error('Upload Results: node 59 is named ' + JSON.stringify(route.name) + ' and this node wires from "Upload Route" output 1 into input 1.');
  if (upload.name !== 'Upload File') throw new Error('Upload Results: node 60 is named ' + JSON.stringify(upload.name) + ' and this node wires from "Upload File" into input 0.');
  if (upload.onError !== 'continueRegularOutput') {
    throw new Error(
      'Upload Results: Upload File no longer continues on error.\n' +
      '  Without it one quota error stops the workflow here, and every other shipped pair, every held\n' +
      '  pair carrying a reason a person needs to read, every lane report and the run row that makes\n' +
      '  tomorrow daily cap true die with it, after all of them have already been paid for.'
    );
  }
}());

module.exports = {
  name: 'Upload Results',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [15340, 100],
  connectFrom: [
    { node: 'Upload File', inputIndex: 0 },
    { node: 'Upload Route', outputIndex: 1, inputIndex: 1 },
  ],
  notes: 'Input 0: the Drive file resources, which are what came BACK from the upload rather than what went in, so they carry an id and a name and nothing else this run put there. Input 1: every pair and every report, never empty. Append mode, so a morning that uploaded nothing still runs the verification, the sheet writes, the run row and the heartbeat.',
  parameters: {
    mode: 'append',
    numberInputs: 2,
  },
};

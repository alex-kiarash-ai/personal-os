'use strict';
/*
 * 58-files-ready.js - "Files Ready". Joins the two converted markdown files back to everything else,
 * so the upload route sees all four files of every folder in one stream.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS ON EACH INPUT.
 * ---------------------------------------------------------------------------------------------
 * Input 0: the README and the saved posting, now files on the `data` property. Empty on any morning
 * with nothing to ship.
 * Input 1: the two PDFs of every shipped pair, already files on `data`, plus every pair, every lane
 * report and every stage report. Never empty, because Build Candidates always emits one lane report
 * per lane and every Code node since has carried them.
 *
 * ---------------------------------------------------------------------------------------------
 * APPEND MODE, AND WHY THE ORDER IT PRODUCES IS NOT RELIED ON.
 * ---------------------------------------------------------------------------------------------
 * Append puts input 0 first and input 1 second, so the four files of one folder do NOT arrive
 * together: the two markdown files of every pair come first, then the two PDFs of every pair. That
 * is fine and it is deliberately not load bearing. Nothing downstream joins on position in this
 * stream: Check Uploads pairs the upload responses back to what Upload Route SENT, by that route's
 * own order, and joins the verification to the upload on the Drive file id, which is a real key
 * rather than a position.
 *
 * The one thing append does that matters here is pass the binary through whole. All four files are
 * bytes by this point and they have to survive two more nodes to reach Drive.
 *
 * ---------------------------------------------------------------------------------------------
 * `numberInputs`, NOT `numberOfInputs`. Two is stated rather than left to a default that happens to
 * match, because build.js assertDeclaredInputs() refuses the five wrong spellings BY NAME and n8n
 * drops an unknown parameter on save without a word. Execution 5154 on #34 lost 748 rows that way
 * and reported success.
 */

(function assertAgainstUpstream() {
  const route = require('./56-convert-route.js');
  const convert = require('./57-text-to-file.js');
  if (route.name !== 'Convert Route') throw new Error('Files Ready: node 56 is named ' + JSON.stringify(route.name) + ' and this node wires from "Convert Route" output 1 into input 1.');
  if (convert.name !== 'Text to File') throw new Error('Files Ready: node 57 is named ' + JSON.stringify(convert.name) + ' and this node wires from "Text to File" into input 0.');
  if (convert.parameters.operation !== 'toText' || convert.parameters.sourceProperty !== 'text') {
    throw new Error('Files Ready: Text to File no longer converts the `text` property with toText, so the items arriving on input 0 are not the files this join is for.');
  }
}());

module.exports = {
  name: 'Files Ready',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [14560, 100],
  connectFrom: [
    { node: 'Text to File', inputIndex: 0 },
    { node: 'Convert Route', outputIndex: 1, inputIndex: 1 },
  ],
  notes: 'Input 0: the two converted markdown files, empty on any morning with nothing to ship. Input 1: the two PDFs plus every pair and every report. Append mode, so an empty input appends nothing and the binary passes through whole. The order append produces is deliberately not relied on: Check Uploads pairs responses back to what Upload Route sent and joins the verification on the Drive file id, which is a key rather than a position.',
  parameters: {
    mode: 'append',
    numberInputs: 2,
  },
};

'use strict';
/*
 * 70-sheet-write-results.js - "Sheet Write Results". Joins the write and read back branch back to
 * the carried branch, so Check Sheet Writes runs exactly once, on one stream.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IS ON EACH INPUT.
 * ---------------------------------------------------------------------------------------------
 * Input 0: the two read back responses, which are what the spreadsheets actually say now. Never
 * empty, because Build Sheet Writes emits one request per lane on every run and Sheet Write Route
 * therefore always has two items to send.
 * Input 1: every pair, every lane report and every stage report of the whole morning.
 *
 * Both inputs are always populated, which makes this the one merge in this seat that is not guarding
 * against an empty branch. It is here for the other reason a merge exists: two streams have to
 * become one before a single Code node can see all of it, and n8n runs a node once PER INCOMING
 * BRANCH when two sources land on one input. Wiring both into input 0 would run Check Sheet Writes
 * twice, each time seeing half the run, and both halves would report a run that looks complete.
 *
 * ---------------------------------------------------------------------------------------------
 * THE ORDER OF THIS NODE AND THE ONE BEFORE IT IS A STATED CHANGE FROM THE RECONSTRUCTED PLAN.
 * ---------------------------------------------------------------------------------------------
 * The reconstruction put this merge at 69 and the read back at 70. That shape feeds the read back
 * the JOINED stream, and an HTTP Request node fires once per input item, so it would have made one
 * call per pair and per report with a url none of them carry. Same three nodes, same names, same
 * types; two of them swapped so the graph is a straight chain. The reasoning is written out in
 * nodes/69-read-back-sheets.js.
 *
 * ---------------------------------------------------------------------------------------------
 * `numberInputs`, NOT `numberOfInputs`. Stated rather than defaulted, because n8n drops an unknown
 * parameter on save without a word and leaves the real one at 2. That is how execution 5154 on #34
 * lost 748 rows and reported success.
 */

(function assertAgainstUpstream() {
  const route = require('./67-sheet-write-route.js');
  const read = require('./69-read-back-sheets.js');
  if (route.name !== 'Sheet Write Route') throw new Error('Sheet Write Results: node 67 is named ' + JSON.stringify(route.name) + ' and this node wires from its output 1 into input 1.');
  if (read.name !== 'Read Back Sheets') throw new Error('Sheet Write Results: node 69 is named ' + JSON.stringify(read.name) + ' and this node wires from it into input 0.');
  if (read.connectFrom !== 'Write Sheets') {
    throw new Error(
      'Sheet Write Results: Read Back Sheets no longer sits directly on the write branch.\n' +
      '  The chain is write, then read back, then this join, so the node that checks the writes cannot\n' +
      '  possibly run before the read back it depends on. A parallel branch would leave that to the\n' +
      '  engine, and a check that cannot find its read back reports an unverified run on a run that\n' +
      '  verified perfectly.'
    );
  }
}());

module.exports = {
  name: 'Sheet Write Results',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [17680, 100],
  connectFrom: [
    { node: 'Read Back Sheets', inputIndex: 0 },
    { node: 'Sheet Write Route', outputIndex: 1, inputIndex: 1 },
  ],
  notes: 'Input 0: the two read back responses. Input 1: every pair and every report of the morning. Neither is ever empty, so unlike the other merges in this seat this one is not guarding against a skipped node: it exists because two sources landing on one input make n8n run the node twice, each time seeing half the run, and both halves would report a run that looks complete.',
  parameters: {
    mode: 'append',
    numberInputs: 2,
  },
};

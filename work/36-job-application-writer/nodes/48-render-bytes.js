'use strict';
/*
 * 47b-render-bytes.js - "Render Bytes". Runtime node between Render PDF / Extract PDF Text and
 * Measure PDF. Rejoins the FILE with the FACTS ABOUT THE FILE.
 *
 * =============================================================================================
 * WHY THIS NODE EXISTS. IT IS THE FIX THE REFUSAL MESSAGE IN NODE 49 PRESCRIBED.
 * =============================================================================================
 * Extract From File CONSUMES the binary. Measured on executions 5442, 5446 and 5452: Render PDF
 * emits one item per document each carrying a 48.5 kB application/pdf under binary.data, and
 * Extract PDF Text emits the same count of items carrying numpages, info and text in json and
 * ZERO binary. Everything after it needs those bytes, both the R1 render check and the Drive
 * upload, so every pair in all three runs died at `error:render` with the PDFs sitting one node
 * upstream and Gotenberg working perfectly.
 *
 * Two repairs were tried inside node 49 first, because a node costs less than a wiring change,
 * and BOTH failed for the same underlying reason. `$('Render PDF').all()[i].binary` is undefined
 * in this n8n version, and so is `$('Render PDF').itemMatching(i).binary`. The n8n docs are right
 * that the linked item is the accessor that carries binary, but `this.helpers.getBinaryDataBuffer`
 * only ever reads THIS node's input, and a run-once-for-all-items Code node has no other way to
 * turn a descriptor into bytes. **A Code node cannot reach another node's file.** That is the fact
 * that made a wiring change unavoidable rather than merely tidier.
 *
 * =============================================================================================
 * WHY COMBINE BY POSITION, AND WHY THAT IS SAFE HERE.
 * =============================================================================================
 * Position is normally the weakest way to join two streams, and this project refuses positional
 * matching elsewhere on purpose: node 49's own header explains that a CV attached to the wrong job
 * is a letter that has already been sent. It is safe HERE and nowhere else, for one reason: both
 * inputs are the same list. Extract PDF Text is a one-in-one-out node reading Render PDF directly,
 * so item k of input 1 is by construction the extraction OF item k of input 0. There is no
 * reordering step between them and nothing can be dropped without the count changing.
 *
 * And the count is not trusted blindly either. Node 49 still cross checks the pairing three ways
 * against the authoritative order on Render Route output 0, and still refuses the WHOLE batch on
 * any disagreement. This node feeds that check; it does not replace it.
 *
 * The shape (`mode: combine`, `combineBy: combineByPosition`, typeVersion 3) is not guessed: it is
 * read off the `Merge Uploads` node that has been doing this same job in the three older
 * application engines on this box.
 *
 * =============================================================================================
 * WHAT THIS MEANS FOR THE CENSUS.
 * =============================================================================================
 * This lane was 74 nodes and is now 75. Every guard that asserted 74 is a guard that was asserting
 * "nobody added a node without saying so", which is exactly what it should do, and each one was
 * moved deliberately rather than loosened.
 */

module.exports = {
  name: 'Render Bytes',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [12100, 0],
  connectFrom: [
    { node: 'Render PDF', inputIndex: 0 },
    { node: 'Extract PDF Text', inputIndex: 1 },
  ],
  notes: 'Input 0: the rendered PDFs, which carry the binary and almost no json. Input 1: the same documents after Extract From File, which carries numpages, info and text and NO binary, because that node consumes it. Combine by position, which is safe here and only here because input 1 is a one in one out transform of input 0, so item k of one is by construction item k of the other. Measure PDF then has the bytes on its own input, which is the only place a Code node can read them from.',
  parameters: {
    mode: 'combine',
    numberInputs: 2,
    combineBy: 'combineByPosition',
    options: {},
  },
};

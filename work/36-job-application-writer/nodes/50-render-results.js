'use strict';
/*
 * 50-render-results.js - "Render Results". Joins the rendered branch back to the carried branch so
 * Check Renders runs exactly once, on one stream, whatever happened upstream.
 *
 * ---------------------------------------------------------------------------------------------
 * THE INVARIANT: CHECK RENDERS MUST RUN, AND IT IS THE LAST GATE IN THE WORKFLOW.
 * ---------------------------------------------------------------------------------------------
 * n8n does not run a node whose input carries no items. Every stage before this one can legitimately
 * produce a run with nothing to render: both lanes capped out, every qualifier already written, an
 * Anthropic outage at the reader, a selection that could not be tightened to one page, or every
 * letter held by the blind grade.
 *
 * In a straight chain any one of those would skip Check Renders and, after it, the whole write back
 * half. The run would end having created no folder, written no sheet row, pushed no status, and
 * said nothing at all about why, while reporting success. That is the failure this join exists to
 * prevent and it is the fifth time this workflow has had to prevent it.
 *
 * Input 1 comes from Render Route output 1 and is never empty: Build Documents always emits its own
 * stage report with `_call_now: false`, and Build Candidates always emits one lane report per lane.
 * Input 0 is allowed to be empty and will be on any morning with nothing to ship.
 *
 * The engine only skips a Merge when EVERY input is empty, so this node runs on every run that
 * reaches it, and an empty input 0 appends nothing and truncates nothing.
 *
 * ---------------------------------------------------------------------------------------------
 * `numberInputs`, NOT `numberOfInputs`. THE WORD THAT COST THE COLLECTOR 748 ROWS.
 * ---------------------------------------------------------------------------------------------
 * The Merge v3 property is `numberInputs`. n8n drops an unknown parameter on save without an error
 * and leaves the real one at its default of 2, so a node wired for three and spelling it
 * `numberOfInputs` declares two and never reads the third. Execution 5154 on #34 lost 748 job rows
 * and six source reports that way, and reported success.
 *
 * Two is the right number here, which is exactly why it is stated rather than left implicit:
 * build.js assertDeclaredInputs() refuses a wired-but-undeclared count and refuses the five wrong
 * spellings by name, and relying on a default that happens to match is how the next person learns
 * the wrong lesson.
 *
 * ---------------------------------------------------------------------------------------------
 * APPEND MODE CARRIES THE BINARY.
 * ---------------------------------------------------------------------------------------------
 * Merge v3 in append mode passes items through whole, binary included. That matters here more than
 * anywhere else in the workflow: input 0 carries the two PDFs of every shipped pair, and they have
 * to survive this node to reach Check Renders and then the Drive upload. Any other mode on this
 * node would be a different question being asked of the data.
 */

(function assertAgainstUpstream() {
  const route = require('./45-render-route.js');
  const measure = require('./49-measure-pdf.js');
  if (route.name !== 'Render Route') throw new Error('Render Results: node 45 is named ' + JSON.stringify(route.name) + ' and this node wires from "Render Route" output 1 into input 1.');
  if (measure.name !== 'Measure PDF') throw new Error('Render Results: node 49 is named ' + JSON.stringify(measure.name) + ' and this node wires from "Measure PDF" into input 0.');

  const extract = require('./48-extract-pdf-text.js');
  const render = require('./47-render-pdf.js');
  if (render.onError !== 'continueRegularOutput' || extract.onError !== 'continueRegularOutput') {
    throw new Error(
      'Render Results: the render branch no longer continues on error.\n' +
      '  Without it a Gotenberg outage or a PDF with no readable structure stops the workflow, this node\n' +
      '  never runs, and every lane report, every held pair and eleven stage reports die with it, along\n' +
      '  with pairs this run has already paid a read, a selection, a letter and a blind grade for.'
    );
  }
  // The guard is on the PROPERTY, not on one spelling of the expression (widened 2026-09-16).
  // It used to pin the literal `binary: item.binary`, which was right until exec 5442 proved the
  // input item has no binary at all: Extract From File consumes it, so Measure PDF now sources the
  // descriptor from Render PDF and emits `binary: srcBinary || item.binary`. The old pin would have
  // forced the fix to keep a spelling that no longer describes where the bytes come from. What this
  // check exists to catch is a json-only stream arriving at the upload, so it asserts THAT: the node
  // must still emit a binary key on the measured path.
  const mc = String(measure.parameters.jsCode || '');
  if (!/out\.push\(\{\s*json:\s*r,\s*binary:\s*[A-Za-z_$][\w$]*(\s*\|\|\s*[\w$.]+)?\s*\}\)/.test(mc) && mc.indexOf('binary: item.binary') === -1) {
    throw new Error('Render Results: Measure PDF no longer carries the PDF binary through on its measured path. This node joins the branch that holds the only copy of the two documents, and a json-only stream would arrive at the upload with nothing to upload.');
  }
}());

const INPUTS = 2;

module.exports = {
  name: 'Render Results',
  type: 'n8n-nodes-base.merge',
  typeVersion: 3,
  position: [12480, 100],
  connectFrom: [
    { node: 'Measure PDF', inputIndex: 0 },
    { node: 'Render Route', outputIndex: 1, inputIndex: 1 },
  ],
  notes: 'Input 0: the measured PDFs, carrying the binary, which is empty on any run with nothing to ship. Input 1: every pair, every lane report and every stage report, which is never empty. Append mode, so an empty input appends nothing, truncates nothing, and passes the binary through whole. This join is what lets Check Renders, and therefore the entire write back half, run on every run rather than only on the mornings that produced a document.',
  parameters: {
    mode: 'append',
    numberInputs: INPUTS,
  },
};

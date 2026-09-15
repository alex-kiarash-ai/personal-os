'use strict';
/*
 * 48-extract-pdf-text.js - "Extract PDF Text". Reads the text layer back OUT of the PDF that was
 * just rendered, and reports how many pages the PDF library thinks it has.
 *
 * =============================================================================================
 * 1. WHY THE TEXT IS READ BACK AT ALL, WHICH IS THE WHOLE POINT OF THIS SEAT.
 * =============================================================================================
 * The Verify-after-write standing order says a write that mutates an external system is followed in
 * the same run by a read of what was written. A render is that kind of write: an HTML document goes
 * in, a PDF comes out, and "it returned 200" says nothing about whether the document a recruiter
 * opens carries the words that were sent.
 *
 * Four things are only knowable from the far side of that round trip, and every one of them has been
 * a real failure somewhere: a PDF with no text layer (invisible to every applicant tracking system
 * on earth, and it looks perfect to a human), a term the CV claims that did not survive into the
 * text, a page that grew, and a character the no dash law forbids arriving through the render path
 * rather than through the writing.
 *
 * =============================================================================================
 * 2. THIS COUNT IS ONE OF TWO, AND THAT IS DELIBERATE.
 * =============================================================================================
 * The operation returns `numpages` from the PDF parser. Measure PDF, the next node, counts pages a
 * second and completely independent way, with a regex over the raw bytes. R2 requires BOTH to say
 * one, AND requires them to agree with each other.
 *
 * That is not belt and braces for its own sake. The render safety law is explicit that a page count
 * from the text layer alone cannot be trusted, because CLIPPED TEXT STILL EXTRACTS: a document that
 * hid its overflow reports one page and parses cleanly while the last third of it is painted
 * nowhere. Two methods that disagree is a measurement this workflow cannot stand behind, and R2
 * treats a disagreement as a failure rather than picking a winner.
 *
 * =============================================================================================
 * 3. joinPages true, AND WHY IT DOES NOT COST THE PAGE COUNT.
 * =============================================================================================
 * The checks that read this text are containment checks: does his name appear, does an ATS term
 * appear, did the last line survive, is there a dash. All of them want ONE string. Page separated
 * text would make every one of them iterate an array for no gain, and the page COUNT does not come
 * from the text at all, it comes from `numpages` and from the byte regex. So joining costs nothing
 * that is measured and simplifies everything that is checked.
 *
 * =============================================================================================
 * 4. onError: continueRegularOutput, AND THE ALIGNMENT IT PROTECTS.
 * =============================================================================================
 * If Render PDF exhausted its four tries, the item arriving here carries an `error` field and no
 * binary, and this node throws on it. Without onError that throw stops the workflow: Measure PDF
 * never runs, Render Results never runs, Check Renders never runs, and the run ends carrying every
 * pair, every lane report and eleven stage reports into nothing.
 *
 * With it, the failed item comes out as an item, the count stays equal to the count that was sent,
 * and the index alignment Measure PDF pairs on survives a failure of the node before it. That is
 * worth saying plainly: onError here is not politeness about errors, it is what keeps a CV from
 * being attached to the wrong job after one render out of twenty failed.
 */

const BINARY_PROPERTY = 'data';

(function assertAgainstUpstream() {
  const render = require('./47-render-pdf.js');
  if (render.name !== 'Render PDF') {
    throw new Error('Extract PDF Text: node 47 is named ' + JSON.stringify(render.name) + ' and this node connects from "Render PDF". Rename both in the same edit.');
  }
  const resp = render.parameters.options.response && render.parameters.options.response.response;
  if (!resp || resp.responseFormat !== 'file') {
    throw new Error('Extract PDF Text: Render PDF no longer asks for a file response, so there would be no binary to extract anything from.');
  }
  if (resp.outputPropertyName !== BINARY_PROPERTY) {
    throw new Error(
      'Extract PDF Text: Render PDF puts its PDF on ' + JSON.stringify(resp.outputPropertyName) + ' and this node reads ' + JSON.stringify(BINARY_PROPERTY) + '.\n' +
      '  Four nodes in a row name this property and they check each other rather than each trusting the\n' +
      '  n8n default, because a mismatch here produces an empty extraction that reads exactly like a\n' +
      '  PDF with no text layer.'
    );
  }
  if (render.onError !== 'continueRegularOutput') {
    throw new Error('Extract PDF Text: Render PDF no longer continues on error, so a render that failed all four tries would stop the workflow before this node and take every report with it.');
  }
}());

module.exports = {
  name: 'Extract PDF Text',
  type: 'n8n-nodes-base.extractFromFile',
  typeVersion: 1,
  position: [11960, 0],
  connectFrom: 'Render PDF',
  onError: 'continueRegularOutput',
  notes: 'Reads the text layer and the page count back out of the PDF that was just rendered, which is the Verify-after-write half of a render: a 200 says nothing about whether the words that went in came out. joinPages is true because every check that reads this text is a containment check and the page count does not come from the text at all. The numpages reported here is ONE of the two independent page counts R2 requires, and R2 also requires the two to agree, because the render safety law is explicit that a count from the text layer alone cannot be trusted: clipped text still extracts. onError continues so that a render which failed all four tries arrives as an item rather than stopping the workflow, which keeps the sent order aligned and is what stops a CV being attached to the wrong job.',
  parameters: {
    operation: 'pdf',
    binaryPropertyName: BINARY_PROPERTY,
    options: {
      joinPages: true,
    },
  },
};

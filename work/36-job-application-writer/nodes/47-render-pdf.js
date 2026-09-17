'use strict';
/*
 * 47-render-pdf.js - "Render PDF". One POST per document to Gotenberg's Chromium HTML route, on the
 * docker network, returning a PDF as binary.
 *
 * =============================================================================================
 * 1. THIS IS THE ONE NODE IN THE WORKFLOW THAT RETRIES, AND THE REASON IS ON RECORD.
 * =============================================================================================
 * retryOnFail true, maxTries 4, waitBetweenTries 5000.
 *
 * Every other transport in this workflow refuses a retry, and the argument there is always the same:
 * the endpoint is PAID and has no idempotency key, so a retry is a second charge. None of that
 * applies here. Gotenberg is a container on the same box, it costs nothing, it holds no state, and
 * converting the same HTML twice produces the same PDF. The only thing a retry spends is seconds.
 *
 * What it buys is the run. On 2026-07-16 an ECONNRESET on this exact service killed a whole render
 * run. By the time a pair reaches this node it has cost a read on the largest model in the chain, a
 * research call, a selection, a letter, possibly a rewrite and a blind grade. Throwing that away
 * because a container was restarting is the most expensive possible way to handle a transient
 * socket error, and it is the cheapest possible thing to fix.
 *
 * Four tries five seconds apart covers a container restart, which is what that class of failure
 * actually looks like on this box.
 *
 * =============================================================================================
 * 2. NO neverError, AND THAT IS NOT AN OVERSIGHT. IT IS WHAT MAKES THE RETRY WORK.
 * =============================================================================================
 * `neverError` turns a non 2xx into a normal item carrying a status code. Every other transport here
 * sets it, because on those stages a 4xx is DATA: it tells the parse node whether to leave a sheet
 * row at new or burn the day cap.
 *
 * Set here it would be self defeating. retryOnFail fires on a node ERROR. With neverError there is
 * no node error, so the retry would never fire on anything at all, and the node would READ as
 * retry protected while providing exactly nothing. That is worse than no retry, because the next
 * person reads the flag and stops looking.
 *
 * So: no neverError. A 5xx, a connection reset and a timeout are errors, the retry fires on them,
 * and `onError: continueRegularOutput` catches whatever is left after the fourth try. The item comes
 * out carrying an `error` field instead of a binary, the count stays aligned, and Measure PDF names
 * it. R1 then refuses the pair as a render failure, which is SYSTEMIC: the sheet row stays at `new`
 * so tomorrow morning offers the job again. A container that was down must never look like a job
 * that was considered and rejected.
 *
 * =============================================================================================
 * 3. NO fullResponse EITHER, AND THE REASONING IS THE SAME ONE.
 * =============================================================================================
 * fullResponse exists to put a status code on the item, and with no neverError there is no non 2xx
 * item for it to describe: a bad status is an error carrying its own message. Layering it onto a
 * binary response would add an unproven output shape to the ONE node in this workflow that has to
 * come back with bytes. The bytes are the deliverable here, not the metadata.
 *
 * =============================================================================================
 * 4. THE FORM, AND THE FIELD THAT IS NOT IN IT.
 * =============================================================================================
 * Every field and its reason live in nodes/_render.js, once, so the CV and the letter cannot be
 * printed under different settings. The short version: geometry comes from the stylesheet
 * (preferCssPageSize with all four margins at zero, because Gotenberg otherwise applies a 0.39in
 * margin that would shrink the printable area under a box declared at 296mm and push a CV that
 * genuinely fits onto a second page), backgrounds off, print media emulation on.
 *
 * `singlePage` IS NOT SET AND MUST NEVER BE. It renders the whole document on one enormous page,
 * which would make the D13 one page assertion pass on a CV of any length, forever, while producing
 * a PDF nothing can print. _render.assertFormIsSafe() refuses it by name at build time, because that
 * is not a render setting, it is R2 being switched off from the other end.
 *
 * =============================================================================================
 * 5. THE URL IS READ, NEVER TYPED, AND IT IS UNREACHABLE FROM A LAPTOP BY DESIGN.
 * =============================================================================================
 * config/lane.json render.gotenberg_html_endpoint. The host is a docker service name that resolves
 * on the n8n container network and nowhere else (work/18-recovery-layer/baselines/hetzner-ports.json
 * records the container with port 3000/tcp unpublished, verdict CLEAN 2026-07-18). A curl from a
 * development machine CANNOT reach it and a failed curl from there proves nothing about the box.
 *
 * lane.json also carries `gotenberg_verified: false` and says plainly that nobody has proved the
 * round trip from the box yet. This seat does not flip that flag and did not try: an offline seat
 * cannot verify a live service, and a flag flipped on reasoning rather than on a measurement is
 * worse than a flag that honestly says no. Seat 8's live drill flips it, on a call that returns a
 * one page PDF.
 */

const LN = require('./_lane');
const RN = require('./_render');

const G = RN.gotenberg();

const TIMEOUT_MS = 60000;
const BATCH_SIZE = 1;
const BATCH_INTERVAL_MS = 1000;
const MAX_TRIES = 4;
const WAIT_BETWEEN_TRIES_MS = 5000;

(function assertAgainstUpstream() {
  const route = require('./45-render-route.js');
  const file = require('./46-html-to-file.js');
  if (route.name !== 'Render Route') {
    throw new Error('Render PDF: node 45 is named ' + JSON.stringify(route.name) + ' and the branch this node sits on starts at "Render Route" output 0.');
  }
  if (file.name !== 'HTML to File') {
    throw new Error('Render PDF: node 46 is named ' + JSON.stringify(file.name) + ' and this node connects from "HTML to File". Rename both in the same edit.');
  }
  if (file.parameters.options.fileName !== 'index.html') {
    throw new Error(
      'Render PDF: HTML to File now names its file ' + JSON.stringify(file.parameters.options.fileName) + '.\n' +
      '  The Gotenberg Chromium HTML route DISPATCHES ON THAT NAME and refuses a form with no\n' +
      '  index.html in it. This is not a label, it is the API.'
    );
  }
  RN.assertFormIsSafe(RN.FORM_FIELDS);
  if (!Number.isInteger(MAX_TRIES) || MAX_TRIES < 2 || MAX_TRIES > 5) {
    throw new Error('Render PDF: maxTries is ' + MAX_TRIES + ' and n8n accepts 2 to 5.');
  }
  if (BATCH_SIZE !== 1) {
    throw new Error('Render PDF: batchSize is ' + BATCH_SIZE + '. n8n sleeps between BATCHES, so any size above 1 sends that many Chromium renders back to back with no interval at all, on the same box the collectors and the writer share.');
  }
  // The pacing floor is deliberately NOT the collectors LinkedIn leg: this call goes to a container
  // on the same machine rather than to a third party, so the interval is box kindness and not
  // politeness. It is stated so the next person does not read 1000 as a politeness number and copy
  // it somewhere it would be far too fast.
  if (BATCH_INTERVAL_MS < 250) {
    throw new Error('Render PDF: batchInterval is ' + BATCH_INTERVAL_MS + ' ms. Twenty Chromium instances in two seconds is a spike on a box that is also running the collectors, the writer and Caddy.');
  }
  if (G.verified === true) {
    // Not an error, a note that a fact changed. If this ever fires it means someone proved the round
    // trip and the comment above should stop saying nobody has.
    if (typeof LN.lane().render.gotenberg_verified_note !== 'string') {
      throw new Error('Render PDF: lane.json now says gotenberg_verified is true and carries no note saying who proved it and how. A flag with no measurement behind it is the thing that flag exists to prevent.');
    }
  }
}());

module.exports = {
  name: 'Render PDF',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [11700, 0],
  connectFrom: 'HTML to File',
  onError: 'continueRegularOutput',
  retryOnFail: true,
  maxTries: MAX_TRIES,
  waitBetweenTries: WAIT_BETWEEN_TRIES_MS,
  notes: 'One multipart POST per document to the Gotenberg Chromium HTML route on the docker network, returning the PDF as binary on `data`. THIS IS THE ONE NODE IN THIS WORKFLOW THAT RETRIES: the service is local, free, stateless and idempotent, so a retry costs seconds, and an ECONNRESET on this exact service killed a whole run on 2026-07-16 after the pairs had already been paid for. neverError is deliberately NOT set, because retryOnFail fires on a node error and neverError would remove the very error it fires on, leaving a node that reads as retry protected while providing none. Whatever survives the fourth try leaves through onError continueRegularOutput carrying an error field, keeps the item count aligned, and is refused by R1 as a SYSTEMIC failure that leaves the sheet row at new. singlePage is not in the form and never may be: it would make the one page assertion pass on a CV of any length.',
  parameters: {
    method: 'POST',
    url: G.html_endpoint,
    sendBody: true,
    contentType: 'multipart-form-data',
    bodyParameters: {
      parameters: [
        {
          parameterType: 'formBinaryData',
          name: RN.FORM_BINARY_FIELD,
          inputDataFieldName: 'data',
        },
      ].concat(RN.FORM_FIELDS.map((f) => ({ parameterType: 'formData', name: f.name, value: f.value }))),
    },
    options: {
      timeout: TIMEOUT_MS,
      batching: { batch: { batchSize: BATCH_SIZE, batchInterval: BATCH_INTERVAL_MS } },
      response: {
        response: {
          responseFormat: 'file',
          outputPropertyName: 'data',
        },
      },
    },
  },
};

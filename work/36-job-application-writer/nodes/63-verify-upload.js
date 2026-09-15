'use strict';
/*
 * 63-verify-upload.js - "Verify Upload". Downloads every file this run put in Drive, as bytes.
 *
 * =============================================================================================
 * 1. WHY IT EXISTS: THE VERIFY-AFTER-WRITE STANDING ORDER, AND ITS ONE EXEMPTION IS NOT THIS.
 * =============================================================================================
 * "It returned 200" is not verification. That sentence is in the root constitution because on
 * 2026-07-10 a PUT silently dropped two live workflows' active flags, returned 200, and nobody
 * noticed until the next morning's runs did not fire. The upload response is the request talking
 * about itself: it says what the API accepted, not what the document now holds.
 *
 * So this node asks Drive for the bytes back. The only carve-out in the order is the HQ heartbeat,
 * and that is node 73.
 *
 * =============================================================================================
 * 2. `alt=media` IS THE WHOLE URL. WITHOUT IT THIS CHECK PASSES ON NOTHING.
 * =============================================================================================
 * A plain GET on drive/v3/files/{id} returns the file METADATA as JSON. With `alt=media` it returns
 * the file CONTENT. Drop the parameter and the read back would compare the md5 of a small JSON
 * document against the md5 of a PDF, fail on every single file, and look like a systemic upload
 * fault. Worse in the other direction: a check written to tolerate that would be a check that never
 * looks at a byte.
 *
 * This is the staging workflow's proven shape (v1GbDYganOz9EGpM, node Verify Drive Get), with one
 * difference: it asks for `responseFormat: text` because it staged a text file and compared strings.
 * Two of the four files here are PDFs, so this asks for `file` and compares digests, which is also
 * the only comparison that works on bytes that were never text.
 *
 * =============================================================================================
 * 3. NO fullResponse AND NO neverError, WHICH IS THE OPPOSITE OF EVERY SHEET CALL IN THIS WORKFLOW.
 * =============================================================================================
 * Elsewhere a 4xx has to arrive as DATA, because the parse node needs the status code to decide
 * whether to leave a sheet row at `new` or burn the day cap. Here there is exactly one question,
 * which is whether the bytes came back, and the answer is the bytes or nothing. Layering a status
 * envelope onto a binary response would add an unproven output shape to the one node in this half
 * that has to come back with bytes.
 *
 * A non 2xx is therefore a node error, `onError: continueRegularOutput` turns it into an item with
 * an `error` field and no binary, the count stays aligned, and Check Uploads refuses that file by
 * name. A file that cannot be read back is treated exactly like a file whose digest is wrong: the
 * pair is error:drive, the folder is left in place, and nothing is written to either sheet.
 *
 * =============================================================================================
 * 4. NO RETRY. A GET is idempotent so a retry would be SAFE, and it would buy nothing: the failures
 * this node actually sees are a lapsed credential, a permission change and a file that is not there,
 * none of which is transient. n8n retries the whole NODE, so a retry here would also re-download
 * every file in the run to fix one. The recovery is already built and is better: an unverified
 * upload leaves the jobs row at `new`, so tomorrow morning offers the same job again.
 */

const W = require('./_write');

const TIMEOUT_MS = 60000;
const MEDIA_URL = '=' + W.driveMediaUrlExpr('$json.id');

(function assertAgainstUpstream() {
  const route = require('./62-verify-route.js');
  if (route.name !== 'Verify Route') {
    throw new Error('Verify Upload: node 62 is named ' + JSON.stringify(route.name) + ' and this node hangs off "Verify Route" output 0. Rename both in the same edit.');
  }
  const cond = route.parameters.conditions.conditions[0];
  if (String(cond.leftValue).indexOf('$json.id') === -1) {
    throw new Error('Verify Upload: Verify Route no longer selects on the Drive id, and this node builds its url out of that exact field. A url built from a missing id reads files/?alt=media, which Google answers with a list rather than a file.');
  }
  const url = MEDIA_URL;
  if (url.indexOf('alt=media') === -1) {
    throw new Error(
      'Verify Upload: the url has lost alt=media.\n' +
      '  Without it Drive returns the file METADATA as JSON rather than the file CONTENT, so every digest\n' +
      '  comparison downstream would be the md5 of a small JSON document against the md5 of a PDF. It\n' +
      '  would fail on every file and look like a systemic upload fault.'
    );
  }
  if (!/^https:\/\/www\.googleapis\.com\/drive\/v3\/files\//.test(url.replace(/^=/, ''))) {
    throw new Error('Verify Upload: the url is ' + JSON.stringify(url) + ', which is not the Drive v3 files endpoint the staging workflow proved.');
  }
}());

module.exports = {
  name: 'Verify Upload',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [15860, 0],
  connectFrom: { node: 'Verify Route', outputIndex: 0 },
  // A file that cannot be read back is DATA, and it costs exactly one pair. See note 3.
  onError: 'continueRegularOutput',
  notes: 'One GET per uploaded file, drive/v3/files/{id}?alt=media, returning the bytes on the data property. This is the Verify-after-write standing order applied to Drive: a 200 from the upload is the request talking about itself, and this asks the document. alt=media is the whole url; without it Drive returns metadata as JSON and every digest comparison would compare a JSON document against a PDF. Deliberately no neverError and no fullResponse: there is one question here and the answer is the bytes or nothing. Never retried, because n8n retries the whole node and the failures this sees are a lapsed credential or a missing file, neither of which is transient.',
  credentials: W.googleDriveCredential(),
  parameters: {
    method: 'GET',
    url: MEDIA_URL,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleDriveOAuth2Api',
    options: {
      timeout: TIMEOUT_MS,
      response: {
        response: {
          responseFormat: 'file',
          outputPropertyName: 'data',
        },
      },
    },
  },
};

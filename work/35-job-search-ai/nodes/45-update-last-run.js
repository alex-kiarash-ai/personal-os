'use strict';
/*
 * 45-update-last-run.js - "Update Last Run". Moves the search window, or deliberately does not.
 *
 * This is the single most dangerous write in the lane. Move the window on a run that did not cover
 * it and the jobs in that gap are gone forever, and every run afterwards still reports green. The
 * decision is made in Build Run Row as an AND of eight checks; this node only carries it out.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. WHY IT IS AN HTTP batchUpdate AND NOT THE GOOGLE SHEETS UPDATE THE DISPATCH NAMED.
 * ---------------------------------------------------------------------------------------------
 * Two measured reasons, and either one is enough.
 *
 * (a) THE SHEETS NODE CANNOT SAY "AND TOUCH NOTHING ELSE". Its update operation matches a row by a
 *     lookup column and rewrites that row, and when nothing matches it is a SILENT no-op that
 *     returns success. On a settings tab that is hand editable by design, a key that got renamed or
 *     a stray space would mean the window quietly stopped moving, and the only symptom would be a
 *     lane that re-collects the same week every morning while reporting fine. Agent 3 hit the same
 *     wall building the settings sync and reached the same answer: `values:batchUpdate` addresses
 *     an exact cell, which is the shape of the requirement.
 *     Here the address is `settings!B<row>` with <row> read out of the settings tab IN THIS RUN by
 *     Read Back Jobs. So a missing `last_run_at` key is caught before the write, by name, and the
 *     run refuses to advance instead of no-oping into the sheet.
 *
 * (b) A RUN THAT MUST NOT ADVANCE STILL HAS TO REACH Push HQ. n8n skips a node with no input, so
 *     gating this write with an IF costs an IF and a Merge, and the whole decision then lives in an
 *     expression no offline suite can exercise. A batchUpdate with an EMPTY `data` array is a legal
 *     call that writes nothing at all, so this node always receives exactly one item, always runs,
 *     and the decision stays in Build Run Row's code where the tests can reach it. The body is built
 *     there and read here by reference; this node contains no judgement.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. executeOnce, ON A WRITE, IS NOT DECORATION.
 * ---------------------------------------------------------------------------------------------
 * An HTTP Request node runs once per INPUT item. Build Run Row emits exactly one and Write Run
 * returns one, so today this fires once either way. `executeOnce` makes that structural rather than
 * incidental: whatever the append node upstream decides to return in a future n8n version, the
 * window is written at most once per run.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. valueInputOption RAW, matching the provisioner and the settings sync.
 * ---------------------------------------------------------------------------------------------
 * The whole settings tab is stored as text, both cells of every row, and Stage A's decoder was
 * proved against exactly that. USER_ENTERED would coerce the timestamp into a Sheets date value and
 * `Date.parse` on the way back would then be reading a number, not the ISO string that was written.
 * The value is carried in the body Build Run Row assembled, so it cannot differ from what the
 * read-back is about to be compared against.
 *
 * onError: continueRegularOutput, so a refused write is DATA and the run still pushes HQ and still
 * fails loudly at the end. No retry: it is one cell and the failure is not transient.
 */

const { lane, googleSheetsCredential } = require('./_lane');
const O = require('./_output');

const L = lane();
const TIMEOUT_MS = 30000;

(function assertAgainstUpstream() {
  const wr = require('./44-write-run.js');
  if (wr.name !== 'Write Run') throw new Error('Update Last Run: node 44 is named ' + JSON.stringify(wr.name) + ' and this node connects from "Write Run".');
  const brr = require('./43-build-run-row.js');
  const src = (brr.parameters && brr.parameters.jsCode) || '';
  if (src.indexOf('_last_run_body: lastRunBody') === -1) {
    throw new Error('Update Last Run: Build Run Row no longer emits _last_run_body, which is the entire request this node sends. It contains no judgement of its own.');
  }
  // THE NO-OP IS THE MECHANISM. If the empty-data branch ever disappears, this node stops being
  // skippable-without-an-IF and would write the window on every run.
  if (src.indexOf("{ valueInputOption: 'RAW', data: [] }") === -1) {
    throw new Error(
      'Update Last Run: Build Run Row no longer builds an EMPTY-data batchUpdate on a run that must not advance.\n' +
      '  That empty call is what lets this node always run and still write nothing. Without it the window\n' +
      '  would move on every run, including the ones that did not cover it, which is the failure this whole\n' +
      '  stage is arranged around.'
    );
  }
  if (src.indexOf("valueInputOption: 'RAW'") === -1) {
    throw new Error('Update Last Run: the last_run_at body is no longer RAW. The settings tab is stored as text end to end and Stage A\'s decoder was proved against that.');
  }
  if (!L.sheet.spreadsheet_id) throw new Error('Update Last Run: lane.json has no sheet.spreadsheet_id.');
}());

module.exports = {
  name: 'Update Last Run',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [6630, 780],
  connectFrom: 'Write Run',
  // At most one window write per run, structurally. See note 2.
  executeOnce: true,
  onError: 'continueRegularOutput',
  notes: 'Writes settings!B<row> with the run start time, or sends an empty batchUpdate that changes nothing. Build Run Row decides which and builds the whole body; this node has no judgement. The row number was read out of the settings tab in this same run, so a renamed key fails by name instead of no-oping into the sheet.',
  credentials: googleSheetsCredential(),
  parameters: {
    method: 'POST',
    url: O.batchUpdateUrl(L.sheet.spreadsheet_id),
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api',
    sendBody: true,
    contentType: 'json',
    specifyBody: 'json',
    jsonBody: "={{ JSON.stringify($('Build Run Row').first().json._last_run_body) }}",
    options: {
      timeout: TIMEOUT_MS,
      response: {
        response: {
          fullResponse: true,
          neverError: true,
          responseFormat: 'json',
        },
      },
    },
  },
};

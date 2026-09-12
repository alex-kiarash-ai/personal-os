'use strict';
/*
 * 07-write-ai.js - applies the AI plan.
 *
 * Same shape and same reasoning as 06-write-bi.js, pointed at the AI spreadsheet.
 *
 * SEQUENTIAL AFTER THE BI WRITE, not parallel. If the BI write fails, this never runs, so a failed
 * sync leaves at most ONE lane moved instead of two lanes in two different unknown states. The plan
 * node already refused both lanes together on any fault it could see before writing; this ordering
 * is the second half of the same idea, for the faults it cannot see in advance (a 500, a revoked
 * token, a sheet somebody deleted between the read and the write).
 *
 * One lane moved and one not is a state the report node names explicitly rather than hides, and it
 * is recoverable by re-running: the sync is idempotent, so a second run rewrites the lane that
 * already landed with the same values and finishes the one that did not.
 */

const { GOOGLE_SHEETS_CREDENTIAL } = require('./_sync');

module.exports = {
  name: 'Write AI Settings',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1320, 100],
  connectFrom: 'Write BI Settings',
  credentials: GOOGLE_SHEETS_CREDENTIAL,
  parameters: {
    method: 'POST',
    url: "=https://sheets.googleapis.com/v4/spreadsheets/{{ $('Build Target Settings').first().json.lanes.ai.spreadsheet_id }}/values:batchUpdate",
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api',
    sendBody: true,
    contentType: 'json',
    specifyBody: 'json',
    jsonBody: "={{ JSON.stringify($('Plan Changes').first().json.ai.body) }}",
    options: {},
  },
};

'use strict';
/*
 * 08-verify-bi.js - reads the BI settings tab back after the write.
 *
 * The Verify-after-write standing order has exactly one named exemption and it is the HQ heartbeat
 * push. This is not that. values:batchUpdate answers with totalUpdatedCells, and that number is the
 * request talking about itself: it counts what the API accepted, not what the document now holds.
 * This node asks Google what is actually in the spreadsheet.
 *
 * It reads the WHOLE tab (A:B), not only the cells that were written, and that is the point. The
 * write is aimed at specific rows, so the failure worth catching is a write that landed on the WRONG
 * rows, and you cannot see that by looking only at the rows you aimed at. Reading everything lets
 * 10-report.js assert three separate things: every synced cell holds its new value, every preserved
 * cell still holds its old one, and the key column is in exactly the order it was before plus any
 * appended keys.
 *
 * Same range shape as the BEFORE read, so the two parses are comparable by construction.
 */

const { GOOGLE_SHEETS_CREDENTIAL } = require('./_sync');

module.exports = {
  name: 'Verify BI Settings',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1540, 100],
  connectFrom: 'Write AI Settings',
  credentials: GOOGLE_SHEETS_CREDENTIAL,
  parameters: {
    method: 'GET',
    url: "=https://sheets.googleapis.com/v4/spreadsheets/{{ $('Build Target Settings').first().json.lanes.bi.spreadsheet_id }}/values:batchGet?ranges={{ encodeURIComponent($('Build Target Settings').first().json.lanes.bi.tab + '!A:B') }}&majorDimension=ROWS",
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api',
    options: {},
  },
};

'use strict';
/*
 * 09-verify-ai.js - reads the AI settings tab back after the write.
 *
 * Same shape and same reasoning as 08-verify-bi.js, pointed at the AI spreadsheet.
 */

const { GOOGLE_SHEETS_CREDENTIAL } = require('./_sync');

module.exports = {
  name: 'Verify AI Settings',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1760, 100],
  connectFrom: 'Verify BI Settings',
  credentials: GOOGLE_SHEETS_CREDENTIAL,
  parameters: {
    method: 'GET',
    url: "=https://sheets.googleapis.com/v4/spreadsheets/{{ $('Build Target Settings').first().json.lanes.ai.spreadsheet_id }}/values:batchGet?ranges={{ encodeURIComponent($('Build Target Settings').first().json.lanes.ai.tab + '!A:B') }}&majorDimension=ROWS",
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api',
    options: {},
  },
};

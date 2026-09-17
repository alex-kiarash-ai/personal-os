'use strict';
/*
 * 04-read-ai.js - reads the AI settings tab BEFORE anything is written.
 *
 * Same shape and same reasoning as 03-read-bi.js, pointed at the AI spreadsheet.
 *
 * BOTH READS HAPPEN BEFORE EITHER WRITE, and that ordering is deliberate. The plan node compares
 * both lanes and refuses as a whole, so a fault on the AI sheet (a corrupted header, a duplicated
 * key, a lane cell that says 34) stops the BI write from happening at all rather than being
 * discovered after the BI sheet has already moved. A half-applied settings change across two lanes
 * is the failure worth designing out: the two lanes would then disagree about a rule that is
 * supposed to be shared, and nothing downstream would notice.
 */

const { GOOGLE_SHEETS_CREDENTIAL } = require('./_sync');

module.exports = {
  name: 'Read AI Settings',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [660, 100],
  connectFrom: 'Read BI Settings',
  credentials: GOOGLE_SHEETS_CREDENTIAL,
  parameters: {
    method: 'GET',
    url: "=https://sheets.googleapis.com/v4/spreadsheets/{{ $('Build Target Settings').first().json.lanes.ai.spreadsheet_id }}/values:batchGet?ranges={{ encodeURIComponent($('Build Target Settings').first().json.lanes.ai.tab + '!A:B') }}&majorDimension=ROWS",
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api',
    options: {},
  },
};

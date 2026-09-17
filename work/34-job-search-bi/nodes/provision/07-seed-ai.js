'use strict';
/*
 * 07-seed-ai.js - writes the settings rows and all three header rows into the AI spreadsheet.
 *
 * Same shape and same reasoning as 05-seed-bi.js, pointed at the AI spreadsheet and the AI seed.
 * The only two differences are the node name in the URL reference and the .ai key in the body.
 */

const { GOOGLE_SHEETS_CREDENTIAL } = require('./_seed');

module.exports = {
  name: 'Seed AI Tabs',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1120, 100],
  connectFrom: 'Create AI Spreadsheet',
  credentials: GOOGLE_SHEETS_CREDENTIAL,
  parameters: {
    method: 'POST',
    url: "=https://sheets.googleapis.com/v4/spreadsheets/{{ $('Create AI Spreadsheet').first().json.spreadsheetId }}/values:batchUpdate",
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api',
    sendBody: true,
    contentType: 'json',
    specifyBody: 'json',
    jsonBody: "={{ JSON.stringify($('Build Seed Payload').first().json.ai.batchBody) }}",
    options: {},
  },
};

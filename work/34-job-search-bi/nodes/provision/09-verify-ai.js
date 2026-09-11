'use strict';
/*
 * 09-verify-ai.js - reads back every range the AI seed wrote.
 *
 * Same shape and same reasoning as 08-verify-bi.js, pointed at the AI spreadsheet.
 */

const { loadSeed, GOOGLE_SHEETS_CREDENTIAL } = require('./_seed');
const seed = loadSeed();

const ranges = seed.tab_order.map(tab => (tab === 'settings' ? 'settings!A:B' : `${tab}!1:1`));
const query = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');

module.exports = {
  name: 'Verify AI Sheet',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1560, 100],
  connectFrom: 'Verify BI Sheet',
  credentials: GOOGLE_SHEETS_CREDENTIAL,
  parameters: {
    method: 'GET',
    url: `=https://sheets.googleapis.com/v4/spreadsheets/{{ $('Create AI Spreadsheet').first().json.spreadsheetId }}/values:batchGet?${query}&majorDimension=ROWS`,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api',
    options: {},
  },
};

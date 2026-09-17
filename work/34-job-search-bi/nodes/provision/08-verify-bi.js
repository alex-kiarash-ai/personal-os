'use strict';
/*
 * 08-verify-bi.js - reads back every range the BI seed wrote.
 *
 * The Verify-after-write standing order has exactly one named exemption and it is the HQ heartbeat
 * push. This is not that. A 200 from values:batchUpdate, and even its own totalUpdatedRows echo, is
 * the request talking about itself. This node asks Google what is actually in the spreadsheet.
 *
 * It matters more here than almost anywhere else in the two lanes: every later stage reads this
 * settings tab, and a settings tab that quietly landed twelve rows instead of twenty eight produces
 * a collector with half a keep list, a scorer with no threshold, and a run report that says GREEN.
 * Nothing downstream can tell that apart from a bad week of postings.
 *
 * Ranges come from the seed's tab_order, so a renamed tab cannot leave a range behind. settings is
 * read as a whole two column block; the other three are header rows only, because that is all that
 * was written.
 *
 * 10-report.js does the comparing and throws on any mismatch.
 */

const { loadSeed, GOOGLE_SHEETS_CREDENTIAL } = require('./_seed');
const seed = loadSeed();

const ranges = seed.tab_order.map(tab => (tab === 'settings' ? 'settings!A:B' : `${tab}!1:1`));
const query = ranges.map(r => `ranges=${encodeURIComponent(r)}`).join('&');

module.exports = {
  name: 'Verify BI Sheet',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [1340, 100],
  connectFrom: 'Seed AI Tabs',
  credentials: GOOGLE_SHEETS_CREDENTIAL,
  parameters: {
    method: 'GET',
    url: `=https://sheets.googleapis.com/v4/spreadsheets/{{ $('Create BI Spreadsheet').first().json.spreadsheetId }}/values:batchGet?${query}&majorDimension=ROWS`,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'googleSheetsOAuth2Api',
    options: {},
  },
};

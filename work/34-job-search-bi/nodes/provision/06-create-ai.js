'use strict';
/*
 * 06-create-ai.js - creates the "Job Search - AI" spreadsheet with the same four tabs.
 *
 * Deliberately SEQUENTIAL, hanging off Seed BI Tabs rather than running in parallel with the BI
 * branch. Two reasons, both about what happens when it goes wrong:
 *
 * 1. If the BI half fails, the AI half never runs, so a failed provisioning leaves at most one
 *    orphan spreadsheet to clean up instead of two half seeded ones.
 * 2. Both branches hit the same Google account with the same credential. Serial is polite and the
 *    whole run is four API calls, so there is nothing to gain by racing them.
 *
 * The title and the tab list come from the same seed file as the BI node, so the two spreadsheets
 * cannot drift a tab name. That is the whole reason the tab list is not typed out twice.
 *
 * See 04-create-bi.js for the resource/operation naming note: the stored value is 'spreadsheet'
 * even though the dropdown reads "Document".
 */

const { loadSeed, GOOGLE_SHEETS_CREDENTIAL } = require('./_seed');
const seed = loadSeed();

module.exports = {
  name: 'Create AI Spreadsheet',
  type: 'n8n-nodes-base.googleSheets',
  typeVersion: 4.5,
  position: [900, 100],
  connectFrom: 'Seed BI Tabs',
  credentials: GOOGLE_SHEETS_CREDENTIAL,
  parameters: {
    resource: 'spreadsheet',
    operation: 'create',
    title: seed.lanes.ai.spreadsheet_title,
    sheetsUi: {
      sheetValues: seed.tab_order.map(tab => ({ title: tab, hidden: false })),
    },
    options: {},
  },
};

'use strict';
/*
 * 04-create-bi.js - creates the "Job Search - BI" spreadsheet with all four tabs.
 *
 * ONE node, not five. The brief asked me to check whether "create spreadsheet" and "create sheet
 * within spreadsheet" are separate operations in typeVersion 4.5. They are:
 *
 *   resource 'spreadsheet' + operation 'create'  ->  the UI calls this "Document > Create"
 *   resource 'sheet'       + operation 'create'  ->  the UI calls this "Sheet Within Document > Create"
 *
 * The stored VALUE is 'spreadsheet' even though the dropdown reads "Document". That mismatch is the
 * one thing worth knowing here: a node file written from the documentation's display names would
 * carry resource 'document' and fail.
 *
 * But the split does not cost four extra nodes, because 'spreadsheet:create' takes a Sheets list and
 * creates every tab in the same call. So 'sheet:create' is not needed at all and four nodes that
 * could each half fail never exist.
 *
 * Parameter names verified against the operation definition in n8n's own source
 * (packages/nodes-base/nodes/Google/Sheet/v2/actions/spreadsheet/create.operation.ts): 'title' as a
 * string, 'sheetsUi' as a fixedCollection whose inner key is 'sheetValues', each entry {title, hidden}.
 *
 * typeVersion 4.5 confirmed against the live box: 23 Google Sheets nodes are running there and all
 * of them are v4.5.
 *
 * Output is the raw Google Spreadsheet resource, so downstream reads $json.spreadsheetId and
 * $json.spreadsheetUrl.
 */

const { loadSeed, GOOGLE_SHEETS_CREDENTIAL } = require('./_seed');
const seed = loadSeed();

module.exports = {
  name: 'Create BI Spreadsheet',
  type: 'n8n-nodes-base.googleSheets',
  typeVersion: 4.5,
  position: [460, 100],
  connectFrom: 'Build Seed Payload',
  credentials: GOOGLE_SHEETS_CREDENTIAL,
  parameters: {
    resource: 'spreadsheet',
    operation: 'create',
    title: seed.lanes.bi.spreadsheet_title,
    sheetsUi: {
      sheetValues: seed.tab_order.map(tab => ({ title: tab, hidden: false })),
    },
    options: {},
  },
};

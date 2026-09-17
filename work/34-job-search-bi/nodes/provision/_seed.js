'use strict';
/*
 * _seed.js - the one place the provisioning node files read their values from.
 *
 * The values (Shaheen's search terms, keep and drop lists, geography, the webhook path and the
 * shared token) live in work/34-job-search-bi/config/seed.json, which is GITIGNORED. This folder
 * is TRACKED and the repo is PUBLIC, so a node file that carried those values would publish his
 * exact job-search targeting and an open webhook path the first time anyone ran git add.
 *
 * The node files hold wiring. seed.json holds facts. Same split as nodes/README.md already states
 * for source field names, applied to the one other thing in here worth protecting.
 *
 * The leading underscore keeps this file out of build.js's node glob (/^\d+-.+\.js$/), so it can
 * never be mistaken for a node.
 */

const fs = require('fs');
const path = require('path');

const SEED_FILE = path.resolve(__dirname, '..', '..', 'config', 'seed.json');

function loadSeed() {
  if (!fs.existsSync(SEED_FILE)) {
    throw new Error(
      'provision node files: work/34-job-search-bi/config/seed.json is missing.\n' +
      '  It is gitignored on purpose, so a fresh clone will not have it and cannot provision.\n' +
      '  It carries the seed values, the webhook path and the shared token. Restore it from the\n' +
      '  nightly encrypted vault backup, or rewrite it from the card at\n' +
      '  outputs/sessions/2026-09-11-job-search-lanes/cards/provision.md, which lists every key.'
    );
  }
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  for (const k of ['tab_order', 'tabs', 'provision', 'lanes']) {
    if (seed[k] === undefined) throw new Error(`provision node files: seed.json is missing required key '${k}'`);
  }
  for (const laneKey of ['bi', 'ai']) {
    const lane = seed.lanes[laneKey];
    if (!lane || !lane.spreadsheet_title || !lane.settings) {
      throw new Error(`provision node files: seed.json lanes.${laneKey} needs both spreadsheet_title and settings`);
    }
  }
  // Every tab named in tab_order must have a header row, or a tab gets created with no columns
  // and the batchUpdate range points at a sheet nobody described.
  for (const tab of seed.tab_order) {
    if (!Array.isArray(seed.tabs[tab]) || !seed.tabs[tab].length) {
      throw new Error(`provision node files: seed.json tab_order names '${tab}' but tabs.${tab} has no header row`);
    }
  }
  return seed;
}

// The Google Sheets credential, by id, reused and never recreated. The NAME is cosmetic: n8n
// resolves the credential by id, and the name is only what the editor prints.
const GOOGLE_SHEETS_CREDENTIAL = {
  googleSheetsOAuth2Api: { id: 'UhK77WK48hRv85bo', name: 'Google Sheets account' },
};

module.exports = { loadSeed, SEED_FILE, GOOGLE_SHEETS_CREDENTIAL };

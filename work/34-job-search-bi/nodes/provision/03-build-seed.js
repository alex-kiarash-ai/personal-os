'use strict';
/*
 * 03-build-seed.js - the encoder, and the only place a list becomes a cell.
 *
 * THE SETTINGS ENCODING, stated once so Agent 4 Stage A never has to guess it:
 *
 *   A list value is its items joined with a single '|' character. No spaces are added.
 *   Decode with:  String(v).split('|').map(s => s.trim()).filter(Boolean)
 *   A switch is the literal text 'on' or 'off'.
 *   Decode with:  String(v).trim().toLowerCase() === 'on'
 *   A number is plain text.
 *   Decode with:  Number(String(v).trim())
 *
 * Why a pipe and not a comma: 'data & analytics' and 'make.com' are real keep-list items, and the
 * lists are full of multi-word titles. A comma separator would split 'data & analytics' the moment
 * anyone wrote it with a comma, and would make every future item with a comma a silent truncation.
 * Nothing in any list contains a pipe.
 *
 * Encode tight, decode tolerant. The encoder adds no spaces; the decoder trims them, so Shaheen can
 * type 'a | b | c' into a cell on his phone and the next run reads it correctly.
 *
 * The two constraints that follow from the decoder, both ENFORCED below at runtime rather than
 * trusted: no item may contain a '|', and no item may start or end with a space. A violation of
 * either would produce a silently shorter list inside a filter nobody reads again, which is the
 * exact failure this node exists to prevent.
 *
 * Values come from work/34-job-search-bi/config/seed.json at BUILD time and are baked into jsCode,
 * because the n8n box cannot read this repo. seed.json is gitignored; this file is tracked and
 * public, so it carries the logic and none of the values.
 */

const { loadSeed } = require('./_seed');
const seed = loadSeed();

const LOGIC = `
// ---------------------------------------------------------------------------
// Token gate. A manual run from the editor skips it, because the editor already
// required a login. A webhook call must carry the shared token in its body.
// ---------------------------------------------------------------------------
const first = $input.first();
const inJson = (first && first.json) || {};
const cameFromWebhook = Object.prototype.hasOwnProperty.call(inJson, 'headers');
if (cameFromWebhook) {
  const body = inJson.body || {};
  if (String(body.token || '') !== TOKEN) {
    throw new Error('provision: bad or missing token. This workflow creates spreadsheets and refuses an unauthenticated caller.');
  }
}

// ---------------------------------------------------------------------------
// The encoder.
// ---------------------------------------------------------------------------
const SEP = '|';

function encodeValue(v) {
  if (Array.isArray(v)) return v.join(SEP);
  if (v === null || v === undefined) return '';
  return String(v);
}

// Refuse to write a list that cannot survive the round trip. Both checks mirror
// exactly what the documented decoder does, so a value that passes here is a
// value Stage A can read back whole.
for (const laneKey of Object.keys(LANES)) {
  const settings = LANES[laneKey].settings;
  for (const settingKey of Object.keys(settings)) {
    const v = settings[settingKey];
    if (!Array.isArray(v)) continue;
    for (const item of v) {
      const s = String(item);
      if (s.indexOf(SEP) !== -1) {
        throw new Error('provision: ' + laneKey + '.' + settingKey + ' has an item containing the list separator, which would split into two on decode: ' + s);
      }
      if (s !== s.trim()) {
        throw new Error('provision: ' + laneKey + '.' + settingKey + ' has an item with a leading or trailing space, which the decoder would trim away: ' + JSON.stringify(s));
      }
      if (s === '') {
        throw new Error('provision: ' + laneKey + '.' + settingKey + ' has an empty item, which the decoder would drop: the list would come back shorter than it went in.');
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The batchUpdate body per lane. One request per spreadsheet writes the settings
// tab and all three header rows together, so a spreadsheet is either fully
// seeded or not seeded at all. Four separate append nodes would have four ways
// to leave a half built sheet that looks finished.
// ---------------------------------------------------------------------------
function settingsRows(lane) {
  const rows = [TABS.settings.slice()];
  for (const key of Object.keys(lane.settings)) {
    rows.push([key, encodeValue(lane.settings[key])]);
  }
  return rows;
}

function batchBody(lane) {
  const data = [{ range: 'settings!A1', values: settingsRows(lane) }];
  for (const tab of TAB_ORDER) {
    if (tab === 'settings') continue;
    data.push({ range: tab + '!A1', values: [TABS[tab].slice()] });
  }
  // RAW, so every value is stored exactly as sent. USER_ENTERED would parse a
  // leading '=' as a formula and would coerce types per cell, which is the wrong
  // behaviour for a config tab that has to read back as text.
  return { valueInputOption: 'RAW', data: data };
}

const out = {};
for (const laneKey of Object.keys(LANES)) {
  const lane = LANES[laneKey];
  out[laneKey] = {
    title: lane.spreadsheet_title,
    tabs: TAB_ORDER,
    settings_row_count: Object.keys(lane.settings).length,
    batchBody: batchBody(lane),
  };
}

return [{ json: out }];
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/config/seed.json. Edit that file, not this node.',
  `const TOKEN = ${JSON.stringify(seed.provision.token)};`,
  `const TAB_ORDER = ${JSON.stringify(seed.tab_order)};`,
  `const TABS = ${JSON.stringify(seed.tabs)};`,
  `const LANES = ${JSON.stringify(seed.lanes)};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Build Seed Payload',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [240, 100],
  connectFrom: ['Provision Webhook', 'Manual Run'],
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

'use strict';
/*
 * _lane.js - the one place a pipeline node file reads its lane facts from.
 *
 * WHY THIS EXISTS, and it is the same reason as nodes/provision/_seed.js.
 * This folder is TRACKED and the repo is PUBLIC. `config/` is gitignored
 * (.gitignore:98, work/*./config/). So a node file that carried the Google
 * spreadsheet id, the cron or the settings values would publish them the first
 * time anyone ran git add. Node files hold WIRING. config/ holds FACTS.
 *
 * Everything here is read at BUILD time, by build.js on this machine, and baked
 * into the node parameters that get PUT to n8n. The n8n box cannot read this
 * repo, so there is no runtime dependency on any of it.
 *
 * PORTING TO #35: every path below resolves from __dirname, and the two
 * lane-specific inputs (lane.json and the lane's key set) come from the lane's
 * OWN config folder. So work/35-job-search-ai/nodes/ can hold a byte-identical
 * copy of this file and of every NN-*.js beside it, and the copy builds the AI
 * lane correctly with no edit. The shared contract (sources.json) and the
 * provisioning seed (seed.json) are resolved to their ONE home under
 * work/34-job-search-bi/config/, deliberately not copied, for the reason
 * work/34-job-search-bi/CLAUDE.md gives: two copies is how two lanes that are
 * supposed to be identical drift a field name.
 *
 * The leading underscore keeps this file out of build.js's node glob
 * (/^\d+-.+\.js$/), so it can never be mistaken for a node.
 */

const fs = require('fs');
const path = require('path');

// nodes/ -> work/{NN}-{lane}/ -> work/ -> repo root
const LANE_DIR = path.resolve(__dirname, '..');
const REPO = path.resolve(__dirname, '..', '..', '..');
const LANE_FILE = path.join(LANE_DIR, 'config', 'lane.json');
// Shared, not copied. Same home for both lanes.
const SEED_FILE = path.join(REPO, 'work', '34-job-search-bi', 'config', 'seed.json');

function readJson(file, what) {
  if (!fs.existsSync(file)) {
    throw new Error(
      `Stage A node files: ${what} is missing at ${path.relative(REPO, file).replace(/\\/g, '/')}.\n` +
      '  config/ is gitignored on purpose, so a fresh clone will not have it and cannot build these\n' +
      '  nodes. Restore it from the nightly encrypted vault backup.'
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function lane() {
  const l = readJson(LANE_FILE, "this lane's config/lane.json");
  for (const k of ['lane', 'name', 'title', 'cron', 'timezone', 'credentials', 'sheet', 'sources_contract']) {
    if (l[k] === undefined) throw new Error(`Stage A node files: lane.json is missing required key '${k}'`);
  }
  for (const k of ['spreadsheet_id', 'settings_tab', 'tab', 'run_ledger_tab']) {
    if (!l.sheet[k]) {
      throw new Error(
        `Stage A node files: lane.json sheet.${k} is empty. The sheets were provisioned on 2026-09-11 and ` +
        'both ids were written back into the lane files; an empty value here means the lane file was ' +
        'reverted or restored from before that. Do not guess an id.'
      );
    }
  }
  return l;
}

// The shared source contract. Endpoints, params, live field names, date fields and formats,
// dedup rules. Never restated in a node file, always read from here.
function sources() {
  const l = lane();
  const file = path.resolve(REPO, l.sources_contract);
  const s = readJson(file, 'the shared source contract (sources.json)');
  if (!s.sources || !Object.keys(s.sources).length) throw new Error('Stage A node files: sources.json has no sources');
  if (!Array.isArray(s.shared_row_shape) || !s.shared_row_shape.length) {
    throw new Error('Stage A node files: sources.json has no shared_row_shape');
  }
  return s;
}

// ---------------------------------------------------------------------------------------------
// THE SETTINGS SCHEMA.
//
// Declared here rather than derived from seed.json, so Stage A keeps working after the
// provisioning seed is archived or deleted. seed.json is used as a CROSS CHECK when it is present
// (see settingsSchema below), never as the dependency. Key names are this lane's own schema and
// carry nothing about what Shaheen is hunting; the VALUES are the sensitive half and they live in
// the sheet and in the gitignored seed.
//
// Types, and the decoder each one gets, mirrored EXACTLY from the encoder in
// nodes/provision/03-build-seed.js:
//   list    String(v).split('|').map(s => s.trim()).filter(Boolean)
//   switch  String(v).trim().toLowerCase() === 'on'   (the cell holds the literal text on / off)
//   number  Number(String(v).trim())
//   text    String(v), trimmed only at the edges
// ---------------------------------------------------------------------------------------------
const LIST_KEYS = ['locations', 'search_terms', 'search_terms_sv', 'keep_if_title_has', 'always_drop'];
const NUMBER_KEYS = ['score_threshold', 'max_scored_per_run', 'max_cost_per_run_usd', 'first_run_window_hours', 'min_window_hours'];
const TEXT_KEYS = ['readme', 'lane', 'score_scale', 'last_run_at', 'geo_rule', 'language_rule', 'match_rule'];
const FIXED_SWITCH_KEYS = ['scoring_enabled'];
// Matched case insensitively downstream, so the cell must already be lowercase or the same term
// written two ways would behave as two different rules.
const LOWERCASE_LISTS = ['keep_if_title_has', 'always_drop'];
// A wiped cell in one of these empties a filter and the run would look healthy. search_terms_sv is
// deliberately NOT here: the AI lane ships it empty on purpose.
const REQUIRED_NONEMPTY_LISTS = ['locations', 'search_terms', 'keep_if_title_has', 'always_drop'];

function settingsSchema() {
  const src = sources();
  // The nine source switches are named source_<key> after the EXACT keys in the contract, so a
  // renamed source loses its switch LOUDLY here at build time instead of silently defaulting to on.
  const sourceSwitches = Object.keys(src.sources).map(k => `source_${k}`);
  const switchKeys = FIXED_SWITCH_KEYS.concat(sourceSwitches);
  const all = LIST_KEYS.concat(NUMBER_KEYS, TEXT_KEYS, switchKeys);

  const dupe = all.find((k, i) => all.indexOf(k) !== i);
  if (dupe) throw new Error(`Stage A node files: settings schema declares '${dupe}' twice`);

  const schema = {
    keys: all,
    list: LIST_KEYS.slice(),
    number: NUMBER_KEYS.slice(),
    text: TEXT_KEYS.slice(),
    switch: switchKeys,
    source_switches: sourceSwitches,
    lowercase_lists: LOWERCASE_LISTS.slice(),
    required_nonempty_lists: REQUIRED_NONEMPTY_LISTS.slice(),
  };

  // CROSS CHECK against the seed that actually wrote the tabs, when it is still on disk. This is
  // the check that catches a schema drifting away from the cells it has to read. It is a check,
  // not a source: an absent seed.json skips it and says nothing, because the seed is a spent
  // provisioning artifact and Stage A must not die when it is archived.
  if (fs.existsSync(SEED_FILE)) {
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    for (const laneKey of Object.keys(seed.lanes || {})) {
      const settings = seed.lanes[laneKey].settings || {};
      const seeded = Object.keys(settings);
      const missing = all.filter(k => !seeded.includes(k));
      const extra = seeded.filter(k => !all.includes(k));
      if (missing.length || extra.length) {
        throw new Error(
          `Stage A node files: the settings schema disagrees with the seed that wrote the ${laneKey} tab.\n` +
          (missing.length ? `  the schema expects keys the seed never wrote: ${missing.join(', ')}\n` : '') +
          (extra.length ? `  the seed wrote keys the schema does not know: ${extra.join(', ')}\n` : '') +
          '  Parse Settings would throw on a real run. Fix the schema in nodes/_lane.js, or the seed.'
        );
      }
      for (const k of LIST_KEYS) {
        if (!Array.isArray(settings[k])) throw new Error(`Stage A node files: schema calls ${laneKey}.${k} a list, the seed wrote ${typeof settings[k]}`);
      }
      for (const k of switchKeys) {
        if (settings[k] !== 'on' && settings[k] !== 'off') throw new Error(`Stage A node files: schema calls ${laneKey}.${k} a switch, the seed wrote ${JSON.stringify(settings[k])}`);
      }
      for (const k of NUMBER_KEYS) {
        if (!Number.isFinite(Number(String(settings[k]).trim()))) throw new Error(`Stage A node files: schema calls ${laneKey}.${k} a number, the seed wrote ${JSON.stringify(settings[k])}`);
      }
    }
  }
  return schema;
}

// The Google Sheets credential, by id, reused and never recreated. The name is cosmetic: n8n
// resolves by id and only the editor reads the name.
function googleSheetsCredential() {
  return { googleSheetsOAuth2Api: { id: lane().credentials.google_sheets, name: 'Google Sheets account' } };
}

module.exports = { lane, sources, settingsSchema, googleSheetsCredential, REPO, LANE_DIR };

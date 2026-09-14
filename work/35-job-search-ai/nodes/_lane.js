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

// ---------------------------------------------------------------------------------------------
// THE PAGING CAPS (added 2026-09-12 with adaptive LinkedIn paging and Himalayas cursor paging).
//
// THREE LEVELS, highest wins: the settings tab, then lane.json, then the defaults below.
//
// WHY THE DEFAULTS LIVE HERE AND NOT IN lane.json, which is a deviation from the dispatch that
// asked for a lane.json default, and it is deliberate.
//   1. The settings tabs are already provisioned and the provisioner is DELETED. Requiring a new
//      settings row would mean Shaheen hand editing a cell before paging works at all, and he
//      already has two hand edits queued. A default that needs a manual step is not a default.
//   2. lane.json is gitignored and PER LANE. #35's node files are a byte-identical copy of #34's,
//      and #35's lane.json has no paging block. Putting the only default there would make the two
//      lanes silently disagree, or make a #35 build fail on a missing key, for numbers that are
//      not personal data and belong in the tracked file where anyone can read them.
// So: these are the defaults, a lane.json `paging` object overrides them per lane, and an OPTIONAL
// settings row overrides that at run time. Nothing has to be edited for the shipped numbers to
// apply, and the run report always says which level each number came from.
//
// THE NUMBERS, and what each one is protecting.
//   linkedin_max_calls_per_run  the HARD ceiling the dispatch demanded. The BI plan already emits
//     12 base calls and #35 emits 14, against a documented refusal threshold of roughly ten pages
//     for a datacenter IP that has never been tested from the Hetzner box (D20). 20 leaves 8 extra
//     pages for BI and 6 for AI. On a normal 24h window most queries return a partial page and cost
//     nothing extra; the first 168h run is the worst case and will spend the whole budget.
//     IT CAPS PAGING, NEVER THE BASE PLAN. A ceiling below the base plan means zero extra pages,
//     never a dropped query: Stage A refused to trim search terms to fit under a number and that
//     decision stands.
//   linkedin_max_pages_per_query  stops one busy term eating the whole run budget. The loop already
//     spends breadth first, so this is the backstop rather than the main lever.
//   himalayas_max_pages_per_run  the feed is paged until the oldest row on a page falls before the
//     window, so on a normal day the WINDOW stops the loop, not this cap. Measured density across
//     the two probe pages is about 4 rows an hour (page 1 spans 9.3 hours in 20 rows; page 2 spans
//     16 minutes, a batch-import cluster), so a 24h window is on the order of 5 pages and a 168h
//     first run is on the order of 35. 12 covers the daily case with headroom and truncates the
//     first run honestly, with the oldest pubDate reached named in the report.
//
// THE TWO DETAIL CAPS (added 2026-09-12 with the LinkedIn detail fetch), and the second one is a
// different KIND of cap from everything above it.
//   linkedin_detail_max_calls_per_run  one GET per new LinkedIn row that survived dedupe. The row
//     cap upstream is max_scored_per_run, which is 20 on both live sheets, so a naive detail fetch
//     adds up to 20 calls on top of a search leg that is already allowed 20. That is about 40
//     LinkedIn calls in a run, against a documented refusal threshold of roughly ten (D20) and a
//     single measured data point of 20 calls from the box with no refusal (execution 5154). 10 is
//     half the only number anyone has ever measured as safe, spent on the rows the run is actually
//     going to score.
//   linkedin_total_max_calls_per_run  THE ONE THAT MATTERS. A per-stage cap that lets the total run
//     away is not a cap: the search leg and the detail leg hit the SAME host from the SAME IP, and
//     LinkedIn counts the sum. So this is a whole-run budget across search plus paging plus detail,
//     and the detail leg gets what the search leg did not spend. 25 is the measured-safe 20 plus a
//     deliberate margin of 5, and nothing raises it except a hand edit that the clamp still bounds.
//     On a normal 24h window the search leg spends 10 to 14 and there are 1 to 7 new rows, so the
//     total lands around 12 to 21 and this never bites. On the 168h first run the search leg spends
//     its whole 20, the detail leg gets 5 of 20 rows, and the report says so in those words.
//
// THE DEMAND MULTIPLE (added 2026-09-12 after execution 5182 measured the starve).
//   linkedin_page_demand_multiple  how much RAW LinkedIn supply the run wants in hand before it
//     stops asking for more pages, as a multiple of the rows it can actually keep AND describe.
//     It exists because a search call and a detail call come out of the same whole-run budget, so
//     an extra page of results is bought with a description. Measured on execution 5182: page 1 of
//     the 11 base queries returned 50 DISTINCT posting ids and 26 of them survived the title filter
//     (52%); across both pages 40 of 88 survived (45%). A multiple of 3 therefore stops paging with
//     roughly 1.35x the cap in expected survivors, which is a 35% margin over filling the cap. It is
//     deliberately conservative because the two directions fail differently: too high just spends
//     calls, too low leaves a full page unfollowed that nothing will ever come back for.
// ---------------------------------------------------------------------------------------------
const PAGING_DEFAULTS = {
  linkedin_max_calls_per_run: 20,
  linkedin_max_pages_per_query: 5,
  himalayas_max_pages_per_run: 12,
  // 10 -> 14 on 2026-09-14, Shaheen's call, and the reason is the ad-language gate rather than
  // appetite. He chose 10 that morning when 10 described meant 10 usable rows in his sheet. The
  // gate now drops the postings written in languages he cannot read, AFTER scoring and without
  // reaching back for replacements, so 10 described had become roughly 3 usable. 14 restores the
  // list without moving the ceiling: the whole-run budget below is still 25, which is what
  // actually bounds LinkedIn exposure, and run 5247 spent 11 on search, so 11 + 14 lands exactly
  // on it. The hard clamp in 33-detail-gate.js (30) is untouched and still the thing a hand
  // edited settings cell cannot get past.
  linkedin_detail_max_calls_per_run: 14,
  linkedin_total_max_calls_per_run: 25,
  linkedin_page_demand_multiple: 3,
};
// Optional settings rows. NOT in SCHEMA.keys, on purpose: a key in that list is REQUIRED and Parse
// Settings throws when it is missing, which would break every existing sheet. These are decoded when
// present and simply absent when they are not.
const OPTIONAL_NUMBER_KEYS = Object.keys(PAGING_DEFAULTS);

// Resolves defaults against lane.json, at BUILD time. The settings-tab layer is applied at RUN time
// by Parse Settings, because only the sheet knows what is in the sheet.
function pagingDefaults() {
  const l = lane();
  const over = (l.paging && typeof l.paging === 'object' && !Array.isArray(l.paging)) ? l.paging : {};
  for (const k of Object.keys(over)) {
    if (!Object.prototype.hasOwnProperty.call(PAGING_DEFAULTS, k)) {
      throw new Error(
        `Stage A node files: lane.json paging has an unknown key '${k}'. Known caps: ${OPTIONAL_NUMBER_KEYS.join(', ')}.\n` +
        '  Refused rather than ignored: a misspelt cap that is silently dropped reads as a cap that was set.'
      );
    }
    if (!Number.isInteger(over[k]) || over[k] < 1) {
      throw new Error(`Stage A node files: lane.json paging.${k} is ${JSON.stringify(over[k])}. A cap is a positive whole number.`);
    }
  }
  const values = {};
  const from = {};
  for (const k of OPTIONAL_NUMBER_KEYS) {
    values[k] = Object.prototype.hasOwnProperty.call(over, k) ? over[k] : PAGING_DEFAULTS[k];
    from[k] = Object.prototype.hasOwnProperty.call(over, k) ? 'lane.json' : 'node default';
  }
  return { values, from, keys: OPTIONAL_NUMBER_KEYS.slice() };
}
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
    // Present-or-absent, never required. Deliberately NOT in `keys`: that list is the REQUIRED set
    // and a key added there throws on every sheet that does not already carry the row.
    optional_number: OPTIONAL_NUMBER_KEYS.slice(),
  };
  for (const k of OPTIONAL_NUMBER_KEYS) {
    if (all.indexOf(k) !== -1) {
      throw new Error(`Stage A node files: '${k}' is declared both required and optional. An optional key in SCHEMA.keys makes Parse Settings throw on every sheet that has not been hand edited.`);
    }
  }

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

module.exports = { lane, sources, settingsSchema, googleSheetsCredential, pagingDefaults, REPO, LANE_DIR };

'use strict';
/*
 * _sync.js - the one place the settings-sync node files read their values from.
 *
 * Same split every other folder in this lane uses, and for the same reason: `nodes/` is TRACKED and
 * the repo is PUBLIC, so a node file carrying Shaheen's search terms, keep list, drop list or a
 * spreadsheet id would publish his exact job-search targeting on the first `git add`. The values
 * live in `config/seed.json` and `config/lane.json` (both gitignored). Node files hold wiring.
 *
 * The leading underscore keeps this file out of build.js's node glob (/^\d+-.+\.js$/).
 *
 * ---------------------------------------------------------------------------------------------
 * THE SYNCABLE-KEY RULE, and it is an ALLOWLIST rather than a denylist. State it once, here.
 * ---------------------------------------------------------------------------------------------
 * SYNCABLE = every key in seed.json's lane settings, MINUS the RUNTIME keys named below.
 * Everything else on the live sheet is PRESERVED byte for byte and never written.
 *
 * Why an allowlist and not "skip last_run_at":
 *   1. A denylist fails OPEN. The day Stage F adds a second pipeline-written key, or someone hand
 *      adds one of the optional paging caps, a denylist sync clobbers it and nothing anywhere says
 *      so. An allowlist fails CLOSED: an unknown key is simply not in the write set, so the worst
 *      case is that a new key does not get synced, which is visible the moment someone looks for it.
 *   2. The write set is then a FIXED, countable list. The read-back comparator knows exactly how
 *      many cells should have moved and exactly which cells must be unchanged, which is what turns
 *      "the write returned 200" into a real verification.
 *   3. It composes with the sheet being hand-editable by design. Shaheen can add a row to that tab
 *      and this sync will leave it alone rather than deciding it was a mistake.
 *
 * RUNTIME_KEYS is the set the PIPELINE owns. Today that is exactly one key:
 *   last_run_at   written at the end of a successful run, and the basis of the whole search-window
 *                 design: an empty cell means "first run, use first_run_window_hours (168)", and a
 *                 timestamp means "collect since then, floored at min_window_hours". Overwriting it
 *                 with the seed's empty string would silently re-run a 168 hour window and re-collect
 *                 a week of jobs, which looks like a busy morning rather than like a bug.
 *
 * It is both EXCLUDED from the allowlist and asserted absent from the write set at run time, in
 * 05-plan-changes.js. Two mechanisms for one rule on purpose: the allowlist is the design, the
 * assertion is the thing that fires if someone later edits the design.
 *
 * NOT runtime, and deliberately still syncable: `lane`. It never changes, and it is the value the
 * lane guard compares against, so a sync that could not restore it could not repair the one cell
 * whose corruption is worst.
 */

const fs = require('fs');
const path = require('path');

const CONFIG = path.resolve(__dirname, '..', '..', 'config');
const SEED_FILE = path.join(CONFIG, 'seed.json');
const LANE_FILES = {
  bi: path.join(CONFIG, 'lane.json'),
  ai: path.resolve(__dirname, '..', '..', '..', '35-job-search-ai', 'config', 'lane.json'),
};

// The pipeline owns these. The sync reads them, reports them, and never writes them.
const RUNTIME_KEYS = ['last_run_at'];

// Present-or-absent rows a human may add by hand. Not in seed.json, so they are not in the
// allowlist either, and the sync preserves whatever the sheet holds. Named here so the report can
// say "preserved because it is a hand-set cap" rather than "preserved because it is unknown".
const KNOWN_OPTIONAL_KEYS = [
  'linkedin_max_calls_per_run',
  'linkedin_max_pages_per_query',
  'himalayas_max_pages_per_run',
];

const SEP = '|';

function loadSeed() {
  if (!fs.existsSync(SEED_FILE)) {
    throw new Error(
      'sync-settings node files: work/34-job-search-bi/config/seed.json is missing.\n' +
      '  It is gitignored on purpose, so a fresh clone will not have it and cannot build this sync.\n' +
      '  It carries the approved settings values for both lanes. Restore it from the nightly\n' +
      '  encrypted vault backup.'
    );
  }
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  if (!seed.lanes) throw new Error('sync-settings node files: seed.json has no lanes block');
  for (const laneKey of ['bi', 'ai']) {
    const lane = seed.lanes[laneKey];
    if (!lane || !lane.settings) throw new Error(`sync-settings node files: seed.json lanes.${laneKey}.settings is missing`);
  }
  return seed;
}

function loadLane(laneKey) {
  const file = LANE_FILES[laneKey];
  if (!fs.existsSync(file)) {
    throw new Error(`sync-settings node files: lane file not found for '${laneKey}': ${file}`);
  }
  const lane = JSON.parse(fs.readFileSync(file, 'utf8'));
  const id = lane.sheet && lane.sheet.spreadsheet_id;
  if (!id) {
    throw new Error(
      `sync-settings node files: ${laneKey} lane.json has no sheet.spreadsheet_id.\n` +
      '  The sync writes into an EXISTING spreadsheet. With no id there is nothing to sync and the\n' +
      '  URL would resolve to .../undefined/values:batchUpdate, which is a 404 rather than a wrong write.'
    );
  }
  const tab = (lane.sheet && lane.sheet.settings_tab) || 'settings';
  return { id, tab, laneNumber: String(lane.lane), title: lane.title };
}

// The documented encoder, byte identical to the provisioner's. A list becomes its items joined with
// a single pipe and no added spaces; everything else becomes its own string.
function encodeValue(v) {
  if (Array.isArray(v)) return v.join(SEP);
  if (v === null || v === undefined) return '';
  return String(v);
}

/*
 * BUILD-TIME validation of the values about to be baked in. Deliberately here and not only at run
 * time: a value that cannot survive the round trip should fail before a single byte reaches the box,
 * not halfway through a run that has already written one spreadsheet.
 *
 * Same six classes the provisioner enforces, because the sync writes into the same cells the
 * provisioner wrote and the decoder on the other side has not changed.
 */
const LOWERCASE_LISTS = new Set(['keep_if_title_has', 'always_drop']);

function validateTargets(seed) {
  for (const laneKey of Object.keys(seed.lanes)) {
    const settings = seed.lanes[laneKey].settings;
    const fail = (k, msg) => { throw new Error('sync target: ' + laneKey + '.' + k + ' ' + msg); };

    for (const k of Object.keys(settings)) {
      const v = settings[k];
      if (!Array.isArray(v)) {
        // A scalar carrying the separator is not an error (readme legitimately contains one), but a
        // scalar carrying a newline is: a cell value with a line break reads back differently and
        // would fail the comparator on every run with no way to fix it from the sheet.
        if (/[\r\n]/.test(String(v))) fail(k, 'contains a line break, which a settings cell cannot round trip.');
        continue;
      }
      const seen = new Set();
      for (const item of v) {
        const t = String(item);
        if (t === '') fail(k, 'has an empty item, which the decoder drops.');
        if (t !== t.trim()) fail(k, 'has an item with edge whitespace the decoder trims: ' + JSON.stringify(t));
        if (t.includes(SEP)) fail(k, 'has an item containing the list separator: ' + t);
        if (LOWERCASE_LISTS.has(k) && t !== t.toLowerCase()) fail(k, 'is matched case insensitively, write it lowercase: ' + t);
        if (seen.has(t)) fail(k, 'has a duplicate item: ' + t);
        seen.add(t);
      }
    }

    // always_drop wins over keep_if_title_has, so a keep term that CONTAINS a drop term is inert
    // config that can never match. It passes today; the check exists so a narrowing pass cannot
    // introduce one unnoticed.
    const drop = settings.always_drop || [];
    for (const keep of settings.keep_if_title_has || []) {
      const hit = drop.find(d => keep.includes(d));
      if (hit) fail('keep_if_title_has', 'term "' + keep + '" contains always_drop term "' + hit + '" and can never match.');
    }

    for (const k of RUNTIME_KEYS) {
      if (settings[k] === undefined) continue;
      // Present in the seed is fine and expected. It simply must never reach the write set, which
      // is what syncableSettings() below and the run-time assertion in 05 both enforce.
    }
  }
  return seed;
}

// The allowlist, applied. Returns { key: encodedValue } with every runtime key removed.
function syncableSettings(seed, laneKey) {
  const settings = seed.lanes[laneKey].settings;
  const out = {};
  for (const k of Object.keys(settings)) {
    if (RUNTIME_KEYS.indexOf(k) !== -1) continue;
    out[k] = encodeValue(settings[k]);
  }
  return out;
}

/*
 * The settings-tab reader, shared VERBATIM by 05-plan-changes.js and 10-report.js.
 *
 * It lives here as one string and is injected into both nodes at build time rather than being typed
 * twice, because the two nodes have to agree exactly about what the sheet says. The plan node
 * decides which cell to write from this parse; the report node decides whether the write landed from
 * the same parse. Two hand-maintained copies of that logic is how a comparator ends up tolerating
 * the very difference the writer introduced. A test asserts both node files carry this block.
 *
 * THE ONE PIECE OF REAL SHEETS BEHAVIOUR IN HERE: trailing empty cells are TRIMMED on the way back,
 * so a row written as ['last_run_at',''] reads back as ['last_run_at'] with length 1. A parser that
 * indexes [1] blindly gets undefined and would report the cell as missing rather than as empty. That
 * is not a hypothetical: last_run_at is empty on both live sheets today, and it is the exact cell
 * this whole sync exists to protect.
 */
const PARSE_TAB_LOGIC = `
function a1(tab, ref) {
  // A tab name needs quoting in A1 notation unless it is a bare word. Quoting is always legal, so
  // quote whenever the name is anything but [A-Za-z0-9_], and double any single quote inside it.
  var safe = /^[A-Za-z0-9_]+$/.test(tab) ? tab : "'" + String(tab).split("'").join("''") + "'";
  return safe + '!' + ref;
}

function readRows(resp, laneKey) {
  if (!resp || typeof resp !== 'object') throw new Error('sync: no response at all from the ' + laneKey + ' settings read.');
  if (resp.error) throw new Error('sync: the ' + laneKey + ' settings read errored: ' + JSON.stringify(resp.error));
  var vr = resp.valueRanges;
  if (!Array.isArray(vr) || !vr.length) throw new Error('sync: the ' + laneKey + ' settings read returned no valueRanges. Nothing can be compared, so nothing is written.');
  return vr[0].values || [];
}

function parseTab(resp, laneKey) {
  var values = readRows(resp, laneKey);
  if (!values.length) {
    throw new Error('sync: the ' + laneKey + ' settings tab is EMPTY. A sync writes into an existing tab; it does not build one. Re-provision instead.');
  }
  var header = (values[0] || []).map(function (c) { return String(c === null || c === undefined ? '' : c).trim().toLowerCase(); });
  if (header[0] !== 'key' || header[1] !== 'value') {
    throw new Error(
      'sync: the ' + laneKey + ' settings tab header is ' + JSON.stringify(values[0]) +
      ', expected ["key","value"]. Every row address below row 1 is computed from that header being row 1, ' +
      'so a different header means every write would land one row out.'
    );
  }
  var rows = [];
  var byKey = {};
  var order = [];
  var dupes = [];
  var blanks = [];
  for (var i = 1; i < values.length; i++) {
    var raw = values[i] || [];
    // Trailing empties are trimmed by the API, so an absent second cell IS an empty value.
    var key = String(raw[0] === null || raw[0] === undefined ? '' : raw[0]).trim();
    var value = String(raw[1] === null || raw[1] === undefined ? '' : raw[1]);
    var rowNumber = i + 1;
    if (key === '') {
      // A fully blank row is tolerated and reported; a row with a value and no key is not, because
      // it is a cell somebody meant to name and did not, and appending past it would bury it.
      if (value !== '') blanks.push({ row: rowNumber, value: value });
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(byKey, key)) { dupes.push({ key: key, rows: [byKey[key].row, rowNumber] }); continue; }
    var rec = { key: key, value: value, row: rowNumber };
    rows.push(rec);
    byKey[key] = rec;
    order.push(key);
  }
  return { header: values[0], rows: rows, byKey: byKey, order: order, dupes: dupes, blanks: blanks, height: values.length };
}
`;

const GOOGLE_SHEETS_CREDENTIAL = {
  googleSheetsOAuth2Api: { id: 'UhK77WK48hRv85bo', name: 'Google Sheets account' },
};

module.exports = {
  loadSeed,
  loadLane,
  validateTargets,
  syncableSettings,
  encodeValue,
  RUNTIME_KEYS,
  KNOWN_OPTIONAL_KEYS,
  PARSE_TAB_LOGIC,
  SEP,
  SEED_FILE,
  LANE_FILES,
  GOOGLE_SHEETS_CREDENTIAL,
};

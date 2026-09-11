'use strict';
/*
 * 04-parse-settings.js - key/value rows in, ONE validated config object out.
 *
 * WHY THIS NODE IS NOT A ONE LINER, and it is the whole reason it exists.
 * The settings tab is hand editable by design: Shaheen opens the sheet on his phone, changes a
 * term, and the next run picks it up. The build time validator that checked those values lived in
 * the provisioner, it only ever saw config/seed.json, and the provisioner has been deleted. So
 * every check the encoder ran at WRITE time runs again here at READ time, against the cells as
 * they are now. A broken cell has to fail the run loudly. The alternative is a filter that quietly
 * mis-sorts every job, forever, while the run report stays green.
 *
 * THE DECODER IS THE ENCODER'S MIRROR, copied verbatim from nodes/provision/03-build-seed.js:
 *   list    String(v).split('|').map(s => s.trim()).filter(Boolean)
 *   switch  String(v).trim().toLowerCase() === 'on'
 *   number  Number(String(v).trim())
 *   text    String(v)
 * SCHEMA DRIVEN, NOT BLANKET: only keys the schema calls lists are split on '|'. `readme` is free
 * text and legitimately contains a pipe (it is the sentence that tells him the separator is a
 * pipe). A blanket split would shred it.
 *
 * HONEST NOTE ON THREE OF THE SIX CHECKS, because two of them cannot fire and saying so is better
 * than shipping them as though they can:
 *   - "no item contains the separator" is UNDETECTABLE after the split. Reading `a|b|c` you cannot
 *     tell whether it was ["a|b","c"] or ["a","b","c"]. What IS detectable, and is the same class
 *     of corruption, is broken separator structure in the RAW cell: a doubled "||", a leading or
 *     dangling "|", or a whitespace-only segment. That check runs on the raw string BEFORE the
 *     split and it is the one that earns its place, because the documented decoder is deliberately
 *     tolerant and would silently return a shorter list.
 *   - "no edge whitespace" cannot fire either, because the decoder trims, and trimming is a
 *     DESIGNED tolerance ("encode tight, decode tolerant": he can type `a | b | c` on a phone).
 *     Rejecting it would reject the exact hand edit the encoding was built to accept. The real
 *     failure in that family is an INVISIBLE character that survives trim, or sits mid string: a
 *     zero width space or a non breaking space pasted in from a web page, which looks identical in
 *     the cell and never matches anything. That is checked instead, and it is checked everywhere
 *     in the item, not only at the edges.
 *   - both of the undetectable checks are still written, as TRIPWIRES ON THE DECODER rather than
 *     on the data. They cannot fire while the decoder above trims and splits. If someone later
 *     simplifies the decoder, they turn that edit into a loud failure instead of a quietly
 *     different filter.
 *
 * Every problem is collected and reported in ONE throw, not the first one found. Shaheen gets a
 * list and one trip to the sheet, not five runs.
 *
 * The schema is baked in at build time from nodes/_lane.js, which reads the nine source switch
 * names straight off the shared contract, so a source renamed in sources.json loses its switch at
 * BUILD time instead of silently defaulting to on at run time.
 */

const { lane, settingsSchema } = require('./_lane');
const L = lane();
const SCHEMA = settingsSchema();

const LOGIC = `
// ---------------------------------------------------------------------------
// Characters that survive .trim(), or sit mid string, and make a term never
// match anything while looking perfectly correct in the cell.
// ---------------------------------------------------------------------------
var INVISIBLE = /[\\u0000-\\u001F\\u007F\\u00A0\\u00AD\\u200B-\\u200F\\u2028\\u2029\\u2060\\uFEFF]/;

var problems = [];
function bad(key, msg) { problems.push(key + ': ' + msg); }
function stop() {
  throw new Error(
    'Parse Settings: ' + problems.length + ' problem(s) in the ' + SETTINGS_TAB + ' tab of the ' +
    LANE_TITLE + ' spreadsheet.\\n  - ' + problems.join('\\n  - ') +
    '\\nThis tab is hand editable by design, so it is validated on every read. Fix the cell(s) and run again.'
  );
}

// --- 1. rows into a raw map ----------------------------------------------------------------
var rows = $input.all();
if (!rows.length) {
  throw new Error(
    'Parse Settings: the ' + SETTINGS_TAB + ' tab returned no rows. The tab is empty, the tab name ' +
    'changed, or the Google Sheets credential lost access. Nothing downstream can run on an empty ' +
    'config, so this fails rather than collecting with invented defaults.'
  );
}

var raw = {};
var seenKeys = {};
for (var i = 0; i < rows.length; i++) {
  var j = rows[i].json || {};
  var k = (j.key === undefined || j.key === null) ? '' : String(j.key).trim();
  var v = (j.value === undefined || j.value === null) ? '' : String(j.value);
  if (k === '') {
    if (v.trim() !== '') {
      bad('(input item ' + (i + 1) + ')', 'has a value but no key: ' + JSON.stringify(v.slice(0, 60)) +
        '. A value nobody can look up is a setting that silently does nothing.');
    }
    continue;
  }
  if (seenKeys[k]) {
    bad(k, 'appears on more than one row. The run reads whichever one comes last, so the other edit is invisible.');
  }
  seenKeys[k] = true;
  raw[k] = v;
}

// --- 2. every expected key present ----------------------------------------------------------
// Thrown separately and first: with a key missing, every later check on it is derivative noise.
var missing = [];
for (var a = 0; a < SCHEMA.keys.length; a++) {
  if (!Object.prototype.hasOwnProperty.call(raw, SCHEMA.keys[a])) missing.push(SCHEMA.keys[a]);
}
if (missing.length) {
  throw new Error(
    'Parse Settings: the ' + SETTINGS_TAB + ' tab is missing ' + missing.length + ' expected key(s): ' +
    missing.join(', ') + '.\\nA missing key is not a default, it is a row someone deleted or renamed. ' +
    'The full key set is ' + SCHEMA.keys.length + ' rows.'
  );
}

var unknown = [];
for (var key in raw) {
  if (Object.prototype.hasOwnProperty.call(raw, key) && SCHEMA.keys.indexOf(key) === -1) unknown.push(key);
}
// Unknown keys are REPORTED, never fatal. A mistyped key already failed above as a missing one,
// and he is allowed to keep a note row in his own sheet.

// --- 3. the decoders, each one the encoder's mirror -------------------------------------------
function decodeList(key) {
  var s = raw[key] === undefined ? '' : raw[key];

  // SEPARATOR INTEGRITY, on the RAW cell, BEFORE the split. After the split this is invisible:
  // the documented decoder drops empties on purpose, so a deleted term that left its separator
  // behind would quietly shorten the list and nothing would ever say so.
  if (s.trim() !== '') {
    var segs = s.split('|');
    if (segs.length > 1) {
      for (var n = 0; n < segs.length; n++) {
        if (segs[n].trim() === '') {
          bad(key, 'has an empty item at position ' + (n + 1) + ' of ' + segs.length +
            ' (a doubled "||", or a leading or dangling "|"). The decoder drops it, so the list is ' +
            'shorter than it looks in the cell.');
        }
      }
    }
  }

  // The documented decoder, verbatim.
  var items = s.split('|').map(function (x) { return x.trim(); }).filter(Boolean);

  var lower = SCHEMA.lowercase_lists.indexOf(key) !== -1;
  var seen = {};
  for (var m = 0; m < items.length; m++) {
    var it = items[m];
    if (INVISIBLE.test(it)) {
      bad(key, 'item ' + JSON.stringify(it) + ' contains an invisible character (control, zero width, ' +
        'soft hyphen or non breaking space). It looks right in the cell and will never match anything. ' +
        'Retype it rather than pasting it.');
    }
    // TRIPWIRES ON THE DECODER, not on the data. Neither can fire while the decoder above trims
    // and splits. They exist so a later "simplification" of the decoder fails loudly.
    if (it !== it.trim()) {
      bad(key, 'item ' + JSON.stringify(it) + ' still has edge whitespace after decoding, which means the decoder stopped trimming.');
    }
    if (it.indexOf('|') !== -1) {
      bad(key, 'item ' + JSON.stringify(it) + ' still contains the list separator after decoding, which means the decoder stopped splitting.');
    }
    if (lower && it !== it.toLowerCase()) {
      bad(key, 'item ' + JSON.stringify(it) + ' is not lowercase. This list is matched case insensitively, ' +
        'so an uppercase term is the same rule written twice and reads as two.');
    }
    var norm = it.toLowerCase();
    if (seen[norm]) {
      bad(key, 'has a duplicate item: ' + JSON.stringify(it) +
        '. A term listed twice does nothing twice, it just hides which copy someone meant to edit.');
    }
    seen[norm] = true;
  }
  if (SCHEMA.required_nonempty_lists.indexOf(key) !== -1 && items.length === 0) {
    bad(key, 'is empty. This list is a filter, and an empty filter does not mean everything, ' +
      'it means the run collects nothing and reports a healthy zero.');
  }
  return items;
}

function decodeSwitch(key) {
  var s = String(raw[key] === undefined ? '' : raw[key]).trim().toLowerCase();
  if (s !== 'on' && s !== 'off') {
    bad(key, 'is ' + JSON.stringify(raw[key]) + '. A switch is the literal text on or off. Anything ' +
      'else (true, yes, 1, TRUE, blank) decodes as OFF under the documented decoder, which turns a ' +
      'source off silently and reads as a quiet day.');
  }
  return s === 'on';
}

function decodeNumber(key, min) {
  var s = String(raw[key] === undefined ? '' : raw[key]).trim();
  if (s === '') { bad(key, 'is empty. A missing number is not a default.'); return NaN; }
  var v = Number(s);
  if (!isFinite(v)) { bad(key, 'is ' + JSON.stringify(raw[key]) + ', which is not a number.'); return NaN; }
  if (v < min) { bad(key, 'is ' + v + '. The lowest value this setting accepts is ' + min + '.'); }
  return v;
}

// --- 4. decode by type -------------------------------------------------------------------------
var cfg = {};
for (var li = 0; li < SCHEMA.list.length; li++) cfg[SCHEMA.list[li]] = decodeList(SCHEMA.list[li]);
for (var wi = 0; wi < SCHEMA.switch.length; wi++) cfg[SCHEMA.switch[wi]] = decodeSwitch(SCHEMA.switch[wi]);
for (var ni = 0; ni < SCHEMA.number.length; ni++) {
  // score_threshold may legitimately be 0 (mark everything). Every other number is a window, a cap
  // or a count and a zero would silently disable it.
  var nk = SCHEMA.number[ni];
  cfg[nk] = decodeNumber(nk, nk === 'score_threshold' ? 0 : 1);
}
for (var ti = 0; ti < SCHEMA.text.length; ti++) {
  cfg[SCHEMA.text[ti]] = String(raw[SCHEMA.text[ti]] === undefined ? '' : raw[SCHEMA.text[ti]]).trim();
}

// --- 5. cross field checks ---------------------------------------------------------------------

// (a) DEAD CONFIG. always_drop wins over keep_if_title_has every time, so a keep term that contains
// a drop term can never match. It is config that looks alive. Same check the encoder ran, so a term
// that could not be written also cannot be hand typed in.
for (var ki = 0; ki < cfg.keep_if_title_has.length; ki++) {
  for (var di = 0; di < cfg.always_drop.length; di++) {
    if (cfg.keep_if_title_has[ki].indexOf(cfg.always_drop[di]) !== -1) {
      bad('keep_if_title_has', 'term "' + cfg.keep_if_title_has[ki] + '" contains always_drop term "' +
        cfg.always_drop[di] + '" and can never match, because always_drop wins. One of the two is a mistake.');
    }
  }
}

// (b) A threshold outside its own scale means nothing.
var scale = /^\\s*(-?\\d+(?:\\.\\d+)?)\\s*-\\s*(-?\\d+(?:\\.\\d+)?)\\s*$/.exec(cfg.score_scale || '');
if (!scale) {
  bad('score_scale', 'is ' + JSON.stringify(cfg.score_scale) + '. Expected a range like 0-100, ' +
    'because score_threshold is meaningless without one.');
} else if (isFinite(cfg.score_threshold)) {
  var lo = Number(scale[1]);
  var hi = Number(scale[2]);
  if (cfg.score_threshold < lo || cfg.score_threshold > hi) {
    bad('score_threshold', 'is ' + cfg.score_threshold + ', outside the declared score_scale ' +
      cfg.score_scale + '. A threshold above the top of the scale marks nothing ever, and reads as a ' +
      'strict filter rather than a broken one.');
  }
}

// (c) THE LANE GUARD. The worst silent failure available here is reading the OTHER lane's
// spreadsheet: every key parses, every filter works, and the run collects the wrong profile into
// the wrong sheet forever. Nothing else in this node would notice.
if (cfg.lane !== LANE_NUMBER) {
  bad('lane', 'the settings tab says lane ' + JSON.stringify(cfg.lane) + ' and this workflow is lane ' +
    LANE_NUMBER + '. Either the wrong spreadsheet id is wired into Read Settings, or the cell was edited. ' +
    'Every other check in this node passes either way.');
}

// (d) last_run_at has to be a date the window logic can subtract, or empty for a first run.
if (cfg.last_run_at !== '') {
  if (!isFinite(Date.parse(cfg.last_run_at))) {
    bad('last_run_at', 'is ' + JSON.stringify(cfg.last_run_at) + ', which does not parse as a date. ' +
      'Leave it EMPTY for a first run. Do not write a word in it.');
  }
}

// (e) A floor wider than the first run window is a config that contradicts itself.
if (isFinite(cfg.min_window_hours) && isFinite(cfg.first_run_window_hours) &&
    cfg.min_window_hours > cfg.first_run_window_hours) {
  bad('min_window_hours', 'is ' + cfg.min_window_hours + 'h, wider than first_run_window_hours (' +
    cfg.first_run_window_hours + 'h). The first run would then cover less than every run after it, which is backwards.');
}

// --- 6. one verdict ------------------------------------------------------------------------------
if (problems.length) stop();

// --- 7. the config object ------------------------------------------------------------------------
function stripPrefix(k) { return k.slice('source_'.length); }
cfg._meta = {
  parsed_at: new Date().toISOString(),
  lane: LANE_NUMBER,
  settings_tab: SETTINGS_TAB,
  rows_read: rows.length,
  keys_expected: SCHEMA.keys.length,
  unknown_keys: unknown,
  sources_enabled: SCHEMA.source_switches.filter(function (k) { return cfg[k]; }).map(stripPrefix),
  sources_disabled: SCHEMA.source_switches.filter(function (k) { return !cfg[k]; }).map(stripPrefix),
  first_run: cfg.last_run_at === '',
};

return [{ json: cfg }];
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/04-parse-settings.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `var SCHEMA = ${JSON.stringify(SCHEMA)};`,
  `var LANE_NUMBER = ${JSON.stringify(String(L.lane))};`,
  `var LANE_TITLE = ${JSON.stringify(L.title)};`,
  `var SETTINGS_TAB = ${JSON.stringify(L.sheet.settings_tab)};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Parse Settings',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [520, 100],
  connectFrom: 'Read Settings',
  notes: 'Decodes the key/value rows into one config object and validates every cell. Throws with the full list of problems, never with defaults.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

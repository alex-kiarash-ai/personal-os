'use strict';
/*
 * _lane.js - the one place a #36 node file reads its lane facts from. BUILD TIME ONLY.
 *
 * Same split #34 and #35 use, and for the same reason: `nodes/` is TRACKED and the repo is PUBLIC,
 * `config/` is gitignored (.gitignore:98, work/*./config/). So spreadsheet ids, Drive folder ids and
 * credential ids live in config/lane.json and are BAKED IN at build time by build.js on this
 * machine. This file holds wiring and reasoning and carries no lane value as a literal.
 *
 * The leading underscore keeps it out of build.js's node glob (/^\d+-.+\.js$/).
 *
 * =============================================================================================
 * THE SHAPE DIFFERENCE FROM #34, STATED HERE BECAUSE IT IS THE MISTAKE THIS FILE PREVENTS.
 * =============================================================================================
 * #34 and #35 are two workflows built by one shared build.js from two lane files, ONE SHEET each,
 * so their lane.json carries a single `sheet` block and their _lane.js reads `l.sheet.tab`.
 * #36 is ONE workflow that reads BOTH spreadsheets, so its lane.json carries a `lanes` MAP with an
 * entry per source lane (bi, ai). Everything per source lane lives inside that map; everything per
 * workflow (cron, timezone, credentials, render) lives at the top, once. A reader who expects the
 * #34 shape here will reach for `sheet` and find nothing.
 *
 * =============================================================================================
 * WHAT IS READ RATHER THAN RESTATED, and why each one is read.
 * =============================================================================================
 *   work/34-job-search-bi/nodes/_output.js    a1() and batchGetUrl(). The A1 quoting rule and the
 *     batchGet url shape are platform facts that #34 already owns and proves on live runs. A second
 *     copy is how one lane quotes a tab name and the other does not.
 *   work/34-job-search-bi/nodes/_scoring.js   ANTHROPIC_URL, ANTHROPIC_VERSION, WORK_MODES and the
 *     exact SWEDISH_FLAG string. #36 blocks a pair on Swedish fluency (D10) and the string it
 *     matches must be the same string #34 asks its model to emit.
 *   work/34-job-search-bi/nodes/20-filter.js  GEO_TARGETS and GEO_PRECEDENCE, lifted out of that
 *     node's GENERATED jsCode. This is the scope table the collectors already decide with. See the
 *     long note on collectorScopes() below: it is the closest thing to reading the collector's own
 *     decision that the sheet actually allows.
 *   work/34-job-search-bi/config/sources.json the shared source contract, READ ONLY. #36 never
 *     collects and must never edit it. It is where the LinkedIn guest-detail endpoint template and
 *     the fifteen-column row shape live.
 *   work/36-job-application-writer/nodes/_master.js  seat 2's block library, for the lane key check
 *     only. #36 lane keys are bi and ai; the master library keys are powerbi and ai. The mapping is
 *     asserted here so a renamed master lane fails THIS build rather than the assembler seat.
 *
 * =============================================================================================
 * THE CAP BLOCK, AND WHY A MISSPELT CAP IS REFUSED RATHER THAN IGNORED.
 * =============================================================================================
 * #34's _lane.js refuses an unknown key inside lane.json `paging`, with the reason written next to
 * it: a cap that is silently dropped reads as a cap that was set. The same instinct applies harder
 * here, because these caps bound MONEY and an unattended run. `phase2_daily_cap` typed as
 * `phase_2_daily_cap` in lane.json would leave the shipped default of 10 in force while the file
 * says something else, and nothing at run time would report the disagreement.
 *
 * The DEFAULTS live here, in the tracked file, and not in lane.json, for the two reasons #34 gives:
 * the numbers are not personal data and belong where anyone can read them, and a default that needs
 * a hand edit before it applies is not a default. lane.json may override per workflow; the settings
 * tab overrides that at RUN time, inside the clamps, because only the sheet knows what is in the
 * sheet.
 */

const fs = require('fs');
const path = require('path');

const LANE_DIR = path.resolve(__dirname, '..');
const REPO = path.resolve(__dirname, '..', '..', '..');
const LANE_FILE = path.join(LANE_DIR, 'config', 'lane.json');

const BI_NODES = path.join(REPO, 'work', '34-job-search-bi', 'nodes');
const FILTER_NODE_FILE = path.join(BI_NODES, '20-filter.js');
const OUTPUT_HELPER_FILE = path.join(BI_NODES, '_output.js');
const SCORING_HELPER_FILE = path.join(BI_NODES, '_scoring.js');
const MASTER_FILE = path.join(__dirname, '_master.js');

function rel(p) { return path.relative(REPO, p).replace(/\\/g, '/'); }

function readJson(file, what) {
  if (!fs.existsSync(file)) {
    throw new Error(
      '#36 node files: ' + what + ' is missing at ' + rel(file) + '.\n' +
      '  config/ is gitignored on purpose, so a fresh clone will not have it and cannot build these\n' +
      '  nodes. Restore it from the nightly encrypted vault backup.'
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------------------------------------
// THE LANE FILE.
// ---------------------------------------------------------------------------------------------
const TOP_REQUIRED = [
  'lane', 'name', 'title', 'work_dir', 'workflow_name', 'cron', 'timezone', 'error_workflow',
  'score_threshold', 'credentials', 'render', 'lanes', 'sources_contract',
];

// Every key a `lanes.<k>` entry may carry. An UNKNOWN key here is refused by name, the same way
// #34 refuses an unknown paging cap: a misspelt `drive_parent_folder` would leave the real key
// absent, the assert below would name the missing one, and the typo would sit in the file looking
// like it had been set. Notes are allowed through by suffix so the file can stay self-explaining.
const LANE_ENTRY_KEYS = [
  'source_project', 'source_lane_name', 'label', 'spreadsheet_id', 'spreadsheet_url',
  'jobs_tab', 'applications_tab', 'settings_tab', 'writer_runs_tab',
  'drive_parent_folder_id', 'cv_master', 'cv_mirror', 'cv_master_kind', 'cv_master_frozen',
];
const LANE_ENTRY_REQUIRED = [
  'source_project', 'source_lane_name', 'label', 'spreadsheet_id',
  'jobs_tab', 'applications_tab', 'settings_tab', 'writer_runs_tab',
  'drive_parent_folder_id', 'cv_master', 'cv_master_kind', 'cv_master_frozen',
];
// lane.json key -> the key the master block library (seat 2) files that master under.
const MASTER_KEY_OF = { bi: 'powerbi', ai: 'ai' };

let _laneCache = null;
function lane() {
  if (_laneCache) return _laneCache;
  const l = readJson(LANE_FILE, 'this project config/lane.json');
  for (const k of TOP_REQUIRED) {
    if (l[k] === undefined || l[k] === null) {
      throw new Error('#36 node files: lane.json is missing required key ' + JSON.stringify(k) + '.');
    }
  }
  if (!l.lanes || typeof l.lanes !== 'object' || Array.isArray(l.lanes)) {
    throw new Error(
      '#36 node files: lane.json `lanes` is not an object. This workflow reads TWO spreadsheets, so\n' +
      '  its lane file carries a lanes map (bi, ai) rather than the single `sheet` block #34 uses.\n' +
      '  Reading this file expecting the #34 shape is the mistake the _shape_note in it warns about.'
    );
  }
  _laneCache = l;
  return l;
}

// ---------------------------------------------------------------------------------------------
// THE TWO SOURCE LANES, fully validated. Returns an ARRAY in a stable order (bi then ai), because
// the seed node emits one item per entry and the read-back pairs responses to lanes BY POSITION.
// An order that came out of Object.keys iteration would be stable in practice and undeclared in
// principle, and the pairing is exactly the place where that distinction stops being academic.
// ---------------------------------------------------------------------------------------------
const LANE_ORDER = ['bi', 'ai'];

function lanes() {
  const L = lane();
  const keys = Object.keys(L.lanes);
  const unknown = keys.filter((k) => LANE_ORDER.indexOf(k) === -1);
  if (unknown.length) {
    throw new Error(
      '#36 node files: lane.json lanes carries ' + JSON.stringify(unknown) + '.\n' +
      '  The known source lanes are ' + JSON.stringify(LANE_ORDER) + ', the same two keys\n' +
      '  work/34-job-search-bi/config/seed.json uses, deliberately. A third lane is a real change:\n' +
      '  it needs a master key in MASTER_KEY_OF, a Drive folder, and a settings lane-guard value.'
    );
  }
  const missing = LANE_ORDER.filter((k) => keys.indexOf(k) === -1);
  if (missing.length) {
    throw new Error('#36 node files: lane.json lanes has no entry for ' + JSON.stringify(missing) + '. Both collectors feed this workflow.');
  }

  const masterLanes = require(MASTER_FILE).LANES;

  return LANE_ORDER.map((key) => {
    const e = L.lanes[key];
    const where = 'lane.json lanes.' + key;
    for (const k of Object.keys(e)) {
      if (LANE_ENTRY_KEYS.indexOf(k) !== -1) continue;
      if (k.charAt(0) === '_' || /_note$/.test(k)) continue;   // documentation, allowed through
      throw new Error(
        '#36 node files: ' + where + ' has an unknown key ' + JSON.stringify(k) + '.\n' +
        '  Known keys: ' + LANE_ENTRY_KEYS.join(', ') + '.\n' +
        '  Refused rather than ignored: a misspelt key leaves the real one absent while the file reads\n' +
        '  as if it had been set, which is the failure #34 records against its paging caps.'
      );
    }
    for (const k of LANE_ENTRY_REQUIRED) {
      const v = e[k];
      const empty = v === undefined || v === null || (typeof v === 'string' && !v.trim());
      if (empty && k !== 'cv_master_frozen') {
        throw new Error(
          '#36 node files: ' + where + '.' + k + ' is empty. Every id in this file was read from the\n' +
          '  LIVE Google and n8n surfaces on 2026-09-14 and written back. An empty value means the lane\n' +
          '  file was reverted or restored from before that. Do not guess an id.'
        );
      }
    }
    if (typeof e.cv_master_frozen !== 'boolean') {
      throw new Error('#36 node files: ' + where + '.cv_master_frozen is ' + JSON.stringify(e.cv_master_frozen) + '. It decides whether the AI-lane freeze applies, so it is a real boolean or it is nothing.');
    }
    if (!Number.isInteger(e.source_project)) {
      throw new Error('#36 node files: ' + where + '.source_project is ' + JSON.stringify(e.source_project) + '. It is the collector project NUMBER and it is the value the settings lane guard compares against.');
    }
    const masterKey = MASTER_KEY_OF[key];
    if (!masterLanes || !masterLanes[masterKey]) {
      throw new Error(
        '#36 node files: the master block library has no lane called ' + JSON.stringify(masterKey) + '.\n' +
        '  nodes/_master.js knows: ' + Object.keys(masterLanes || {}).join(', ') + '.\n' +
        '  The lane keys differ on purpose (the sheet side says bi, the CV side says powerbi) and the\n' +
        '  mapping lives in MASTER_KEY_OF in this file. A renamed master lane fails here rather than in\n' +
        '  the assembler, where the symptom would be an id that does not resolve.'
      );
    }
    return {
      key,
      source_project: e.source_project,
      source_lane_name: e.source_lane_name,
      label: e.label,
      spreadsheet_id: e.spreadsheet_id,
      jobs_tab: e.jobs_tab,
      applications_tab: e.applications_tab,
      settings_tab: e.settings_tab,
      writer_runs_tab: e.writer_runs_tab,
      drive_parent_folder_id: e.drive_parent_folder_id,
      master_key: masterKey,
      cv_master_frozen: e.cv_master_frozen,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// THE CAPS. Three levels, highest wins: the settings tab (at run time), then lane.json `caps`,
// then the defaults below. See the header for why the defaults live here.
//
// WHAT EACH NUMBER IS PROTECTING.
//   hard_max_pairs            D11, the clamp a hand edited settings cell cannot get past. Ten pairs
//                             is Shaheen's own number and ten pairs is five model calls each.
//   daily_cap                 the shipped default, clamped to hard_max_pairs. It is a DAY cap and
//                             not a run cap, which is why Build Candidates reads today's attempted
//                             count out of writer_runs before it admits anything: two runs in one
//                             morning must not write twenty applications.
//   intake_overshoot          design defect 6 from the plan review. A cap consumed by BLOCKED pairs
//                             under delivers, so intake admits cap + 2 into the cheap reader stage
//                             and the real cap gate runs AFTER the D10 verdicts. Two is deliberately
//                             small: every overshoot pair that survives costs one opus-5 read and
//                             then loses the cap gate, so the overshoot is paid for whether or not
//                             it is needed.
//   max_cost_per_run_usd      the default spend ceiling, clamped by hard_max_cost_per_run_usd. The
//                             guard is PESSIMISTIC by construction: it prices every call in the
//                             chain at full input price with no cache credit, so the estimate is
//                             always above the bill and the guard can only ever refuse too early.
//   min_score                 D3, his own words: score more than 69. 70 is both the default and the
//                             FLOOR, so a settings edit can raise the bar and cannot lower it.
//   ad_text_max_chars         what one job ad is allowed to contribute to a prompt.
//   ad_min_useful_chars       under this, the fetch is treated as a failed fetch rather than as a
//                             short ad, and the row's own excerpt is used instead.
//   read_max_tokens           the reader call ceiling. See the note in 10-build-read-request.js:
//                             on claude-opus-5 an omitted `thinking` means thinking is ON, and it
//                             shares this budget with the text.
// ---------------------------------------------------------------------------------------------
const CAP_DEFAULTS = {
  hard_max_pairs: 10,
  daily_cap: 10,
  intake_overshoot: 2,
  max_cost_per_run_usd: 4.00,
  hard_max_cost_per_run_usd: 6.00,
  min_score: 70,
  ad_text_max_chars: 12000,
  ad_min_useful_chars: 400,
  read_max_tokens: 2048,
};
const CAP_IS_INTEGER = {
  hard_max_pairs: true, daily_cap: true, intake_overshoot: true, min_score: true,
  ad_text_max_chars: true, ad_min_useful_chars: true, read_max_tokens: true,
  max_cost_per_run_usd: false, hard_max_cost_per_run_usd: false,
};

function caps() {
  const L = lane();
  const over = (L.caps && typeof L.caps === 'object' && !Array.isArray(L.caps)) ? L.caps : {};
  for (const k of Object.keys(over)) {
    if (!Object.prototype.hasOwnProperty.call(CAP_DEFAULTS, k)) {
      throw new Error(
        '#36 node files: lane.json caps has an unknown key ' + JSON.stringify(k) + '.\n' +
        '  Known caps: ' + Object.keys(CAP_DEFAULTS).join(', ') + '.\n' +
        '  Refused rather than ignored, the same call #34 makes about its paging caps: a misspelt cap\n' +
        '  that is silently dropped reads as a cap that was set, and these two bound money and an\n' +
        '  unattended run.'
      );
    }
    const v = over[k];
    if (CAP_IS_INTEGER[k]) {
      if (!Number.isInteger(v) || v < 0) {
        throw new Error('#36 node files: lane.json caps.' + k + ' is ' + JSON.stringify(v) + '. It is a whole number, zero or above.');
      }
    } else if (typeof v !== 'number' || !isFinite(v) || v <= 0) {
      throw new Error('#36 node files: lane.json caps.' + k + ' is ' + JSON.stringify(v) + '. It is a positive number of US dollars.');
    }
  }
  const values = {};
  const from = {};
  for (const k of Object.keys(CAP_DEFAULTS)) {
    const has = Object.prototype.hasOwnProperty.call(over, k);
    values[k] = has ? over[k] : CAP_DEFAULTS[k];
    from[k] = has ? 'lane.json' : 'node default';
  }
  if (values.daily_cap > values.hard_max_pairs) {
    throw new Error(
      '#36 node files: caps.daily_cap is ' + values.daily_cap + ' and caps.hard_max_pairs is ' + values.hard_max_pairs + '.\n' +
      '  The clamp exists so a settings edit cannot raise the day cap past D11. A lane file that sets\n' +
      '  the default above the clamp is asking for the clamp to bite on every single run, which is a\n' +
      '  number that looks configured and never applies.'
    );
  }
  if (values.max_cost_per_run_usd > values.hard_max_cost_per_run_usd) {
    throw new Error('#36 node files: caps.max_cost_per_run_usd (' + values.max_cost_per_run_usd + ') is above caps.hard_max_cost_per_run_usd (' + values.hard_max_cost_per_run_usd + ').');
  }
  if (values.min_score < CAP_DEFAULTS.min_score) {
    throw new Error(
      '#36 node files: caps.min_score is ' + values.min_score + ' and the FLOOR is ' + CAP_DEFAULTS.min_score + '.\n' +
      '  D3 is his own instruction that a job scoring more than 69 gets a CV written with no\n' +
      '  confirmation step. Lowering the bar here would widen an unattended writer, which is a decision\n' +
      '  for him and not for a config file.'
    );
  }
  return { values, from, keys: Object.keys(CAP_DEFAULTS) };
}

// ---------------------------------------------------------------------------------------------
// MODEL PRICES. Read out of the claude-api skill model table on 2026-09-15, not remembered.
//   claude-opus-5     $5.00 in / $25.00 out per MTok, minimum cacheable prefix 512 tokens
//   claude-sonnet-5   $2.00 in / $10.00 out per MTok, minimum cacheable prefix 1024 tokens
//   claude-sonnet-4-6 $3.00 in / $15.00 out per MTok, minimum cacheable prefix 1024 tokens
// Cache write 1.25x base input on the 5 minute TTL, cache read 0.1x base input.
//
// The minimum matters and it is not decoration: BELOW IT THE CACHE SILENTLY DOES NOTHING. No error,
// just cache_creation_input_tokens 0 and a system block paid for in full on every single call.
// 10-build-read-request.js asserts its system block clears the minimum for the model it pins.
//
// The overlap with #34 is CROSS CHECKED rather than copied: sonnet-4-6 appears in both tables and
// assertPricesAgreeWithCollector() below fails the build if the two ever disagree.
// ---------------------------------------------------------------------------------------------
const PRICES = {
  'claude-opus-5': { in_per_mtok: 5.00, out_per_mtok: 25.00, cache_write_mult: 1.25, cache_read_mult: 0.10 },
  'claude-sonnet-5': { in_per_mtok: 2.00, out_per_mtok: 10.00, cache_write_mult: 1.25, cache_read_mult: 0.10 },
  'claude-sonnet-4-6': { in_per_mtok: 3.00, out_per_mtok: 15.00, cache_write_mult: 1.25, cache_read_mult: 0.10 },
};
const MIN_CACHEABLE_TOKENS = {
  'claude-opus-5': 512,
  'claude-sonnet-5': 1024,
  'claude-sonnet-4-6': 1024,
};
// The model each stage pins. Declared here so the cost model and the nodes cannot disagree about
// which model a stage runs. The ENFORCED contract is system/manifest.json meta.model_routing and
// V6 asserts the live workflow against it; this is the build-time copy the estimate is priced on,
// and assertModelRoutingAgrees() below checks it against the manifest when the row exists.
const STAGE_MODELS = {
  read: 'claude-opus-5',
  research: 'claude-sonnet-4-6',
  select: 'claude-opus-5',
  write: 'claude-sonnet-5',
  rewrite: 'claude-sonnet-5',
  grade: 'claude-sonnet-4-6',
};

function prices(model) {
  const p = PRICES[model];
  if (!p) {
    throw new Error(
      '#36 node files: no price recorded for model ' + JSON.stringify(model) + '.\n' +
      '  Known: ' + Object.keys(PRICES).join(', ') + '. Add it from the claude-api model table, never\n' +
      '  from memory: a wrong price makes the run report and the cost guard fiction rather than data.'
    );
  }
  return p;
}

function assertPricesAgreeWithCollector() {
  const theirs = require(SCORING_HELPER_FILE).PRICES;
  const theirMin = require(SCORING_HELPER_FILE).MIN_CACHEABLE_TOKENS;
  for (const model of Object.keys(theirs)) {
    if (!PRICES[model]) continue;
    for (const f of ['in_per_mtok', 'out_per_mtok', 'cache_write_mult', 'cache_read_mult']) {
      if (Number(theirs[model][f]) !== Number(PRICES[model][f])) {
        throw new Error(
          '#36 node files: ' + rel(SCORING_HELPER_FILE) + ' prices ' + model + ' ' + f + ' at ' +
          JSON.stringify(theirs[model][f]) + ' and this file says ' + JSON.stringify(PRICES[model][f]) + '.\n' +
          '  Two price tables in one repo is how a cost report and a cost guard come apart. Fix both in\n' +
          '  the same edit, from the claude-api model table.'
        );
      }
    }
    if (theirMin[model] !== undefined && Number(theirMin[model]) !== Number(MIN_CACHEABLE_TOKENS[model])) {
      throw new Error('#36 node files: the two lanes disagree about the minimum cacheable prefix for ' + model + '.');
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// CREDENTIALS, by id, reused and never recreated. The name field is cosmetic: n8n resolves by id.
// ---------------------------------------------------------------------------------------------
function credentialId(key, why) {
  const c = lane().credentials || {};
  const id = c[key];
  if (!id || typeof id !== 'string') {
    throw new Error(
      '#36 node files: lane.json credentials.' + key + ' is ' + JSON.stringify(id) + '.\n' +
      '  ' + why + '\n' +
      '  Refused rather than defaulted: n8n renders a permanently disabled credential picker for a\n' +
      '  missing id and the node 401s on every call. Do not paste an id into a tracked file.'
    );
  }
  return id;
}
function googleSheetsCredential() {
  return { googleSheetsOAuth2Api: { id: credentialId('google_sheets', 'It is the Google Sheets OAuth credential both collectors already use.'), name: 'Google Sheets account' } };
}
function googleDriveCredential() {
  return { googleDriveOAuth2Api: { id: credentialId('google_drive', 'It is the Google Drive OAuth credential the upload seat writes the job folders with.'), name: 'Google Drive account' } };
}
function anthropicCredential() {
  return {
    anthropicApi: {
      id: credentialId('anthropic',
        'Shaheen has NOT chosen a credential for this workflow; the lane file carries a PROVISIONAL\n' +
        '  fallback and human-action anthropic-credential-36-writer is still open. Whatever he picks,\n' +
        '  the id goes in lane.json and nowhere else.'),
      name: 'Anthropic account',
    },
  };
}

// ---------------------------------------------------------------------------------------------
// THE SHARED SOURCE CONTRACT, read only.
// ---------------------------------------------------------------------------------------------
function sourcesContract() {
  const L = lane();
  const file = path.resolve(REPO, L.sources_contract);
  const s = readJson(file, 'the shared source contract (sources.json)');
  if (!s.sources || !s.sources.linkedin_guest_detail) {
    throw new Error('#36 node files: the source contract has no linkedin_guest_detail entry, and the ad fetch builds every LinkedIn url from its endpoint template.');
  }
  // TWELVE since the evening of 2026-09-17. Fifteen that morning, eleven that afternoon when
  // Shaheen removed apply_url, fit_reasons, lane and excerpt, then twelve when he took one narrow
  // column back: `flags`, the red_flags alone, appended AFTER status. This workflow reads the tab BY
  // POSITION, so the number is not cosmetic here: a stale expectation would map fit_score onto a
  // neighbouring cell and score every candidate off the wrong value.
  if (!Array.isArray(s.shared_row_shape) || s.shared_row_shape.length !== 12) {
    throw new Error(
      '#36 node files: shared_row_shape is ' + (s.shared_row_shape || []).length + ' fields, not 12.\n' +
      '  The jobs tab header IS that list in that order, and Build Candidates asserts the live header\n' +
      '  against it before it reads a single cell. If the shape genuinely moved, both collectors, both\n' +
      '  sheet headers and this workflow move in the same session.'
    );
  }
  // THE ONE THING THIS WORKFLOW CANNOT ABSORB QUIETLY. `status` is the cell node 66 writes by A1
  // ADDRESS to take a job out of tomorrow's queue, and `flags` was appended rather than inserted
  // precisely so that letter did not move. If a future edit puts a column before status, this
  // refuses here rather than letting an addressed write land on the wrong column.
  if (s.shared_row_shape.indexOf('status') !== 10) {
    throw new Error(
      '#36 node files: `status` is at index ' + s.shared_row_shape.indexOf('status') + ' in the row shape, not 10 (column K).\n' +
      '  Node 66 writes an ADDRESSED CELL at that letter. Move jobsStatusColumn and the node 03 range\n' +
      '  in the same edit, or put the new column at the END the way `flags` was.'
    );
  }
  // The three fields this workflow still READS off a row that are no longer columns are declared in
  // the contract, not assumed. apply_url feeds the research host (node 15) and falls back to the
  // posting url; excerpt was the ad fallback when a live fetch is refused (node 09) and is now
  // always empty, which turns a refused fetch into a HELD pair rather than a thin one.
  const internal36 = Object.keys(s.internal_only_fields || {}).filter(function (k) { return k[0] !== '_'; });
  for (const f of ['apply_url', 'excerpt']) {
    if (internal36.indexOf(f) === -1 && s.shared_row_shape.indexOf(f) === -1) {
      throw new Error(
        '#36 node files: the contract carries no ' + f + ' field, as a column or as internal.\n' +
        '  This workflow reads it off the row it builds from the sheet, so a field that exists nowhere\n' +
        '  means node 05 is reading a key that can never be populated by anything.'
      );
    }
  }
  return s;
}

function linkedinDetailTemplate() {
  const d = sourcesContract().sources.linkedin_guest_detail;
  if (d.method !== 'GET') {
    throw new Error('#36 node files: the contract says linkedin_guest_detail is a ' + d.method + ' and the ad fetch sends a GET.');
  }
  if (typeof d.endpoint !== 'string' || d.endpoint.indexOf('{job_id}') === -1) {
    throw new Error('#36 node files: the linkedin_guest_detail endpoint template does not carry a {job_id} placeholder, so no per job url can be built from it: ' + JSON.stringify(d.endpoint));
  }
  return d.endpoint;
}

// ---------------------------------------------------------------------------------------------
// THE COLLECTOR SCOPE TABLE, and the honest account of what it is standing in for.
//
// The D10 amendment says to branch on `_filter.scope` and `_filter.work_type_rule`, the fields the
// collector stamps, rather than re-deriving geography from a location string, because two
// components deriving the same fact from the same text is how they drift. That is exactly right and
// IT IS NOT AVAILABLE HERE, for a mechanical reason worth stating rather than working around
// quietly: `_filter` is an in-memory field inside the collector workflow, and the jobs TAB carries
// eleven columns, none of which is scope or work_type_rule. By the time a row reaches this
// workflow the collector's decision has been dropped on the floor.
//
// So this is the nearest honest thing. The scope TABLE is read out of 20-filter.js's own generated
// code, so there is still exactly ONE place the token lists and the precedence order live, and a
// scope added, renamed or re-ruled in the collector changes this workflow in the same edit. What is
// duplicated is only the MATCHER, and Build Candidates says so on every run: a recovered scope is
// stamped scope_source recovered_from_location, never presented as the collector's own verdict.
//
// The real fix is a twelfth column, and it is written down in the report for seat 7 rather than
// attempted from here: growing shared_row_shape moves both collectors, both sheet headers and every
// guard that asserts eleven, and that is a change with a human step in the middle. Worth knowing
// before proposing it: the 2026-09-17 trim went the OTHER way, fifteen columns down to eleven, on
// the grounds that the tab had become unreadable. A new column has to earn its place against that.
// ---------------------------------------------------------------------------------------------
function readBakedConst(nodeFile, name, opener) {
  const def = require(nodeFile);
  const src = (def.parameters && def.parameters.jsCode) || '';
  const closer = opener === '{' ? '}' : ']';
  const marker = 'const ' + name + ' = ' + opener;
  const at = src.indexOf(marker);
  if (at === -1) {
    throw new Error(
      '#36 node files: could not find `const ' + name + ' = ' + opener + '` in the generated code of ' + rel(nodeFile) + '.\n' +
      '  It is READ rather than restated so #36 and the collectors can never hold two different copies\n' +
      '  of it. If that node stopped baking it, decide where the table lives now and change both ends\n' +
      '  in the same edit. Do not paste a copy in here to make this pass.'
    );
  }
  const start = at + marker.length - 1;
  const end = src.indexOf(closer + ';', start);
  if (end === -1) throw new Error('#36 node files: `' + name + '` in ' + rel(nodeFile) + ' is not terminated by ' + closer + ';');
  const json = src.slice(start, end + 1);
  try {
    return JSON.parse(json);
  } catch (e) {
    throw new Error('#36 node files: `' + name + '` in ' + rel(nodeFile) + ' did not parse as JSON (' + e.message + '). It is baked with JSON.stringify, so a parse failure means the bake changed shape.');
  }
}

function collectorScopes() {
  const targets = readBakedConst(FILTER_NODE_FILE, 'GEO_TARGETS', '{');
  const precedence = readBakedConst(FILTER_NODE_FILE, 'GEO_PRECEDENCE', '[');

  const tKeys = Object.keys(targets).slice().sort();
  const pKeys = precedence.slice().sort();
  if (tKeys.length !== pKeys.length || tKeys.some((v, i) => v !== pKeys[i])) {
    throw new Error(
      '#36 node files: the collector GEO_TARGETS and GEO_PRECEDENCE do not cover the same scopes.\n' +
      '  targets:    ' + tKeys.join(', ') + '\n' +
      '  precedence: ' + pKeys.join(', ') + '\n' +
      '  A scope absent from the precedence list is never evaluated, so a row in it would resolve to no\n' +
      '  scope here and be judged under no work type rule at all.'
    );
  }
  for (const k of precedence) {
    const t = targets[k];
    if (!t || (t.work_types !== 'any' && t.work_types !== 'remote_only')) {
      throw new Error(
        '#36 node files: collector scope ' + JSON.stringify(k) + ' declares work_types ' + JSON.stringify(t && t.work_types) + '.\n' +
        '  The amended D10 switches on exactly those two words. A scope with anything else would fall\n' +
        '  through to "not remote only" and silently accept an onsite job he cannot take.'
      );
    }
    if (!Array.isArray(t.tokens) || !t.tokens.length) {
      throw new Error('#36 node files: collector scope ' + JSON.stringify(k) + ' carries no geography tokens, so nothing can ever resolve to it.');
    }
  }
  const remoteOnly = precedence.filter((k) => targets[k].work_types === 'remote_only');
  if (!remoteOnly.length) {
    throw new Error(
      '#36 node files: not one collector scope is remote_only any more.\n' +
      '  The amended D10 blocks a pair for work type ONLY inside a remote-only scope, so with none left\n' +
      '  the work type block can never fire. That may be correct, and it is not something this build\n' +
      '  should assume: state it deliberately in the collector and here in the same edit.'
    );
  }
  return {
    targets: precedence.reduce((acc, k) => { acc[k] = { work_types: targets[k].work_types, tokens: targets[k].tokens }; return acc; }, {}),
    precedence,
    remote_only: remoteOnly,
    read_from: rel(FILTER_NODE_FILE),
  };
}

// ---------------------------------------------------------------------------------------------
// SHEET COLUMN CONTRACTS.
//
// jobs and applications are read from the provisioning seed when it is on disk and from the frozen
// contract otherwise, the same CROSS CHECK pattern #34 uses: a spent provisioning artifact is a
// check, never a dependency.
//
// writer_runs is DIFFERENT and the difference is stated because it will be read as an oversight
// otherwise. That tab does not exist in either spreadsheet yet, so there is nothing to cross check
// against. These twelve columns are DECLARED here, by this seat, because Build Candidates has to
// read today's attempted count out of the tab before the tab has ever been written, and a daily cap
// that cannot be counted is a daily cap that resets on every re-run. The write seat honours this
// list or changes it here, in one place.
//
// ONE ROW PER LANE PER RUN, never one per pair, per the write-back design. `attempted` is what
// makes the cap true across re-runs, so it counts PAIRS ADMITTED TO THE READER, not pairs shipped:
// a pair that was read, cost money and then failed a gate has still been attempted, and a cap that
// forgave it would let a bad morning spend the day cap twice.
// ---------------------------------------------------------------------------------------------
const WRITER_RUNS_COLUMNS = [
  'date', 'run_started_at', 'exec_id', 'lane',
  'attempted', 'shipped', 'held', 'blocked', 'skipped_cap', 'errors',
  'cost_usd', 'note',
];

function jobsColumns() { return sourcesContract().shared_row_shape.slice(); }

// NINE since 2026-09-17, down from thirteen. Shaheen removed lane, last_contact_at, outcome and
// notes on the same instruction that trimmed the jobs tab: the output did not add value. Three of
// the four were always written EMPTY by this workflow and were his own to fill by hand
// (last_contact_at, outcome) or redundant (lane: each lane has its own spreadsheet).
//
// `notes` was NOT empty and its loss is the real one, so it is recorded here rather than discovered
// later: it carried the HELD reason and, for a held pair, the full cover letter text, which is what
// made a needs_review row readable on a phone without opening anything. What survives is the status
// token itself (needs_review, so the refusal is still visible), the per-run writer_runs note, and
// the execution. What is gone is the per-application WHY.
const APPLICATIONS_COLUMNS = [
  'job_id', 'applied_at', 'company', 'title', 'url', 'channel',
  'cv_ref', 'cover_letter_ref', 'status',
];

function assertColumnsAgainstSeed() {
  const seedFile = path.join(REPO, 'work', '34-job-search-bi', 'config', 'seed.json');
  if (!fs.existsSync(seedFile)) return { checked: false, why: 'the provisioning seed has been archived, which is expected; the frozen contract is the remaining source' };
  const seed = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
  const tabs = seed.tabs || {};
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  if (tabs.applications && !same(tabs.applications, APPLICATIONS_COLUMNS)) {
    throw new Error(
      '#36 node files: APPLICATIONS_COLUMNS disagrees with the seed that provisioned the tab.\n' +
      '  declared: ' + JSON.stringify(APPLICATIONS_COLUMNS) + '\n' +
      '  seeded:   ' + JSON.stringify(tabs.applications) + '\n' +
      '  Build Candidates asserts the LIVE header against the declared list before it reads a cell, so\n' +
      '  a disagreement here would fail every run against a sheet that is perfectly correct.'
    );
  }
  if (tabs.jobs && !same(tabs.jobs, jobsColumns())) {
    throw new Error('#36 node files: the seeded jobs header and the contract shared_row_shape disagree. Both collectors write by position, so this is a real defect on their side.');
  }
  if (tabs.writer_runs) {
    if (!same(tabs.writer_runs, WRITER_RUNS_COLUMNS)) {
      throw new Error(
        '#36 node files: the seed now carries a writer_runs header and it disagrees with WRITER_RUNS_COLUMNS.\n' +
        '  seeded:   ' + JSON.stringify(tabs.writer_runs) + '\n' +
        '  declared: ' + JSON.stringify(WRITER_RUNS_COLUMNS) + '\n' +
        '  The tab did not exist when this list was declared. Whoever created it wins; update this list.'
      );
    }
  }
  return { checked: true };
}

// ---------------------------------------------------------------------------------------------
// MODEL ROUTING, cross checked against the ENFORCED contract when the registry row exists.
// system/manifest.json meta.model_routing is what V6 asserts the live workflow against. This file
// never becomes a second source: it checks, and it says so when there is nothing yet to check.
// ---------------------------------------------------------------------------------------------
function assertModelRoutingAgrees() {
  const manifestFile = path.join(REPO, 'system', 'manifest.json');
  if (!fs.existsSync(manifestFile)) return { checked: false, why: 'system/manifest.json is missing' };
  const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const L = lane();
  const row = (m.projects || []).find((p) => Number(p.num) === Number(L.lane));
  if (!row) return { checked: false, why: 'the registry has no row for #' + L.lane + ' yet' };
  const routing = (m.meta && m.meta.model_routing) || null;
  if (!routing) return { checked: false, why: 'the manifest carries no meta.model_routing' };
  if (!row.n8n) return { checked: false, why: 'the registry row for #' + L.lane + ' has a null n8n id, so the per workflow override cannot be keyed yet' };
  const over = (routing.overrides || []).find((o) => o.workflow === row.n8n || o.id === row.n8n);
  if (!over) return { checked: false, why: 'no meta.model_routing override is declared for workflow ' + row.n8n + ' yet' };
  const pins = over.nodes || over.pins || {};
  const problems = [];
  for (const nodeName of Object.keys(pins)) {
    const want = pins[nodeName];
    if (!PRICES[want]) problems.push('override pins ' + JSON.stringify(nodeName) + ' to ' + JSON.stringify(want) + ', which has no price in this file');
  }
  if (problems.length) {
    throw new Error('#36 node files: the manifest model routing and this build disagree:\n  - ' + problems.join('\n  - '));
  }
  return { checked: true };
}

// ---------------------------------------------------------------------------------------------
// Platform facts, read from the collector helpers rather than restated. See the header.
// ---------------------------------------------------------------------------------------------
const SHEETS = require(OUTPUT_HELPER_FILE);
const SCORING = require(SCORING_HELPER_FILE);

for (const fn of ['a1', 'batchGetUrl']) {
  if (typeof SHEETS[fn] !== 'function') {
    throw new Error('#36 node files: ' + rel(OUTPUT_HELPER_FILE) + ' no longer exports ' + fn + '(). The A1 quoting rule and the batchGet url shape are read from there so the two lanes cannot hold different copies of them.');
  }
}
if (typeof SCORING.ANTHROPIC_URL !== 'string' || typeof SCORING.ANTHROPIC_VERSION !== 'string' || typeof SCORING.SWEDISH_FLAG !== 'string') {
  throw new Error('#36 node files: ' + rel(SCORING_HELPER_FILE) + ' no longer exports ANTHROPIC_URL, ANTHROPIC_VERSION and SWEDISH_FLAG. The Swedish flag string in particular has to be the SAME string the collectors ask their model to emit, or the D10 block matches nothing.');
}

function renderConfig() {
  const r = lane().render || {};
  if (!r.gotenberg_html_endpoint) throw new Error('#36 node files: lane.json render.gotenberg_html_endpoint is empty, and the render seat has nowhere to post.');
  return {
    base: r.gotenberg_base,
    html_endpoint: r.gotenberg_html_endpoint,
    verified: r.gotenberg_verified === true,
  };
}

function scoreThreshold() {
  const v = lane().score_threshold;
  if (!Number.isInteger(v) || v < 0 || v > 100) {
    throw new Error('#36 node files: lane.json score_threshold is ' + JSON.stringify(v) + '. It is the bar a collector score has to clear and it is a whole number from 0 to 100.');
  }
  return v;
}

module.exports = {
  REPO, LANE_DIR, LANE_ORDER, MASTER_KEY_OF,
  lane, lanes, caps, CAP_DEFAULTS,
  PRICES, MIN_CACHEABLE_TOKENS, STAGE_MODELS, prices,
  assertPricesAgreeWithCollector, assertModelRoutingAgrees, assertColumnsAgainstSeed,
  credentialId, googleSheetsCredential, googleDriveCredential, anthropicCredential,
  sourcesContract, linkedinDetailTemplate, collectorScopes, readBakedConst,
  jobsColumns, APPLICATIONS_COLUMNS, WRITER_RUNS_COLUMNS,
  renderConfig, scoreThreshold,
  a1: SHEETS.a1,
  batchGetUrl: SHEETS.batchGetUrl,
  ANTHROPIC_URL: SCORING.ANTHROPIC_URL,
  ANTHROPIC_VERSION: SCORING.ANTHROPIC_VERSION,
  WORK_MODES: SCORING.WORK_MODES,
  SWEDISH_FLAG: SCORING.SWEDISH_FLAG,
};

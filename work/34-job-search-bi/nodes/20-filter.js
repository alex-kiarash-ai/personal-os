'use strict';
/*
 * 20-filter.js - "Filter". The node that decides what Shaheen ever sees.
 *
 * Four rules, in this order, first failure wins: always_drop on the title, keep_if_title_has on the
 * title, geography, freshness. Plus one thing that is not a rule: posted_at is normalised here, in
 * the one node that sees all three branches, so the sheet column holds one format.
 *
 * THE RULES COME FROM THE SETTINGS TAB. Every list, the location set and the per-run cap arrive on
 * `filters`, which Plan Queries stamps onto every planned unit out of the validated config object.
 * Nothing about what Shaheen is hunting is typed into this file. The only vocabulary that lives
 * here is the geography one, and it is here for the same reason LINKEDIN_TARGETS is in Plan
 * Queries: turning the string "Remote EU" into something a free-text location field can be matched
 * against is a decision, and a decision belongs in a file that can be read and reversed.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. TOKEN BOUNDARIES ON always_drop, PLAIN SUBSTRING ON keep_if_title_has. Not a symmetry slip.
 * ---------------------------------------------------------------------------------------------
 * A short drop term matched as a plain substring kills every longer word that merely STARTS with it,
 * and both lanes' real lists are full of exactly that shape. Two of them do most of the damage: a
 * six-letter term aimed at entry-level roles is also the opening of the ordinary adjective for
 * cross-border work, and a five-letter term aimed at commercial roles is also the opening of a very
 * well known CRM vendor's name. Measured against eighteen realistic titles for this lane, plain
 * substring matching produced NINE false drops, and token-boundary matching recovers every one of
 * them while still dropping the three that genuinely should go.
 *
 * The titles and the terms are NOT written here. They live in config/test-stage-e.js, which is
 * gitignored, because this folder is tracked and the repo is PUBLIC. A node file holds wiring.
 *
 * The boundary test is BY INDEX, never by the regex \b. Real terms in both lists carry a dot, a
 * hyphen and an ampersand: there are product names with a dot in them, Swedish job titles joined by
 * a hyphen, and a two-word term joined by an ampersand. \b is defined against \w, which puts a
 * word boundary in the MIDDLE of every one of those, so a \b match would cut them in half and
 * match their fragments. A term matches only where the character on each side is not a letter or a
 * digit.
 *
 * keep_if_title_has stays a plain substring, and that is deliberate rather than unfinished. The two
 * lists fail in OPPOSITE directions: a loose always_drop DROPS a real job, a loose keep_if_title_has
 * KEEPS a junk one, which the scorer then sees and ranks low. So each list gets the matcher that
 * fails in the cheap direction. It is also exactly what the settings tab's own match_rule cell says.
 * And it matters in the other lane specifically: several of its keep terms are three-letter
 * acronyms that real job titles glue straight onto a following word, and a boundary match would
 * refuse every one of those titles.
 *
 * always_drop WINS. Checked first, and a drop hit ends the row whatever the keep list says.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. THE WINDOW IS THE ONE THE PLAN COMPUTED, AND LINKEDIN ROWS ARE NOT CUT ON IT AT ALL.
 * ---------------------------------------------------------------------------------------------
 * The cut line is `_collect.window_start_effective`, per row, which is what Plan Queries computed:
 * 168h on a first run, since-last-run plus a 1h margin with a 24h floor after that, shifted back
 * further for a source with a declared publish lag. A fixed 48h cut would throw away five days of
 * the first run's backfill and nothing would say so.
 *
 * A row with `_collect.window_filtered_server_side === true` SKIPS the window rule entirely. That
 * is LinkedIn, which was cut at the source by f_TPR. Skipping it is not a convenience, it is a
 * correctness fix, and the reason is a false drop that would have hit every LinkedIn row posted on
 * the day of the run: LinkedIn publishes a DATE with no time, this node reads a bare date as the
 * start of that day in UTC, and on a normal 25h window the window starts in the MIDDLE of a day. So
 * a job posted this morning carries today's date, resolves to midnight, lands before window_start,
 * and gets dropped as too old. Server-side-filtered rows were already inside the window when they
 * arrived; re-cutting them on a coarser date than the one the cut needs is strictly worse than not
 * cutting them.
 *
 * An UNDATED row is KEPT, sorted last by the cap, and counted. Losing a date must not lose a job,
 * which is the rule the board collector already applies when it emits one. It is counted so the
 * count can be read, because a stale row silently treated as fresh is the other half of the trap.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. GEOGRAPHY IS DELIBERATELY CONSERVATIVE, AND THE MEASUREMENT IS WHY.
 * ---------------------------------------------------------------------------------------------
 * Measured over the six live board captures, 515 rows: the title rules alone take the BI lane to 7
 * rows and the AI lane to 10, and the window then takes those to 1 and 3. So geography is deciding
 * a handful of rows per run, while a location field that is free text in five different shapes is
 * the single easiest place in this lane to lose a real job by accident. The rule therefore drops
 * only what it can name, and every geography drop is reported with the string that caused it, so a
 * bad rule is visible on the first run instead of never.
 *
 *   - a location with no geographic content at all (empty, "Remote", "Hybrid", "N/A") is UNKNOWN
 *     and is KEPT and counted. It is not evidence of anywhere.
 *   - a location carrying one of the positive tokens for the settings `locations` is KEPT.
 *   - anything else names somewhere, and none of it is anywhere Shaheen asked for, so it DROPS.
 *   - a LinkedIn row carries `_collect.location_setting`, which means the SEARCH was already aimed
 *     at one of his locations, so it skips the geography rule the same way it skips the window.
 *
 * geo_rule and language_rule prose from the settings tab is carried into the report and is NOT
 * interpreted here. Language is never a filter, by his own rule: a Swedish-fluency requirement is a
 * red flag for the scorer, not a reason to drop.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. THE CAP IS NOT IN THIS NODE, AND THE BRIEF SAID IT WOULD BE.
 * ---------------------------------------------------------------------------------------------
 * max_scored_per_run caps what reaches the SCORER, and between this node and the scorer sits Remove
 * Known, which deletes every row Shaheen has already seen. Capping here would spend the twenty
 * slots on rows that are about to be deleted. Worse, it makes the backlog undrainable: a run where
 * the cap bit must not advance last_run_at, so the next run sees the same window, and if the cap is
 * applied BEFORE Remove Known that next run caps to the same twenty rows, removes all twenty as
 * known, and emits nothing, forever. The cap is applied in Remove Known, after the known rows are
 * gone. This node reports how many rows survived so the gap between the two numbers is visible.
 *
 * ---------------------------------------------------------------------------------------------
 * 5. THE STREAM CONTRACT.
 * ---------------------------------------------------------------------------------------------
 * IN:  `_kind: 'job'` rows and `_kind: 'source_report'` items, from all three collectors via Merge.
 * OUT: the surviving jobs, EVERY source_report untouched, and one `_kind: 'stage_report'`.
 * The reports pass through for two reasons. Stage F needs every one of them to write the run
 * verdict, and they are also what guarantees this node and the two after it have input at all: a
 * run where every job is filtered out still carries the reports, and an n8n node with empty input
 * is skipped entirely, which would take Read Known Jobs and Remove Known with it and lose the
 * evidence of exactly the run that most needs explaining.
 */

const { lane, sources, settingsSchema } = require('./_lane');
const L = lane();
const CONTRACT = sources();

// The rule keys this node reads off `filters`. Read back out of Plan Queries' generated code below,
// so a rule that stops being carried fails HERE, at build time, rather than arriving as undefined
// and quietly filtering nothing.
const REQUIRED_FILTER_KEYS = [
  'keep_if_title_has', 'always_drop', 'locations', 'match_rule', 'geo_rule', 'language_rule',
  'max_scored_per_run',
];

// ---------------------------------------------------------------------------------------------
// THE GEOGRAPHY VOCABULARY.
//
// Keyed by the EXACT strings the settings tab's `locations` list uses, the same way Plan Queries
// keys LINKEDIN_TARGETS, and asserted against that map at build time so the two can never drift.
// A location in the sheet that this map does not know THROWS at run time rather than being ignored,
// because a location added to the sheet and quietly skipped is invisible in every run report.
//
// Tokens are matched on TOKEN BOUNDARIES, case insensitively, against both the raw location string
// and a diacritic-folded copy of it, so Malmo matches the Swedish spelling and vice versa.
// ---------------------------------------------------------------------------------------------
const GEO_TARGETS = {
  'Sweden': {
    why: 'his home market. Onsite is fine here and nowhere else, per his geo_rule.',
    tokens: [
      'sweden', 'sverige', 'swedish', 'svensk', 'nordic', 'nordics', 'norden', 'scandinavia',
      'scandinavian', 'skandinavien',
      // The dozen largest Swedish labour markets. This list is a CONVENIENCE, not a claim of
      // completeness: a town it does not know is a town whose row falls through to the drop branch,
      // which is why every geography drop is reported with its location string. Board feeds name
      // countries and regions, not towns, so in practice this only ever fires on the two boards
      // that publish free-text city strings.
      'stockholm', 'goteborg', 'gothenburg', 'malmo', 'uppsala', 'linkoping', 'vasteras', 'orebro',
      'lund', 'helsingborg', 'umea', 'norrkoping', 'jonkoping', 'solna', 'kista', 'sundbyberg',
    ],
  },
  'Remote EU': {
    why: 'a remote job open to the EU is open to him. CET is included because two boards state the timezone instead of the region.',
    tokens: [
      'europe', 'european', 'european union', 'eu', 'eea', 'european economic area', 'emea',
      'cet', 'cest', 'central european', 'central european time',
    ],
  },
  'Remote EMEA': {
    why: 'his own words in the locations list. EMEA is Europe, the Middle East and Africa, so a job scoped to any of the three is inside the scope he asked for, and the scorer ranks it.',
    tokens: ['emea', 'europe', 'european', 'middle east', 'africa', 'african'],
  },
};

// Always positive, whatever the locations list says, because a job open to everywhere is open to
// everywhere he named.
const WORLDWIDE_TOKENS = [
  'worldwide', 'world wide', 'world-wide', 'global', 'globally', 'anywhere', 'international',
  'any location', 'any country', 'everywhere', 'fully distributed',
];

// Words that describe an ARRANGEMENT, not a place. A location made of nothing but these carries no
// geographic information and the row is kept as unknown rather than dropped on an empty inference.
const NO_INFO_TOKENS = [
  'remote', 'remotely', 'hybrid', 'onsite', 'on site', 'on-site', 'office', 'home office',
  'work from home', 'wfh', 'telecommute', 'distributed', 'flexible', 'various',
  'multiple locations', 'n/a', 'na', 'none', 'unknown', 'tbd', 'any', 'other',
];

// ---------------------------------------------------------------------------------------------
// Build-time assertions. Every one of these runs on this machine before a byte reaches the box.
// ---------------------------------------------------------------------------------------------
const PLAN_CODE = require('./05-plan-queries.js').parameters.jsCode;

(function assertAgainstUpstream() {
  // 1. The rule block still carries every rule this node reads.
  const m = /const filters = \{([\s\S]*?)\n\};/.exec(PLAN_CODE);
  if (!m) {
    throw new Error(
      'Filter: could not find the `filters` block in 05-plan-queries.js. That block is how every\n' +
      '  rule in the settings tab reaches this node. If it was renamed, rename it in both files in\n' +
      '  the same edit.'
    );
  }
  const carried = [];
  const keyLine = /^\s*([a-z_]+):/gm;
  let hit;
  while ((hit = keyLine.exec(m[1])) !== null) carried.push(hit[1]);
  const missing = REQUIRED_FILTER_KEYS.filter((k) => carried.indexOf(k) === -1);
  if (missing.length) {
    throw new Error(
      'Filter: Plan Queries no longer carries ' + missing.join(', ') + ' on `filters`.\n' +
      '  It carries: ' + carried.join(', ') + '.\n' +
      '  A rule that stops being carried arrives here as undefined, and an undefined list filters\n' +
      '  nothing at all while the run reports a perfectly healthy number.'
    );
  }

  // 2. The geography map and Plan Queries' LinkedIn map answer to the SAME settings strings.
  const t = /^const LINKEDIN_TARGETS = (\{.*\});$/m.exec(PLAN_CODE);
  if (!t) throw new Error('Filter: could not read LINKEDIN_TARGETS out of 05-plan-queries.js. That map is the other half of the location contract.');
  const planLocations = Object.keys(JSON.parse(t[1])).slice().sort();
  const mine = Object.keys(GEO_TARGETS).slice().sort();
  if (planLocations.length !== mine.length || planLocations.some((k, i) => k !== mine[i])) {
    throw new Error(
      'Filter: the geography map and Plan Queries disagree about which locations exist.\n' +
      '  Plan Queries knows: ' + planLocations.join(' | ') + '\n' +
      '  this node knows:    ' + mine.join(' | ') + '\n' +
      '  Both are keyed by the settings tab\'s `locations` strings. A location one of them knows and\n' +
      '  the other does not is a location that is searched and never filtered, or filtered and never\n' +
      '  searched.'
    );
  }

  // 3. Every geography target has at least one token, and no token is blank or mixed case. A blank
  // token would match every string and turn the drop branch off for the whole run.
  for (const k of Object.keys(GEO_TARGETS)) {
    const toks = GEO_TARGETS[k].tokens;
    if (!Array.isArray(toks) || !toks.length) throw new Error('Filter: geography target ' + k + ' has no tokens, so it can never keep a row.');
    for (const tok of toks) {
      if (typeof tok !== 'string' || tok.trim() === '') throw new Error('Filter: geography target ' + k + ' has a blank token, which would match every location string.');
      if (tok !== tok.toLowerCase()) throw new Error('Filter: geography token ' + JSON.stringify(tok) + ' is not lowercase, and matching is done on a lowercased string.');
    }
  }
  for (const list of [WORLDWIDE_TOKENS, NO_INFO_TOKENS]) {
    for (const tok of list) {
      if (typeof tok !== 'string' || tok.trim() === '' || tok !== tok.toLowerCase()) {
        throw new Error('Filter: ' + JSON.stringify(tok) + ' is not a usable lowercase token.');
      }
    }
  }

  // 4. The two item kinds this node sorts on are the ones the collectors actually emit.
  for (const f of ['08-extract-linkedin.js', '16-extract-indeed-jobs.js', '18-extract-board-jobs.js']) {
    const code = require('./' + f).parameters.jsCode;
    if (code.indexOf("_kind: 'job'") === -1 || code.indexOf("_kind: 'source_report'") === -1) {
      throw new Error(
        'Filter: ' + f + ' no longer emits both _kind values this node routes on. Filtering on a\n' +
        '  kind nobody emits silently drops every row, or silently filters every report.'
      );
    }
  }

  // 5. The row shape this node preserves is the contract's, unchanged. This node adds and removes
  // no sheet column; it only decides which rows live.
  if (!Array.isArray(CONTRACT.shared_row_shape) || CONTRACT.shared_row_shape.indexOf('posted_at') === -1) {
    throw new Error('Filter: the contract has no posted_at column, and this node normalises it.');
  }

  // 6. The settings schema still calls max_scored_per_run a number and the two title lists lists.
  const S = settingsSchema();
  if (S.number.indexOf('max_scored_per_run') === -1) throw new Error('Filter: max_scored_per_run is no longer a number in the settings schema, and the cap arithmetic assumes it is.');
  for (const k of ['keep_if_title_has', 'always_drop', 'locations']) {
    if (S.list.indexOf(k) === -1) throw new Error('Filter: ' + k + ' is no longer a list in the settings schema.');
  }
  for (const k of ['keep_if_title_has', 'always_drop']) {
    if (S.lowercase_lists.indexOf(k) === -1) {
      throw new Error('Filter: ' + k + ' is no longer validated as lowercase, and this node matches against a lowercased title. An uppercase term in the cell would silently never match.');
    }
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Filter. Title, geography, freshness. The reports ride through untouched.
// ---------------------------------------------------------------------------
const items = $input.all();

let plannedAll;
try {
  plannedAll = $('Plan Queries').all().map((i) => i.json);
} catch (e) {
  throw new Error('Filter: cannot reach Plan Queries (' + e.message + '). Every rule this node applies comes from there, and filtering with no rules would pass everything through and look like a good day.');
}
if (!plannedAll.length) throw new Error('Filter: Plan Queries emitted nothing, so there are no rules to filter with.');

const run = plannedAll[0].run || {};
const F = plannedAll[0].filters || {};
const problems = [];
for (const k of REQUIRED_FILTER_KEYS) {
  if (F[k] === undefined || F[k] === null) problems.push(k + ' is missing from filters');
}
for (const k of ['keep_if_title_has', 'always_drop', 'locations']) {
  if (F[k] !== undefined && !Array.isArray(F[k])) problems.push(k + ' is not a list');
  else if (Array.isArray(F[k]) && F[k].length === 0) problems.push(k + ' is empty, and an empty filter list is not "everything", it is a run that keeps nothing or keeps everything depending on which list it is');
}
if (!isFinite(Number(F.max_scored_per_run)) || Number(F.max_scored_per_run) < 1) {
  problems.push('max_scored_per_run is ' + JSON.stringify(F.max_scored_per_run) + ', which is not a usable cap');
}
if (problems.length) {
  throw new Error('Filter: the rule set from the settings tab is unusable:\\n  - ' + problems.join('\\n  - ') +
    '\\nThis stops the run rather than filtering with half a rule set, because a half-applied filter is indistinguishable from a quiet day.');
}

// --- matching ---------------------------------------------------------------
const WORD_CHAR = /[\\p{L}\\p{N}]/u;
const HAS_CONTENT = /[\\p{L}\\p{N}]/u;

// Token-boundary containment, BY INDEX. Not the regex \\b: these terms carry . - and &, and \\b is
// defined against \\w, which puts a boundary in the middle of every one of them.
function tokenMatch(hay, term) {
  if (!term) return false;
  const h = String(hay);
  const t = String(term);
  if (!t.length) return false;
  let i = h.indexOf(t);
  while (i !== -1) {
    const before = i === 0 ? '' : h.charAt(i - 1);
    const after = (i + t.length >= h.length) ? '' : h.charAt(i + t.length);
    if (!(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after))) return true;
    i = h.indexOf(t, i + 1);
  }
  return false;
}
function substrMatch(hay, term) {
  if (!term) return false;
  return String(hay).indexOf(String(term)) !== -1;
}
// Drop the diacritics so a Swedish spelling matches an English one and the other way round.
function fold(s) {
  let out = String(s);
  try { out = out.normalize('NFD').replace(/[\\u0300-\\u036f]/g, ''); } catch (e) { /* normalize is standard; if it is ever absent the raw string still matches */ }
  return out.replace(/\\u00F8/g, 'o').replace(/\\u00E6/g, 'ae').replace(/\\u00DF/g, 'ss');
}

// --- posted_at, one column, one format --------------------------------------
// Accepts exactly two shapes and refuses everything else on purpose. A date-TIME with no offset is
// read by JavaScript as LOCAL time, which silently adopts whatever timezone the n8n process has and
// moves a job across the window boundary by an hour or two. The board collector already normalises
// to UTC, so one arriving here means that normalisation broke, and the honest answer is to say so
// rather than to guess the offset.
const RE_DATE_ONLY = /^(\\d{4})-(\\d{2})-(\\d{2})$/;
const RE_INSTANT = /^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}(:\\d{2})?(\\.\\d+)?(Z|[+-]\\d{2}:?\\d{2})$/;
function normalisePostedAt(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { iso: null, precision: 'none', problem: 'no posted_at on the row' };
  }
  const s = String(raw).trim();
  if (RE_DATE_ONLY.test(s)) {
    // Start of day UTC, declared. There is no time in the source, so any instant is a convention;
    // this one is the only convention that does not also depend on which side of a DST change the
    // date falls. precision 'day' travels with the row so nothing downstream reads midnight as a
    // measurement.
    return { iso: s + 'T00:00:00.000Z', precision: 'day', problem: null };
  }
  if (RE_INSTANT.test(s)) {
    const ms = Date.parse(s);
    if (!isFinite(ms)) return { iso: null, precision: 'none', problem: 'looks like an instant and does not parse: ' + s };
    return { iso: new Date(ms).toISOString(), precision: 'instant', problem: null };
  }
  return {
    iso: null,
    precision: 'none',
    problem: 'unrecognised date ' + JSON.stringify(s.slice(0, 40)) +
      '. This node accepts YYYY-MM-DD or a full ISO instant carrying Z or an offset, and nothing else, ' +
      'because a date-time with no offset is read as local time and moves the row across the window by hours.',
  };
}

// --- geography --------------------------------------------------------------
// LONGEST TOKEN FIRST, and it is not cosmetic. Stripping in declared order lets a short token eat
// the head of a longer one: with 'office' removed first, 'home office' no longer matches and the
// leftover word 'home' reads as a place name, so a row whose location says nothing at all gets
// dropped as if it named somewhere.
const NO_INFO_SORTED = NO_INFO_TOKENS.slice().sort((a, b) => b.length - a.length);
function stripNoInfo(s) {
  let out = s;
  for (const tok of NO_INFO_SORTED) {
    let guard = 0;
    while (tokenMatch(out, tok) && guard < 20) {
      const i = out.indexOf(tok);
      if (i === -1) break;
      const before = i === 0 ? '' : out.charAt(i - 1);
      const after = (i + tok.length >= out.length) ? '' : out.charAt(i + tok.length);
      if (!(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after))) {
        out = out.slice(0, i) + ' ' + out.slice(i + tok.length);
      } else {
        break;
      }
      guard += 1;
    }
  }
  return out;
}

function geoDecide(locationRaw, remote) {
  const raw = locationRaw === null || locationRaw === undefined ? '' : String(locationRaw);
  const low = raw.toLowerCase();
  const folded = fold(low);
  if (!HAS_CONTENT.test(low)) {
    return { verdict: 'unknown', why: 'no location on the row', token: null };
  }
  for (const key of ACTIVE_GEO_KEYS) {
    for (const tok of GEO_TARGETS[key].tokens) {
      if (tokenMatch(low, tok) || tokenMatch(folded, tok)) {
        return { verdict: 'keep', why: 'matches the settings location ' + key, token: tok };
      }
    }
  }
  for (const tok of WORLDWIDE_TOKENS) {
    if (tokenMatch(low, tok) || tokenMatch(folded, tok)) {
      return { verdict: 'keep', why: 'open to everywhere, which includes every location in the settings tab', token: tok };
    }
  }
  const left = stripNoInfo(folded);
  if (!HAS_CONTENT.test(left)) {
    return { verdict: 'unknown', why: 'the location says how the work is done, not where, so it is not evidence of anywhere', token: null };
  }
  return {
    verdict: 'drop',
    why: remote === true
      ? 'a remote job restricted to somewhere that is not in the settings locations'
      : 'onsite outside Sweden',
    token: null,
  };
}

// --- sort the stream --------------------------------------------------------
const jobs = [];
const reports = [];
const strays = [];
for (const it of items) {
  const j = (it && it.json) || {};
  if (j._kind === 'job') jobs.push(it);
  else if (j._kind === 'source_report') reports.push(it);
  else strays.push(j);
}

const ACTIVE_GEO_KEYS = [];
for (const loc of F.locations) {
  if (!GEO_TARGETS[loc]) {
    throw new Error(
      'Filter: the settings tab lists location ' + JSON.stringify(loc) + ' and this node has no geography ' +
      'vocabulary for it, so every row would be judged against the OTHER locations only and the new one ' +
      'would do nothing.\\n  Known: ' + Object.keys(GEO_TARGETS).join(' | ') +
      '\\n  Add it here and in LINKEDIN_TARGETS in Plan Queries, in the same edit.'
    );
  }
  ACTIVE_GEO_KEYS.push(loc);
}

// --- the four rules ---------------------------------------------------------
const counts = {
  jobs_in: jobs.length,
  kept: 0,
  dropped_always_drop: 0,
  dropped_no_keep_term: 0,
  dropped_no_title: 0,
  dropped_geo: 0,
  dropped_too_old: 0,
};
const dropTermHits = {};
const keepTermHits = {};
const geoDropSamples = {};
const perSourceIn = {};
const perSourceKept = {};
let keptUndated = 0;
let windowSkippedServerSide = 0;
let geoSkippedServerSide = 0;
let geoUnknownKept = 0;
let dateProblems = 0;
const dateProblemSamples = [];
let precisionDay = 0;
let precisionInstant = 0;

const kept = [];

for (const it of jobs) {
  const row = Object.assign({}, it.json);
  const c = row._collect || {};
  const src = row.source || c.source || 'unknown';
  perSourceIn[src] = (perSourceIn[src] || 0) + 1;

  // posted_at first: the window rule and the cap both read the normalised value.
  const posted = normalisePostedAt(row.posted_at);
  row.posted_at = posted.iso;
  if (posted.precision === 'day') precisionDay += 1;
  if (posted.precision === 'instant') precisionInstant += 1;
  if (posted.problem && row.posted_at === null && c.posted_at_problem === undefined && String(it.json.posted_at || '').trim() !== '') {
    dateProblems += 1;
    if (dateProblemSamples.length < 5) dateProblemSamples.push({ source: src, job_id: row.job_id, raw: it.json.posted_at, problem: posted.problem });
  }

  const title = String(row.title === null || row.title === undefined ? '' : row.title).toLowerCase();
  const f = {
    posted_at_raw: it.json.posted_at === undefined ? null : it.json.posted_at,
    posted_at_precision: posted.precision,
    posted_at_problem: posted.problem,
    window_start_effective: c.window_start_effective || c.window_start || run.window_start || null,
    verdict: null,
    reason: null,
    detail: null,
  };

  // 1. always_drop, on token boundaries, and it wins.
  let dropHit = null;
  for (const t of F.always_drop) { if (tokenMatch(title, t)) { dropHit = t; break; } }
  if (dropHit) {
    counts.dropped_always_drop += 1;
    dropTermHits[dropHit] = (dropTermHits[dropHit] || 0) + 1;
    continue;
  }

  // 2. keep_if_title_has, plain substring, the settings tab's own match_rule.
  if (!HAS_CONTENT.test(title)) {
    counts.dropped_no_title += 1;
    continue;
  }
  let keepHit = null;
  for (const t of F.keep_if_title_has) { if (substrMatch(title, t)) { keepHit = t; break; } }
  if (!keepHit) {
    counts.dropped_no_keep_term += 1;
    continue;
  }
  keepTermHits[keepHit] = (keepTermHits[keepHit] || 0) + 1;

  // 3. geography.
  const serverGeo = typeof c.location_setting === 'string' && GEO_TARGETS[c.location_setting] !== undefined;
  if (serverGeo) {
    geoSkippedServerSide += 1;
    f.detail = 'geography was applied at the source, the search was aimed at ' + c.location_setting;
  } else {
    const g = geoDecide(row.location, row.remote);
    if (g.verdict === 'drop') {
      counts.dropped_geo += 1;
      const keyLoc = String(row.location === null || row.location === undefined ? '(none)' : row.location).slice(0, 60);
      geoDropSamples[keyLoc] = (geoDropSamples[keyLoc] || 0) + 1;
      continue;
    }
    if (g.verdict === 'unknown') geoUnknownKept += 1;
    f.detail = g.why;
  }

  // 4. freshness, on the window the plan computed.
  if (c.window_filtered_server_side === true) {
    windowSkippedServerSide += 1;
  } else if (posted.iso === null) {
    keptUndated += 1;
  } else {
    const cut = f.window_start_effective ? Date.parse(f.window_start_effective) : null;
    if (cut !== null && isFinite(cut) && Date.parse(posted.iso) < cut) {
      counts.dropped_too_old += 1;
      continue;
    }
  }

  f.verdict = 'kept';
  f.reason = 'title matched ' + JSON.stringify(keepHit);
  row._filter = f;
  counts.kept += 1;
  perSourceKept[src] = (perSourceKept[src] || 0) + 1;
  kept.push({ json: row, pairedItem: { item: 0 } });
}

// --- the stage report -------------------------------------------------------
const warnings = [];
if (strays.length) {
  warnings.push(
    strays.length + ' item(s) arrived carrying neither _kind job nor _kind source_report and were NOT passed on. ' +
    'Every collector tags what it emits, so an untagged item means something else is wired into Combine. ' +
    'First keys seen: ' + JSON.stringify(strays.slice(0, 3).map((s) => Object.keys(s).slice(0, 8)))
  );
}
if (dateProblems > 0) {
  warnings.push(
    dateProblems + ' row(s) carried a posted_at this node refused. It accepts YYYY-MM-DD or a full ISO instant ' +
    'with Z or an offset. A date-time with NO offset is read as local time by JavaScript and moves a job across ' +
    'the window by an hour or two, which is far too small to notice and exactly big enough to matter. Those rows ' +
    'are kept with posted_at null rather than with a guess. Samples: ' + JSON.stringify(dateProblemSamples)
  );
}
if (keptUndated > 0) {
  warnings.push(
    keptUndated + ' row(s) have no usable posted_at and were KEPT rather than dropped, because losing a date must ' +
    'not lose a job. They sort LAST for the per-run cap, deliberately and not by accident, so a dated row is never ' +
    'displaced by one whose age nobody knows.'
  );
}
if (counts.dropped_geo > 0) {
  warnings.push(
    counts.dropped_geo + ' row(s) were dropped on GEOGRAPHY, and the location strings that caused it are listed in ' +
    'geo.dropped_locations. Location is free text in five different shapes across these sources, so this is the ' +
    'easiest rule in the lane to get wrong. Read that list on the first few runs: a string that should have been ' +
    'kept is a missing token in the geography vocabulary, which is one line in nodes/20-filter.js.'
  );
}
if (counts.jobs_in > 0 && counts.kept === 0) {
  warnings.push(
    'every one of the ' + counts.jobs_in + ' collected row(s) was filtered out. That is a real possible outcome on a ' +
    'quiet day and it is also what a broken rule set looks like, so the per-rule counts above are the thing to read. ' +
    'Nothing here distinguishes the two on its own.'
  );
}
if (!reports.length) {
  warnings.push(
    'no source_report reached this node at all. Each collector emits one unconditionally, so zero of them means no ' +
    'collector ran, which in turn means Combine fired on an empty stream. Stage F has nothing to write a verdict from.'
  );
}

const stageReport = {
  _kind: 'stage_report',
  stage: 'filter',
  lane: LANE_NUMBER,
  run_started_at: run.run_started_at || null,
  window_start: run.window_start || null,
  window_end: run.window_end || null,
  first_run: run.first_run === true,
  counts: counts,
  per_source_in: perSourceIn,
  per_source_kept: perSourceKept,
  reports_passed_through: reports.length,
  strays_dropped: strays.length,
  title: {
    rule: F.match_rule || null,
    always_drop_terms: F.always_drop.length,
    keep_terms: F.keep_if_title_has.length,
    always_drop_matching: 'token boundary, by index, case insensitive, title only',
    keep_matching: 'plain substring, case insensitive, title only',
    always_drop_hits: dropTermHits,
    keep_hits: keepTermHits,
  },
  geo: {
    rule: F.geo_rule || null,
    locations: F.locations,
    skipped_filtered_at_source: geoSkippedServerSide,
    kept_unknown_location: geoUnknownKept,
    dropped: counts.dropped_geo,
    dropped_locations: geoDropSamples,
  },
  language: {
    rule: F.language_rule || null,
    applied: false,
    why: 'language is never a filter in this lane. A Swedish fluency requirement is a red flag for the scorer, not a reason to drop.',
  },
  freshness: {
    window_start: run.window_start || null,
    window_hours: run.window_hours === undefined ? null : run.window_hours,
    window_reason: run.window_reason || null,
    dropped_too_old: counts.dropped_too_old,
    skipped_filtered_at_source: windowSkippedServerSide,
    kept_undated: keptUndated,
  },
  posted_at: {
    normalised_to: 'ISO 8601 UTC, one column one format',
    day_precision_rows: precisionDay,
    instant_precision_rows: precisionInstant,
    refused: dateProblems,
    day_precision_convention: 'a bare YYYY-MM-DD becomes T00:00:00.000Z and carries posted_at_precision day, so nothing downstream reads midnight as a measurement',
  },
  cap: {
    applied_here: false,
    applied_in: 'Remove Known',
    why: 'the cap limits what reaches the SCORER, and Remove Known sits between this node and the scorer. Capping before the known rows are removed spends the slots on rows that are about to be deleted, and it makes a capped backlog undrainable.',
    max_scored_per_run: Number(F.max_scored_per_run),
  },
  warnings: warnings,
};

// The reports ride through untouched, and they always go, even on a run where nothing survived.
// A Code node returning [] ends the branch, which would take Read Known Jobs and Remove Known with
// it and delete the evidence of exactly the run that most needs explaining.
return kept.concat(reports, [{ json: stageReport, pairedItem: { item: 0 } }]);
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/20-filter.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const REQUIRED_FILTER_KEYS = ${JSON.stringify(REQUIRED_FILTER_KEYS)};`,
  `const GEO_TARGETS = ${JSON.stringify(GEO_TARGETS)};`,
  `const WORLDWIDE_TOKENS = ${JSON.stringify(WORLDWIDE_TOKENS)};`,
  `const NO_INFO_TOKENS = ${JSON.stringify(NO_INFO_TOKENS)};`,
  `const LANE_NUMBER = ${JSON.stringify(String(L.lane))};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Filter',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [3640, 160],
  connectFrom: 'Combine',
  notes: 'always_drop on token boundaries wins over keep_if_title_has as a substring, then geography, then the window the plan computed. Source reports ride through untouched. The per-run cap is in Remove Known, not here.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

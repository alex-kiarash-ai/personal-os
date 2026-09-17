'use strict';
/*
 * 22-remove-known.js - "Remove Known". The last node of Stage E and the last gate before the
 * scorer. Four jobs: refuse a failed sheet read, collapse the same job arriving from several
 * sources, drop what Shaheen has already been shown, and apply the per-run cap.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. A FAILED SHEET READ IS NOT AN EMPTY SHEET. This is the rule the node exists for.
 * ---------------------------------------------------------------------------------------------
 * If the credential lapses or the tab is renamed, the naive reading is "no known jobs", and the run
 * would then re-write every job in the window that Shaheen has already seen and already dismissed.
 * So the node demands POSITIVE evidence of a successful read and emits zero rows without it:
 *   failed        an item carrying `error`. Read Known Jobs runs with onError continueRegularOutput
 *                 so this arrives as data instead of killing the run.
 *   no_output     zero items, which alwaysOutputData is supposed to make impossible. If it ever
 *                 happens the flag is gone or the node did not run, and neither is an empty sheet.
 *   wrong_shape   items arrived with keys and not one of them carries job_id. That is a read of the
 *                 wrong tab, which is the one failure that returns a 200 and looks healthy.
 *   empty         one or more items and every one of them blank. The first run, legitimately.
 *   ok            at least one row with a job_id.
 * Only `empty` and `ok` proceed. The other three emit ZERO job rows, keep every source report, and
 * say so in the stage report with a status token.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. CROSS-SOURCE DEDUPE, WHICH WAS FORMALLY UNOWNED UNTIL NOW.
 * ---------------------------------------------------------------------------------------------
 * Each collector counts duplicates inside its own source and removes none, on purpose, so the same
 * job on LinkedIn, RemoteOK and Himalayas is three rows with three different ids. Two passes:
 *   by job_id      the documented per-source id. Exact, and it also catches the same LinkedIn job
 *                  arriving under two different search terms.
 *   by company+title  normalised, and ONLY across DIFFERENT sources. Two rows from the SAME source
 *                  with different ids are two different postings, and a company that posts the same
 *                  title twice is real. A group where any one source contributes two or more rows
 *                  is ambiguous, so it is left alone WHOLE and reported, never half-collapsed.
 *
 * NOTHING IS EVER MERGED. One row survives intact; no field is taken from a losing row. That is
 * what discharges the attribution obligation mechanically rather than by remembering: the surviving
 * row's `source`, `url` and `apply_url` always agree with each other, so whichever board's terms
 * apply are the surviving board's own, satisfied by its own link. A losing row's data is not
 * published at all, which is equally compliant.
 *
 * THE WINNER IS CHOSEN BY A DECLARED PRIORITY, AND THE BRIEF SAID SOMETHING ELSE. The instruction
 * was to keep the row whose apply_url points at the original source. Measured against these
 * sources, that rule does not resolve: LinkedIn rows carry apply_url null by the collector's own
 * decision, RemoteOK's apply_url equals its url on all 99 rows of the live capture, and Jobicy's
 * apply_url is its own feed url because their terms require exactly that. Only Himalayas publishes
 * an employer application link. So the never-merge rule above carries the attribution guarantee,
 * and the winner is chosen on usefulness: LinkedIn first because it is the only source aimed at
 * Sweden and its url is the employer's own posting, Himalayas next because its apply_url does reach
 * the employer, then the remaining boards, then Indeed last because its field map is still
 * unverified. It is one constant and one line to reorder.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. THE CAP IS HERE, NOT IN Filter, AND A CAPPED RUN MUST NOT ADVANCE last_run_at.
 * ---------------------------------------------------------------------------------------------
 * max_scored_per_run caps what reaches the scorer, and this node is the last thing before it, so
 * capping earlier would spend the slots on rows that are about to be removed as known.
 *
 * ---------------------------------------------------------------------------------------------
 * 3b. THE CAP IS COUPLED TO WHAT THE DETAIL FETCH CAN AFFORD (added 2026-09-12, execution 5182).
 * ---------------------------------------------------------------------------------------------
 * THE PRINCIPLE, and it is the whole reason this block exists: A JOB SCORED ON ITS TITLE IS WORTH
 * MUCH LESS THAN A JOB NOT YET SEEN, SO NEVER KEEP MORE JOBS THAN YOU CAN DESCRIBE. A row kept
 * without a description is scored on its title once and never enriched, because it is written this
 * run and `Remove Known` deletes it as known next run. A row the cap holds back is written nowhere,
 * `advance_last_run_at_safe` goes false, and the next run collects it properly. Holding a row back
 * costs a day; keeping it undescribed costs it permanently.
 *
 * MEASURED, execution 5182: the search leg spent 20 of the 25 whole-run LinkedIn calls, so the
 * detail stage could make 5. The cap kept 20 rows. FIFTEEN of them went to the scorer with nothing
 * but a title, permanently. The cap was doing exactly what it was told and the allocation was wrong.
 *
 * So the cap this node applies is the LESSER of Shaheen's ceiling and what can be enriched:
 *   describable   = min(linkedin_detail_max_calls_per_run, linkedin_total_max_calls_per_run - what
 *                       the search leg ACTUALLY spent)
 *   effective cap = min(max_scored_per_run, describable + the rows that need no description)
 * The second term matters: a board row publishes its own description and costs zero LinkedIn calls,
 * so the budget must not cap it. Rows are still taken NEWEST FIRST; a LinkedIn row the budget cannot
 * describe is stepped over and deferred, and a board row behind it is still taken.
 *
 * THE ONE EXCEPTION, and it is deliberate: WHEN NOTHING AT ALL CAN BE DESCRIBED THE COUPLING SWITCHES
 * OFF and the cap goes back to max_scored_per_run. That happens when the detail source is switched
 * off in the settings tab, or when the search plan alone exceeds the whole-run budget. Without the
 * exception the effective cap would be zero, no row would ever be written, the cap would bite every
 * run, the window would never advance, and the lane would emit nothing forever. Partial starvation is
 * the failure this block fixes; total unavailability is a different failure and it must not shut the
 * lane down. It is warned about in the loudest terms the report has.
 *
 * WHAT THE SEARCH LEG SPENT is read off the LinkedIn `source_report`, which is in this stream, by
 * exactly the rule `33-detail-gate.js` uses on the same field: a missing number is priced at the FULL
 * search ceiling, never at zero. That report publishes the whole budget block so the detail gate can
 * cross-check its own arithmetic against it; the two computing the same number independently and
 * comparing is what stops them drifting apart silently.
 *
 * The cap is a CAP, not a filter: the rows it removes are real, wanted and not written anywhere. On
 * a normal day it never fires. Measured over the six live board captures, 515 rows: the title rules
 * take the BI lane to 7 rows and the window takes it to 1. The run where it DOES fire is the first
 * one, whose window is a 168 hour backfill, and that is also the run where losing rows costs most.
 *
 * So the report carries `advance_last_run_at_safe`. When the cap bit, it is FALSE, and Stage F must
 * leave last_run_at alone. Then the next run sees the same window, Remove Known deletes the rows
 * already written, and the next twenty come through. The backlog drains twenty a run until the cap
 * stops firing and the window finally moves. That reuses the self-healing property this lane
 * already depends on for a degraded source, and it is the reason the cap cannot live in Filter: cap
 * before the known rows are removed, and the second run caps to the same twenty, removes all
 * twenty, and emits nothing, forever.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. THE STREAM CONTRACT.
 * ---------------------------------------------------------------------------------------------
 * `$input` is the SHEET, not the jobs: Read Known Jobs replaces the stream. The jobs and the
 * reports are read back from `$('Filter')`.
 * OUT: the surviving jobs, EVERY source_report untouched, the Filter stage report untouched, and
 * one more `_kind: 'stage_report'` for this node. The reports are never filtered, never deduped and
 * never capped; Stage F needs all of them to write the run verdict.
 */

const fs = require('fs');
const path = require('path');
const { lane, sources, pagingDefaults, settingsSchema } = require('./_lane');
const L = lane();
const CONTRACT = sources();
const PD = pagingDefaults().values;

// The two sources this node's budget arithmetic is about.
const SEARCH_KEY = 'linkedin_guest_search';
const DETAIL_KEY = 'linkedin_guest_detail';

// THE CLAMPS ARE READ OUT OF 33-detail-gate.js RATHER THAN DECLARED HERE, and the mechanism is a
// file read rather than a require ON PURPOSE: 33 requires THIS file, so requiring it back would be a
// cycle. Two nodes now compute the same detail budget, and if they clamped it differently they would
// disagree about how many rows can be described while both looking correct. Same discipline the page
// guard applies to the card regex, for the same reason: one definition, read, never retyped.
const DETAIL_GATE_SRC = fs.readFileSync(path.join(__dirname, '33-detail-gate.js'), 'utf8');
function clampFromDetailGate(name) {
  const m = new RegExp('const ' + name + ' = (\\d+);').exec(DETAIL_GATE_SRC);
  if (!m) {
    throw new Error(
      'Remove Known: could not read ' + name + ' out of 33-detail-gate.js.\n' +
      '  This node caps the row count by what the detail stage can afford, and it must clamp that\n' +
      '  budget with the SAME bound the detail stage clamps it with. Declaring a second copy here is\n' +
      '  the wrong fix: two definitions is how the row cap and the fetch budget drift apart while both\n' +
      '  nodes report a number that looks right.'
    );
  }
  return Number(m[1]);
}
const HARD_MAX_DETAIL_CALLS = clampFromDetailGate('HARD_MAX_DETAIL_CALLS');
const HARD_MAX_TOTAL_CALLS = clampFromDetailGate('HARD_MAX_TOTAL_CALLS');

// Which row survives when the same job arrives from several sources. Every source in the contract
// must appear, so a new source fails this build until somebody decides where it ranks rather than
// silently landing at the bottom.
const SOURCE_PRIORITY = [
  'linkedin_guest_search',
  'linkedin_guest_detail',
  'himalayas',
  'remoteok',
  'remotive',
  'workingnomads',
  'jobicy',
  'arbeitnow',
  'brightdata_indeed',
];

// Legal-form suffixes stripped from a company name before comparing. Only unambiguous legal forms:
// `group`, `holding`, `company` and `international` are deliberately NOT here, because they are
// part of real names and stripping them would collapse two different employers into one.
const LEGAL_SUFFIXES = [
  'ab', 'abp', 'asa', 'as', 'oy', 'oyj', 'gmbh', 'mbh', 'ag', 'kg', 'ltd', 'limited', 'inc',
  'incorporated', 'llc', 'llp', 'lp', 'plc', 'bv', 'nv', 'sa', 'sas', 'sarl', 'srl', 'spa', 'aps',
  'kft', 'pte', 'pty', 'corp', 'corporation',
];

// How far back a company+title match against the SHEET is trusted. Beyond this a company posting
// the same title again is treated as a new job rather than as one he has already seen, because a
// role genuinely does reopen. Exact job_id matches are never time-bounded: an id is an id.
const CT_LOOKBACK_DAYS = 45;

(function assertAgainstContract() {
  const srcKeys = Object.keys(CONTRACT.sources);
  const missing = srcKeys.filter((k) => SOURCE_PRIORITY.indexOf(k) === -1);
  const extra = SOURCE_PRIORITY.filter((k) => srcKeys.indexOf(k) === -1);
  if (missing.length || extra.length) {
    throw new Error(
      'Remove Known: the dedupe priority and the source contract disagree.\n' +
      (missing.length ? '  sources with no declared priority: ' + missing.join(', ') + '\n' : '') +
      (extra.length ? '  priorities for sources that do not exist: ' + extra.join(', ') + '\n' : '') +
      '  Every source needs a rank, because when two of them carry the same job this list decides\n' +
      '  which row Shaheen actually gets, and an unranked source would quietly always lose.'
    );
  }
  const dupe = SOURCE_PRIORITY.find((k, i) => SOURCE_PRIORITY.indexOf(k) !== i);
  if (dupe) throw new Error('Remove Known: ' + dupe + ' appears twice in the dedupe priority.');

  // The fields the never-merge rule protects have to still EXIST on the row. Since 2026-09-17 that is
  // not the same as being a sheet column: apply_url lost its column in the trim and is declared in
  // internal_only_fields, so it still travels with its row and this guard still has something to
  // protect. `url` is unchanged and is the link the attribution obligations are actually satisfied by.
  const rowFields = CONTRACT.shared_row_shape
    .concat(Object.keys(CONTRACT.internal_only_fields || {}).filter(function (k) { return k[0] !== '_'; }));
  for (const f of ['source', 'url', 'apply_url', 'job_id', 'company', 'title', 'posted_at']) {
    if (rowFields.indexOf(f) === -1) {
      throw new Error(
        'Remove Known: the contract carries no ' + f + ' field, as a column or as internal.\n' +
        '  This node dedupes on it or guarantees it travels with its own row, and four of these boards\n' +
        '  make the link a condition of API access rather than a courtesy. Dropping a COLUMN is fine and\n' +
        '  happened on 2026-09-17; dropping the FIELD is what this refuses.'
      );
    }
  }

  // Attribution: a source the contract binds must still publish both links, or the never-merge
  // guarantee has nothing to preserve.
  const bound = Object.keys(CONTRACT.attribution_obligations || {}).filter((k) => k !== '_why');
  if (!bound.length) {
    throw new Error('Remove Known: the contract lists no attribution obligations at all. Three of these boards make attribution a condition of access, so an empty list means the contract was truncated.');
  }
  for (const k of bound) {
    if (srcKeys.indexOf(k) === -1) throw new Error('Remove Known: attribution_obligations names ' + k + ', which is not a source in the contract.');
  }

  // The upstream node this one reads back from, by name, asserted rather than remembered.
  const filterName = require('./20-filter.js').name;
  if (filterName !== 'Filter') {
    throw new Error('Remove Known: node 20 is named ' + JSON.stringify(filterName) + ', and this node reads $(\'Filter\'). Node names are the reference key; rename both in the same edit.');
  }
  const readName = require('./21-read-known-jobs.js');
  if (readName.alwaysOutputData !== true) {
    throw new Error('Remove Known: Read Known Jobs no longer sets alwaysOutputData. Without it an empty sheet emits nothing, this node never runs, and the source reports die with it.');
  }
  if (readName.onError !== 'continueRegularOutput') {
    throw new Error('Remove Known: Read Known Jobs no longer sets onError continueRegularOutput. Without it a failed read stops the workflow and throws away every source report, and this node never gets to refuse the run.');
  }
  if (readName.executeOnce !== true) {
    throw new Error('Remove Known: Read Known Jobs no longer sets executeOnce. Without it the tab is read once per input item.');
  }

  // --- the budget coupling (3b) ---------------------------------------------------------------
  for (const k of [SEARCH_KEY, DETAIL_KEY]) {
    if (!CONTRACT.sources[k]) {
      throw new Error('Remove Known: the shared contract has no source called ' + k + ', and the row cap is coupled to what that source costs. It carries: ' + srcKeys.join(', '));
    }
  }
  const SC = settingsSchema();
  for (const k of ['linkedin_detail_max_calls_per_run', 'linkedin_total_max_calls_per_run', 'linkedin_max_calls_per_run']) {
    if (SC.optional_number.indexOf(k) === -1) {
      throw new Error('Remove Known: ' + k + ' is not an optional number in the settings schema, so the cap this node applies could never be tuned to match the budget the detail stage actually gets.');
    }
  }
  if (SC.switch.indexOf('source_' + DETAIL_KEY) === -1) {
    throw new Error('Remove Known: source_' + DETAIL_KEY + ' is not a switch in the settings schema. This node reads it to decide whether there is any enrichment to protect at all, and a cap coupled to a fetch that is switched off would hold rows back for no reason.');
  }
  if (!(HARD_MAX_DETAIL_CALLS > 0) || !(HARD_MAX_TOTAL_CALLS > 0)) {
    throw new Error('Remove Known: a clamp read out of 33-detail-gate.js is not a positive number (' + HARD_MAX_DETAIL_CALLS + ', ' + HARD_MAX_TOTAL_CALLS + ').');
  }
  if (typeof PD.linkedin_detail_max_calls_per_run !== 'number' || typeof PD.linkedin_total_max_calls_per_run !== 'number') {
    throw new Error('Remove Known: the shipped paging defaults no longer carry both detail caps, so a run whose settings tab has neither row would have no budget to couple the cap to.');
  }
  // The field the coupling reads off the search report. If the collector stopped publishing it, this
  // node would price the search leg at its ceiling on EVERY run and the cap would collapse silently.
  const extractSrc = String(require('./08-extract-linkedin.js').parameters.jsCode || '');
  if (extractSrc.indexOf('calls_made:') === -1) {
    throw new Error(
      'Remove Known: 08-extract-linkedin.js no longer publishes calls_made on its source_report.\n' +
      '  The row cap is the lesser of max_scored_per_run and what the detail stage can afford, and the\n' +
      '  detail stage can only afford what the SEARCH leg did not spend. With no calls_made the search\n' +
      '  leg is priced at its full ceiling on every run, which is the safe direction and a permanently\n' +
      '  smaller cap that nothing would explain.'
    );
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Remove Known. Sheet gate, cross-source dedupe, known removal, cap.
// ---------------------------------------------------------------------------
const sheetItems = $input.all();

let upstream;
try {
  upstream = $('Filter').all().map((i) => i.json);
} catch (e) {
  throw new Error('Remove Known: cannot reach Filter (' + e.message + '). The jobs and every source report live there, because Read Known Jobs replaces the stream with the sheet.');
}

const jobs = upstream.filter((j) => j && j._kind === 'job');
const passThrough = upstream.filter((j) => j && (j._kind === 'source_report' || j._kind === 'stage_report'));
const filterReport = upstream.find((j) => j && j._kind === 'stage_report' && j.stage === 'filter') || null;

const run = (filterReport && {
  run_started_at: filterReport.run_started_at,
  window_start: filterReport.window_start,
  window_end: filterReport.window_end,
  first_run: filterReport.first_run,
}) || {};
const CAP = filterReport && filterReport.cap && isFinite(Number(filterReport.cap.max_scored_per_run))
  ? Number(filterReport.cap.max_scored_per_run)
  : null;
if (CAP === null) {
  throw new Error('Remove Known: no usable max_scored_per_run reached this node. It rides on the Filter stage report, which is also how the reports reach Stage F. Running with no cap would send an unbounded number of jobs to a paid scorer.');
}

// --- 1. the sheet gate -------------------------------------------------------
const ROW_SHAPE = SHARED_ROW_SHAPE;
function looksLikeRow(j) {
  if (!j || typeof j !== 'object') return false;
  return Object.prototype.hasOwnProperty.call(j, 'job_id') && String(j.job_id === undefined || j.job_id === null ? '' : j.job_id).trim() !== '';
}
function isBlank(j) {
  if (!j || typeof j !== 'object') return true;
  const keys = Object.keys(j);
  if (!keys.length) return true;
  return keys.every((k) => j[k] === null || j[k] === undefined || String(j[k]).trim() === '');
}

const sheetJson = sheetItems.map((i) => (i && i.json) || {});
const errored = sheetJson.filter((j) => j && j.error !== undefined && j.error !== null);
const realRows = sheetJson.filter(looksLikeRow);
const blanks = sheetJson.filter(isBlank);

let sheetOutcome;
let sheetReason;
if (errored.length) {
  sheetOutcome = 'failed';
  const first = errored[0].error;
  sheetReason = 'Read Known Jobs returned an error item: ' +
    JSON.stringify(typeof first === 'string' ? first.slice(0, 200) : String((first && first.message) || first).slice(0, 200)) +
    '. This is NOT an empty sheet, and treating it as one would re-write every job already in it.';
} else if (!sheetJson.length) {
  sheetOutcome = 'no_output';
  sheetReason = 'Read Known Jobs produced no output item at all. alwaysOutputData is set on that node precisely so an empty sheet still emits one item, so zero items means the flag is gone or the node did not run. Either way it is not evidence that the sheet is empty.';
} else if (realRows.length) {
  sheetOutcome = 'ok';
  sheetReason = null;
} else if (blanks.length === sheetJson.length) {
  sheetOutcome = 'empty';
  sheetReason = 'the jobs tab holds its header and no data rows. Expected on a first run.';
} else {
  sheetOutcome = 'wrong_shape';
  sheetReason = 'the read returned ' + sheetJson.length + ' item(s) with data and NOT ONE of them carries a job_id. ' +
    'That is a successful read of the wrong tab, which is the one failure here that returns a 200 and looks healthy. ' +
    'Keys seen: ' + JSON.stringify(Object.keys(sheetJson[0] || {}).slice(0, 12)) + '.';
}

const sheetUsable = sheetOutcome === 'ok' || sheetOutcome === 'empty';

// --- text normalisers --------------------------------------------------------
function fold(s) {
  let out = String(s === null || s === undefined ? '' : s);
  try { out = out.normalize('NFD').replace(/[\\u0300-\\u036f]/g, ''); } catch (e) { /* standard JS; the raw string still compares */ }
  return out.replace(/\\u00F8/g, 'o').replace(/\\u00E6/g, 'ae').replace(/\\u00DF/g, 'ss');
}
function normCompany(s) {
  let x = fold(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = x.split(' ');
    const last = parts[parts.length - 1];
    if (parts.length > 1 && LEGAL_SUFFIXES.indexOf(last) !== -1) { parts.pop(); x = parts.join(' '); } else break;
  }
  return x;
}
function normTitle(s) {
  // Nothing is REMOVED here beyond punctuation. Stripping a parenthetical would collapse the same
  // title in two different cities into one row, and losing a job is the expensive direction.
  return fold(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function ctKey(row) {
  const c = normCompany(row.company);
  const t = normTitle(row.title);
  if (!c || !t) return null;
  return c + '||' + t;
}
function nonNullFields(row) {
  let n = 0;
  for (const k of ROW_SHAPE) if (row[k] !== null && row[k] !== undefined && String(row[k]) !== '') n += 1;
  return n;
}
function rank(src) {
  const i = SOURCE_PRIORITY.indexOf(src);
  return i === -1 ? SOURCE_PRIORITY.length : i;
}

// --- 2. dedupe inside this run ----------------------------------------------
const dedupe = {
  jobs_in: jobs.length,
  same_id_collapsed: 0,
  cross_source_collapsed: 0,
  ambiguous_groups: 0,
  ambiguous_samples: [],
  collapse_samples: [],
  winner_by_source: {},
};

// Pass A: exact job_id. Same id is the same job by the contract's own dedup rule.
const byId = new Map();
for (const j of jobs) {
  const id = String(j.job_id === null || j.job_id === undefined ? '' : j.job_id);
  if (!id) continue;
  if (!byId.has(id)) byId.set(id, j);
  else dedupe.same_id_collapsed += 1;
}
const noId = jobs.filter((j) => !String(j.job_id === null || j.job_id === undefined ? '' : j.job_id));
let survivors = Array.from(byId.values()).concat(noId);

// Pass B: normalised company + title, ACROSS different sources only.
const groups = new Map();
for (const j of survivors) {
  const k = ctKey(j);
  if (!k) continue;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(j);
}
const losers = new Set();
for (const [k, group] of groups) {
  if (group.length < 2) continue;
  const perSource = {};
  for (const g of group) perSource[g.source] = (perSource[g.source] || 0) + 1;
  const sourceCount = Object.keys(perSource).length;
  const anyDoubled = Object.keys(perSource).some((s) => perSource[s] > 1);
  if (sourceCount < 2 || anyDoubled) {
    // One source with several identically titled postings, or a mixed group where one source
    // contributes more than one. Either way which row pairs with which is unknowable, so the group
    // is left WHOLE. Reported, never half-collapsed.
    dedupe.ambiguous_groups += 1;
    if (dedupe.ambiguous_samples.length < 5) {
      dedupe.ambiguous_samples.push({ key: k, rows: group.map((g) => ({ job_id: g.job_id, source: g.source })) });
    }
    continue;
  }
  const ordered = group.slice().sort((a, b) => {
    const r = rank(a.source) - rank(b.source);
    if (r !== 0) return r;
    const n = nonNullFields(b) - nonNullFields(a);
    if (n !== 0) return n;
    return String(a.job_id).localeCompare(String(b.job_id));
  });
  const winner = ordered[0];
  const beaten = ordered.slice(1);
  // NOTHING IS MERGED. The winner is passed on exactly as its own collector built it, so its
  // source, url and apply_url agree with each other and its own attribution obligation is the one
  // that travels. Only a provenance note is added.
  winner._filter = Object.assign({}, winner._filter, {
    collapsed_from: beaten.map((b) => ({ job_id: b.job_id, source: b.source, url: b.url })),
    collapsed_on: 'company + title, across sources',
  });
  dedupe.cross_source_collapsed += beaten.length;
  dedupe.winner_by_source[winner.source] = (dedupe.winner_by_source[winner.source] || 0) + 1;
  if (dedupe.collapse_samples.length < 5) {
    dedupe.collapse_samples.push({ kept: { job_id: winner.job_id, source: winner.source }, dropped: beaten.map((b) => ({ job_id: b.job_id, source: b.source })) });
  }
  for (const b of beaten) losers.add(b);
}
survivors = survivors.filter((j) => !losers.has(j));

// --- 3. what is already in the sheet ----------------------------------------
const known = {
  sheet_rows: realRows.length,
  by_id: 0,
  by_company_title: 0,
  lookback_days: CT_LOOKBACK_DAYS,
  samples: [],
};
const knownIds = new Set();
const knownCt = new Map();
if (sheetOutcome === 'ok') {
  const cutoff = Date.now() - CT_LOOKBACK_DAYS * 86400000;
  for (const r of realRows) {
    knownIds.add(String(r.job_id).trim());
    const k = ctKey(r);
    if (!k) continue;
    const stamp = Date.parse(String(r.found_at || r.posted_at || ''));
    const fresh = !isFinite(stamp) ? false : stamp >= cutoff;
    if (!fresh) continue;
    if (!knownCt.has(k)) knownCt.set(k, new Set());
    knownCt.get(k).add(String(r.source || ''));
  }
}

const fresh = [];
for (const j of survivors) {
  const id = String(j.job_id === null || j.job_id === undefined ? '' : j.job_id).trim();
  if (id && knownIds.has(id)) {
    known.by_id += 1;
    continue;
  }
  const k = ctKey(j);
  if (k && knownCt.has(k)) {
    // Only across sources. The same source re-listing the same title is that source's own business
    // and its id is what decides; a cross-source match is the case this exists for, where a job the
    // sheet already holds under a LinkedIn id arrives days later from a slower board.
    const others = Array.from(knownCt.get(k)).filter((s) => s && s !== String(j.source || ''));
    if (others.length) {
      known.by_company_title += 1;
      if (known.samples.length < 5) known.samples.push({ job_id: j.job_id, source: j.source, already_in_sheet_from: others });
      continue;
    }
  }
  fresh.push(j);
}

// --- 4. newest first, then the cap ------------------------------------------
// Sorted on the DAY first, which is the only comparison both date shapes support honestly: a bare
// LinkedIn date became midnight UTC in Filter and that midnight is a convention, not a measurement.
// Inside a day a real timestamp therefore outranks a day-only one, which is stated rather than
// discovered. An undated row sorts LAST of everything, explicitly, never by falling to one end.
function dayOf(r) { return r.posted_at ? String(r.posted_at).slice(0, 10) : null; }
fresh.sort((a, b) => {
  const da = dayOf(a);
  const db = dayOf(b);
  if (da === null && db === null) return String(a.source).localeCompare(String(b.source)) || String(a.job_id).localeCompare(String(b.job_id));
  if (da === null) return 1;
  if (db === null) return -1;
  if (da !== db) return db.localeCompare(da);
  const ma = Date.parse(a.posted_at);
  const mb = Date.parse(b.posted_at);
  if (isFinite(ma) && isFinite(mb) && ma !== mb) return mb - ma;
  return String(a.source).localeCompare(String(b.source)) || String(a.job_id).localeCompare(String(b.job_id));
});

// --- 4b. the LinkedIn detail budget, and the effective cap -------------------
// NEVER KEEP MORE JOBS THAN YOU CAN DESCRIBE. A row kept without a description is scored on its
// title ONCE and never enriched, because it is written this run and this node deletes it as known
// next run. A row held back here is written nowhere, the window is held, and the next run collects
// it properly. Holding a row back costs a day. Keeping it undescribed costs it permanently.
const budgetClamped = [];
let budgetProblem = null;

// The two caps, resolved by Plan Queries from the settings tab, then lane.json, then the shipped
// default. Read from there and nowhere else, so a cap is decided in one place and quoted in one.
let capsIn = {};
let capSrc = {};
let searchCeiling = null;
try {
  const planned = $('Plan Queries').all().map(function (i) { return i.json; });
  const P = ((planned[0] && planned[0].run) || {}).paging || {};
  capsIn = P.caps || {};
  capSrc = P.caps_source || {};
  if (typeof capsIn.linkedin_max_calls_per_run === 'number') searchCeiling = capsIn.linkedin_max_calls_per_run;
} catch (e) {
  budgetProblem = 'cannot reach Plan Queries (' + e.message + '), so the resolved LinkedIn call caps are unknown';
}
function budgetCap(name, hard, fallback) {
  let v = capsIn[name];
  let from = capSrc[name] || 'missing';
  if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v < 1) {
    budgetClamped.push({ cap: name, was: v === undefined ? null : v, now: fallback, why: 'not a whole number of 1 or more, so the shipped fallback applies' });
    v = fallback;
    from = 'fallback in Remove Known';
  }
  if (v > hard) {
    budgetClamped.push({ cap: name, was: v, now: hard, why: 'above the hard clamp read out of 33-detail-gate.js, which no settings cell can raise' });
    v = hard;
    from = from + ', clamped';
  }
  return { value: v, from: from };
}
const detailStageCap = budgetCap('linkedin_detail_max_calls_per_run', HARD_MAX_DETAIL_CALLS, DEFAULT_DETAIL_CALLS);
const totalCap = budgetCap('linkedin_total_max_calls_per_run', HARD_MAX_TOTAL_CALLS, DEFAULT_TOTAL_CALLS);

// The detail switch. Unreadable is treated as OFF, which switches the coupling off and keeps the
// ceiling: a cap that holds rows back to protect descriptions nobody is fetching is pure loss.
let detailOn = false;
try {
  const cfgItems = $('Parse Settings').all().map(function (i) { return i.json; });
  const cfg = {};
  for (const c of cfgItems) if (c && typeof c === 'object') Object.assign(cfg, c);
  if (typeof cfg['source_' + DETAIL_KEY] === 'boolean') detailOn = cfg['source_' + DETAIL_KEY];
  else if (!budgetProblem) budgetProblem = 'source_' + DETAIL_KEY + ' decoded to ' + JSON.stringify(cfg['source_' + DETAIL_KEY]) + ', not a boolean';
} catch (e) {
  if (!budgetProblem) budgetProblem = 'cannot reach Parse Settings (' + e.message + '), so the detail source switch is unknown';
}

// What the search leg ACTUALLY spent, by the same rule 33-detail-gate.js uses on the same field. A
// missing number is priced at the FULL ceiling, never at zero: a budget that guesses low on missing
// evidence hands out calls that are already gone.
let searchCalls;
let searchCallsFrom;
const searchReport = passThrough.filter(function (j) { return j._kind === 'source_report' && j.source === SEARCH_KEY; })[0] || null;
if (searchReport && typeof searchReport.calls_made === 'number' && isFinite(searchReport.calls_made) && searchReport.calls_made >= 0) {
  searchCalls = searchReport.calls_made;
  searchCallsFrom = 'the ' + SEARCH_KEY + ' source_report';
} else if (searchReport && searchReport.verdict === 'disabled') {
  searchCalls = 0;
  searchCallsFrom = 'the ' + SEARCH_KEY + ' source is switched off, so its leg cost zero calls';
} else {
  searchCalls = (typeof searchCeiling === 'number' && searchCeiling > 0) ? searchCeiling : totalCap.value;
  searchCallsFrom = 'ASSUMED: no usable calls_made on a ' + SEARCH_KEY + ' source_report, so the search leg is priced at its full ceiling (' + searchCalls + ')';
}

const remainingTotal = Math.max(0, totalCap.value - searchCalls);
const detailBudget = Math.min(detailStageCap.value, remainingTotal);
const describable = detailOn ? detailBudget : 0;

// A row needs a description when it came from the LinkedIn SEARCH endpoint and carries none. That is
// the detail gate's own predicate. Every other row publishes its own description and costs nothing.
function needsDetail(r) {
  if (String(r.source || '') !== SEARCH_KEY) return false;
  return String(r.excerpt === null || r.excerpt === undefined ? '' : r.excerpt).trim() === '';
}
const needCount = fresh.filter(needsDetail).length;
const noDetailCount = fresh.length - needCount;

// THE EXCEPTION. Nothing describable at all means there is no enrichment to protect, so the coupling
// switches OFF and the ceiling applies as before. Without it the effective cap would be zero, no row
// would ever be written, the cap would bite every run, the window would never advance and the lane
// would emit nothing forever.
const couplingOn = describable > 0;
const effectiveCap = couplingOn ? Math.min(CAP, describable + noDetailCount) : CAP;
let capFrom;
if (!couplingOn) capFrom = 'max_scored_per_run';
else if (effectiveCap >= CAP) capFrom = 'max_scored_per_run';
else if (detailStageCap.value <= remainingTotal) capFrom = 'linkedin_detail_max_calls_per_run';
else capFrom = 'linkedin_total_max_calls_per_run minus the ' + searchCalls + ' call(s) the search leg spent';

// --- 4c. take rows, newest first ---------------------------------------------
// A LinkedIn row the budget cannot describe is STEPPED OVER, not stopped at: a board row behind it
// costs no LinkedIn call and there is no reason to defer it too.
let out = [];
let describeLeft = describable;
if (sheetUsable) {
  for (const r of fresh) {
    if (out.length >= CAP) break;
    if (needsDetail(r)) {
      if (couplingOn && describeLeft <= 0) continue;
      describeLeft -= 1;
    }
    out.push(r);
  }
}
const capped = sheetUsable ? fresh.length - out.length : 0;
// THE COST OF THE COUPLING, and it is deliberately NOT the number of rows the walk stepped over.
// Most of those were going to be dropped by max_scored_per_run anyway, and counting them would tell
// Shaheen the coupling cost him thirty rows when it cost him ten. This is the honest number: how
// many MORE rows this run would have kept under the old rule.
const deferredNoDescription = sheetUsable ? Math.max(0, Math.min(fresh.length, CAP) - out.length) : 0;

// --- 5. the stage report -----------------------------------------------------
const warnings = [];
let statusToken = null;
if (!sheetUsable) {
  statusToken = 'stage_down:remove_known';
  warnings.push(
    'THE JOBS TAB COULD NOT BE READ (' + sheetOutcome + ') so this run writes NO job rows. ' + sheetReason +
    ' Nothing is lost: last_run_at must not advance, so the next run covers the same window and the ' +
    (survivors.length) + ' row(s) held back here come through then.'
  );
}
if (capped > 0) {
  warnings.push(
    'THE CAP BIT. ' + fresh.length + ' new job(s) survived and this run could keep ' + effectiveCap +
    ' (max_scored_per_run is ' + CAP + '; the binding limit was ' + capFrom + '), so ' + capped +
    ' real, wanted row(s) were held back. They are not written anywhere, so a capped run must NOT advance ' +
    'last_run_at: leave it alone and the next run sees the same window, Remove Known deletes the ' + out.length +
    ' rows this run wrote, and the next ' + effectiveCap + ' come through. The backlog drains ' + effectiveCap + ' a run. ' +
    'A capped run is the opposite of a quiet one and this line is how it says so.'
  );
}
if (couplingOn && effectiveCap < CAP) {
  warnings.push(
    'THE ROW CAP WAS CUT TO ' + effectiveCap + ' FROM ' + CAP + ' BECAUSE THAT IS ALL THIS RUN CAN DESCRIBE. ' +
    'The whole-run LinkedIn budget is ' + totalCap.value + ' call(s) (' + totalCap.from + '), the search leg already spent ' +
    searchCalls + ' (' + searchCallsFrom + ') and the per-stage cap is ' + detailStageCap.value + ' (' + detailStageCap.from +
    '), so the detail stage can make ' + describable + ' call(s). ' + deferredNoDescription + ' LinkedIn row(s) were DEFERRED ' +
    'to the next run rather than kept with no description: a kept row is scored on its title once and never enriched, ' +
    'because it is written this run and Remove Known deletes it as known next run, while a deferred row costs a day and ' +
    'nothing else. Raise ' + capFrom.split(' ')[0] + ' in the settings tab to keep more, and read the D20 note in the ' +
    'source contract first, because nobody has measured this box past 25 LinkedIn calls in a run.'
  );
}
if (!couplingOn) {
  warnings.push(
    'THE ROW CAP IS NOT COUPLED TO THE DETAIL BUDGET ON THIS RUN, so up to ' + CAP + ' row(s) can be scored on their ' +
    'titles alone. ' + (detailOn
      ? 'The detail source is ON but the budget left for it is ' + detailBudget + ': the whole-run LinkedIn budget is ' +
        totalCap.value + ' and the search leg spent ' + searchCalls + ' (' + searchCallsFrom + '). That is the search plan ' +
        'eating the entire budget, and it is worth fixing rather than living with.'
      : 'source_' + DETAIL_KEY + ' is off in the settings tab, so there is no enrichment to protect. This is a setting, not a fault.') +
    ' The coupling switches off rather than capping to zero on purpose: a cap of zero would write no rows, bite every run, ' +
    'hold the window forever and emit nothing.'
  );
}
if (budgetProblem !== null) {
  warnings.push(
    'THE ROW CAP COULD NOT READ ITS OWN BUDGET INPUTS (' + budgetProblem + '). The search leg was priced at ' + searchCalls +
    ' call(s) and the detail source was treated as ' + (detailOn ? 'on' : 'off') + '. That is the safe direction in both ' +
    'cases and it is stated rather than inferred, but the numbers in the cap block below were computed against a guess.'
  );
}
if (budgetClamped.length) {
  warnings.push(
    'A LINKEDIN CALL CAP WAS CLAMPED IN CODE while computing the row cap: ' +
    budgetClamped.map(function (c) { return c.cap + ' ' + JSON.stringify(c.was) + ' -> ' + c.now + ' (' + c.why + ')'; }).join('; ') +
    '. The settings tab is hand editable and this is the bound it cannot raise.'
  );
}
if (dedupe.ambiguous_groups > 0) {
  warnings.push(
    dedupe.ambiguous_groups + ' company+title group(s) were left UNCOLLAPSED because one source contributed more ' +
    'than one row to them, so which row pairs with which is unknowable. They may be genuine duplicates and they may ' +
    'be a company posting the same title twice. Left whole on purpose: collapsing the wrong pair loses a real job.'
  );
}
if (sheetOutcome === 'ok' && realRows.length > 5000) {
  warnings.push(
    'the jobs tab now holds ' + realRows.length + ' rows and Read Known Jobs reads all of them every run. ' +
    'That is still fine and it grows forever. The fix when it stops being fine is a bounded range or an index tab, ' +
    'never a narrower filter.'
  );
}
if (sheetOutcome === 'empty' && jobs.length > 0) {
  warnings.push('the jobs tab is empty, so nothing was removed as known. Expected on the first run and on no other run.');
}

const report = {
  _kind: 'stage_report',
  stage: 'remove_known',
  lane: LANE_NUMBER,
  run_started_at: run.run_started_at || null,
  window_start: run.window_start || null,
  window_end: run.window_end || null,
  first_run: run.first_run === true,
  verdict: sheetUsable ? 'ok' : 'down',
  status_token: statusToken,
  sheet: {
    outcome: sheetOutcome,
    reason: sheetReason,
    items_received: sheetJson.length,
    rows_with_a_job_id: realRows.length,
    blank_items: blanks.length,
    error_items: errored.length,
    tab: SHEET_TAB,
  },
  dedupe: dedupe,
  known: known,
  cap: {
    max_scored_per_run: CAP,
    effective_cap: effectiveCap,
    effective_cap_from: capFrom,
    new_rows_before_cap: fresh.length,
    dropped_by_cap: capped,
    dropped_for_no_description: deferredNoDescription,
    bit: capped > 0,
    // Published so 33-detail-gate.js can cross-check its own arithmetic against it. Two nodes
    // computing the same budget independently and comparing is what stops them drifting apart.
    coupling: {
      applied: couplingOn,
      rule: 'never keep more jobs than you can describe: a row kept with no description is scored on its title once and never enriched, while a row held back is collected properly next run',
      exception: couplingOn ? null : 'nothing at all can be described on this run, so the coupling is off and max_scored_per_run applies. Capping to zero instead would write no rows, bite every run and hold the window forever.',
      detail_switch_on: detailOn,
      rows_needing_a_description: needCount,
      rows_needing_none: noDetailCount,
      describable_rows: describable,
      detail_budget: detailBudget,
      whole_run_linkedin_calls: totalCap.value,
      whole_run_from: totalCap.from,
      per_stage_cap: detailStageCap.value,
      per_stage_from: detailStageCap.from,
      search_calls_already_made: searchCalls,
      search_calls_source: searchCallsFrom,
      left_for_detail: remainingTotal,
      hard_clamp_detail_calls: HARD_MAX_DETAIL_CALLS,
      hard_clamp_total_calls: HARD_MAX_TOTAL_CALLS,
      clamped: budgetClamped,
      config_problem: budgetProblem,
    },
  },
  rows_out: out.length,
  advance_last_run_at_safe: sheetUsable && capped === 0,
  advance_last_run_at_why: !sheetUsable
    ? 'the jobs tab could not be read, so nothing was written and the window has not actually been covered'
    : (capped > 0
      ? 'the cap held back ' + capped + ' real row(s) that are written nowhere' +
        (deferredNoDescription > 0 ? ', ' + deferredNoDescription + ' of them because this run could not describe them' : '') +
        '. Advancing the window would lose them permanently.'
      : 'every collected row was either written, already known, or deliberately filtered, so the window is genuinely covered. Stage F still has its own condition: no source reported degraded.'),
  attribution: {
    rule: 'nothing is ever merged across a collapse, so a surviving row keeps its own source, url and apply_url',
    obligations: ATTRIBUTION_OBLIGATIONS,
  },
  warnings: warnings,
};

// The reports go LAST and they always go, including on a refused sheet read, which is the run that
// most needs explaining. A Code node returning [] ends the branch and would delete all of it.
const rows = out.map((j) => ({ json: j, pairedItem: { item: 0 } }));
const carried = passThrough.map((j) => ({ json: j, pairedItem: { item: 0 } }));
return rows.concat(carried, [{ json: report, pairedItem: { item: 0 } }]);
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/22-remove-known.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const SOURCE_PRIORITY = ${JSON.stringify(SOURCE_PRIORITY)};`,
  `const LEGAL_SUFFIXES = ${JSON.stringify(LEGAL_SUFFIXES)};`,
  `const CT_LOOKBACK_DAYS = ${JSON.stringify(CT_LOOKBACK_DAYS)};`,
  `const SHARED_ROW_SHAPE = ${JSON.stringify(CONTRACT.shared_row_shape)};`,
  `const ATTRIBUTION_OBLIGATIONS = ${JSON.stringify(CONTRACT.attribution_obligations)};`,
  `const SHEET_TAB = ${JSON.stringify(L.sheet.tab)};`,
  `const LANE_NUMBER = ${JSON.stringify(String(L.lane))};`,
  `const SEARCH_KEY = ${JSON.stringify(SEARCH_KEY)};`,
  `const DETAIL_KEY = ${JSON.stringify(DETAIL_KEY)};`,
  `const HARD_MAX_DETAIL_CALLS = ${JSON.stringify(HARD_MAX_DETAIL_CALLS)};`,
  `const HARD_MAX_TOTAL_CALLS = ${JSON.stringify(HARD_MAX_TOTAL_CALLS)};`,
  `const DEFAULT_DETAIL_CALLS = ${JSON.stringify(PD.linkedin_detail_max_calls_per_run)};`,
  `const DEFAULT_TOTAL_CALLS = ${JSON.stringify(PD.linkedin_total_max_calls_per_run)};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Remove Known',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [4160, 160],
  connectFrom: 'Read Known Jobs',
  notes: 'Refuses a failed sheet read rather than reading it as an empty sheet, collapses the same job arriving from several sources without ever merging fields, drops what is already in the tab, then applies the EFFECTIVE cap newest first: the lesser of max_scored_per_run and what the LinkedIn detail budget can actually describe, because a row kept with no description is scored on its title once and never enriched while a row held back is collected properly next run. A capped run reports that last_run_at must not advance.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

'use strict';
/*
 * 16-extract-indeed-jobs.js - dataset rows in, shared-row-shape rows out, plus one honest report of
 * what this source did NOT give us.
 *
 * THE PROBLEM THIS NODE IS BUILT AROUND. Every other collector in this lane parses a surface somebody
 * actually looked at. This one does not: the Stage C probe could not run, because the Bright Data key
 * lives inside the n8n credential and nowhere else on this machine (contract:
 * brightdata_indeed.probe_attempted). So the snapshot envelope, every output field name, the date
 * field and the field carrying the Indeed jobkey are all unobserved.
 *
 * THE WRONG ANSWER WOULD BE TO PICK THE MOST LIKELY NAMES AND WRITE THEM IN. That produces a node
 * that returns zero rows the first time it runs against the real thing, reports an empty result, and
 * looks exactly like a quiet day. It is the same failure the LinkedIn extractor spends its whole
 * design avoiding, except here it would be guaranteed rather than possible.
 *
 * SO THE NODE HAS TWO MODES AND THE CONTRACT CHOOSES BETWEEN THEM.
 *   DISCOVERY MODE (probed false, output_fields null). Try the plausible envelope shapes and field
 *   names in a DECLARED order, and report BY NAME which one matched for every field. The first real
 *   run then hands back the contract edit instead of another guess, and a row that cannot be
 *   identified at all is a loud `shape_unknown`, never a silent zero.
 *   DECLARED MODE (probed true, output_fields filled). Use the contract's names and nothing else, and
 *   treat a missing declared field as a contract that lied, which is louder than discovery ever is.
 * The build REFUSES a contract whose flags and field names disagree, so the switch between the two
 * cannot be half thrown.
 *
 * WHAT IT CLASSIFIES, mirroring the LinkedIn extractor's five outcomes with one addition that only
 * exists because this source is the only asynchronous one:
 *   ok              a ready snapshot with rows that could be identified
 *   empty           a ready snapshot with zero rows. A real no-results.
 *   shape_unknown   a ready snapshot WITH rows that carry no recognisable job id. The Indeed
 *                   equivalent of markup_changed, and the same trap: rows arrived and produced
 *                   nothing, which a row count alone reads as an empty day.
 *   refused         the account or the key was refused, including the recorded "Customer is not
 *                   active" lapse
 *   timed_out       the poll guard hit a cap. A snapshot that never became ready. NEW here, and the
 *                   whole reason the guard exists.
 *   error           a trigger that never completed, a transport failure, or an unreadable response
 *
 * IT EMITS EXACTLY ONE source_report, ALWAYS, EVEN WITH ZERO ROWS, for the same reason the LinkedIn
 * one does: a Code node returning [] ends the branch, which would delete the evidence of precisely
 * the failure this node exists to report. A timed out run has no rows by definition, so returning
 * nothing would make the guard's whole verdict vanish.
 *
 * AND IT COSTS NOTHING WHEN INDEED IS OFF. With source_brightdata_indeed off, Plan Queries emits no
 * Indeed unit, the router sends nothing to output 0, and every node in this branch including this one
 * is SKIPPED by n8n, because a node with no input items never runs. So there is no report either, and
 * that is the one thing Stage F has to know: "off" and "ran and found nothing" are different, and
 * only Plan Queries' disabled_sources can tell them apart. Same finding Stage B recorded for
 * LinkedIn, same consequence.
 */

const { lane, sources } = require('./_lane');
const L = lane();
const CONTRACT = sources();
const SRC = CONTRACT.sources;

const SOURCE_KEY = 'brightdata_indeed';
const S = SRC[SOURCE_KEY];

const GUARD = require('./14-indeed-poll-guard.js');

// What this node fills and what it deliberately leaves for a later stage. Same split, and the same
// reason, as the LinkedIn extractor: writing a plausible 'new' into status here would invent a
// vocabulary Stage D has not chosen, and a value nobody set is easier to find than one someone
// guessed.
// THE SHEET IS ELEVEN COLUMNS SINCE 2026-09-17 AND THIS NODE STILL FILLS ELEVEN FIELDS OF ITS OWN.
// Shaheen removed apply_url, fit_reasons, lane and excerpt from the jobs tab: his reason was that the
// output does not add value and costs tokens. `lane` is the only one that stopped being FILLED, and
// it stopped because each lane owns its own spreadsheet, so the constant was telling a reader
// something the document already said. apply_url and excerpt are still collected and still used
// (excerpt IS the description block of the scoring prompt), they are simply never written, and the
// contract declares them under internal_only_fields so a guard can still prove they exist.
const COLLECTOR_FILLS = [
  'job_id', 'found_at', 'source', 'title', 'company', 'location',
  'remote', 'posted_at', 'url', 'apply_url', 'excerpt',
];
// `flags` joins the list 2026-09-17 evening: the scorer produces it as red_flags and
// 38-build-rows.js writes it, so a collector leaves it null exactly as it leaves fit_score.
const LEFT_FOR_LATER = ['fit_score', 'fit_reasons', 'status', 'flags'];

// DISCOVERY CANDIDATES. Every name below is a GUESS and is labelled as one everywhere it surfaces.
// They are ordered most to least likely and the report names the winner, so the first real run
// converts this list into a contract entry. This is not a substitute for the probe, it is what makes
// one run of the real thing enough to finish the probe's job.
const CANDIDATES = {
  job_id: ['jobkey', 'job_key', 'jk', 'job_id', 'id'],
  title: ['job_title', 'title', 'position', 'jobTitle'],
  company: ['company_name', 'company', 'employer', 'companyName'],
  location: ['location', 'job_location', 'city', 'place'],
  posted_at: ['date_posted', 'posted_at', 'posted_date', 'job_posted_date', 'date', 'created_at'],
  url: ['url', 'job_url', 'link', 'job_link'],
  apply_url: ['apply_link', 'apply_url', 'application_url'],
  excerpt: ['description', 'job_description', 'snippet', 'summary', 'description_text'],
  remote: ['is_remote', 'remote', 'remote_work'],
};
// Keys whose value might carry a viewjob url with the jobkey in it. The contract already records
// that a job link resolves to https://se.indeed.com/viewjob?jk=<jobkey>, which makes this the one
// identification path that rests on something observed rather than on a guessed field name.
const URL_BEARING_KEYS = ['url', 'job_url', 'link', 'job_link', 'apply_link', 'apply_url', 'application_url'];
// Envelope shapes to try, in order, before calling a ready snapshot unreadable.
const ENVELOPE_KEYS = ['data', 'results', 'records', 'items', 'rows'];

// --- build-time assertions ---------------------------------------------------------------------
(function assertAgainstContract() {
  if (!S) {
    throw new Error('Extract Indeed Jobs: the shared contract has no source called ' + SOURCE_KEY + '. It carries: ' + Object.keys(SRC).join(', '));
  }

  const shape = CONTRACT.shared_row_shape;
  const internal = Object.keys(CONTRACT.internal_only_fields || {}).filter(function (k) { return k[0] !== '_'; });
  if (!internal.length) {
    throw new Error(
      'Extract Indeed Jobs: the contract carries no internal_only_fields.\n' +
      '  Since 2026-09-17 the sheet is a SUBSET of what this node fills: excerpt and apply_url are\n' +
      '  collected, used and never written. That list is where they are declared, and without it this\n' +
      '  check cannot tell a deliberately unwritten field from a field nobody claims.'
    );
  }
  const mine = COLLECTOR_FILLS.concat(LEFT_FOR_LATER).slice().sort();
  const theirs = shape.concat(internal).slice().sort();
  if (mine.length !== theirs.length || mine.some((k, i) => k !== theirs[i])) {
    throw new Error(
      'Extract Indeed Jobs: this node and the contract disagree about the row shape.\n' +
      '  contract columns + internal: ' + theirs.join(', ') + '\n' +
      '  this node accounts for:      ' + mine.join(', ') + '\n' +
      '  Every field has to be either filled here or deliberately left for a later stage, and every\n' +
      '  field this node fills has to be either a sheet column or declared internal. A column nobody\n' +
      '  claims arrives empty in the sheet; a field nobody declares is one the 09-17 trim forgot.'
    );
  }

  const pipelineFilled = Object.keys(CONTRACT.pipeline_filled_fields || {});
  for (const k of LEFT_FOR_LATER) {
    if (!pipelineFilled.includes(k)) {
      throw new Error('Extract Indeed Jobs: this node leaves "' + k + '" null for a later stage and the contract no longer lists it under pipeline_filled_fields. Either a source supplies it now, or the contract drifted. Do not ship a permanently empty column.');
    }
  }

  if (!/^ind-/.test(S.dedup_id_rule || '')) {
    throw new Error(
      'Extract Indeed Jobs: the contract dedup_id_rule for ' + SOURCE_KEY + ' is "' + S.dedup_id_rule + '",\n' +
      '  which does not start with the ind- prefix this node stamps. Stage D dedupes on that prefix and the\n' +
      '  LinkedIn collector stamps li-, so a prefix change here silently stops the two sources deduping\n' +
      '  against each other and starts writing the same job twice.'
    );
  }

  // The two modes, and the refusal to ship a half thrown switch. Stated in full in Build Indeed
  // Request as well, because both nodes branch on the same flag and each should fail on its own.
  const fieldMapValues = Object.values(S.field_map || {}).map(String);
  const anyUnverified = fieldMapValues.some((v) => /UNVERIFIED/i.test(v));
  const probed = S.probed === true;
  if (probed && anyUnverified) {
    throw new Error('Extract Indeed Jobs: the contract sets probed=true while field_map still says UNVERIFIED. The probe was recorded as done and its result was not written down.');
  }
  if (!probed && !anyUnverified) {
    throw new Error('Extract Indeed Jobs: the contract says probed=false but nothing in field_map says UNVERIFIED any more. Either the probe ran and the flag was never flipped, or somebody tidied the wording off a set of guesses and made them look like measurements.');
  }
  if (probed) {
    const of = S.output_fields;
    if (!of || typeof of !== 'object') {
      throw new Error(
        'Extract Indeed Jobs: the contract sets probed=true but output_fields is ' + JSON.stringify(of) + '.\n' +
        '  Declared mode needs the real dataset key for every field this node fills. Fill output_fields with\n' +
        '  what the probe actually returned. Until it is there, discovery mode is the HONEST behaviour and\n' +
        '  probed must stay false.'
      );
    }
    if (!of.job_id) {
      throw new Error('Extract Indeed Jobs: the contract sets probed=true and output_fields has no job_id. Without it there is no dedup key, and rows land in the sheet that Stage D cannot match against anything.');
    }
    if (!S.snapshot_envelope) {
      throw new Error('Extract Indeed Jobs: the contract sets probed=true and snapshot_envelope is null. Record whether a ready snapshot returns a bare array or an object, and if an object, the key holding the rows.');
    }
    if (/UNVERIFIED/i.test(String(S.date_field)) || /UNVERIFIED/i.test(String(S.date_format))) {
      throw new Error('Extract Indeed Jobs: the contract sets probed=true while date_field or date_format still say UNVERIFIED. Stage E cuts the freshness window on those two.');
    }
  } else {
    if (S.output_fields) {
      throw new Error('Extract Indeed Jobs: output_fields is filled while probed is still false. If the names came from a real response, set probed=true and finish the rest of the entry. If they did not, they are guesses wearing a measurement\'s clothes and they belong in this node\'s CANDIDATES list, where everything is labelled as a guess.');
    }
  }

  // The guard is the only thing that decides what reaches this node, and the outcome vocabulary is
  // shared between them. A guard that starts emitting an outcome this node does not know would have
  // its verdict quietly folded into the catch-all.
  const code = GUARD.parameters.jsCode;
  for (const outcome of ['ready', 'timed_out', 'refused', 'trigger_failed', 'building', 'error']) {
    if (code.indexOf("'" + outcome + "'") === -1) {
      throw new Error(
        'Extract Indeed Jobs: 14-indeed-poll-guard.js no longer emits the outcome "' + outcome + '".\n' +
        '  This node turns the guard\'s vocabulary into the run report. An outcome it does not know about\n' +
        '  falls into the catch-all and is reported as a generic error, which is how a specific, diagnosed\n' +
        '  failure becomes an unhelpful one.'
      );
    }
  }
}());

const PROBED = S.probed === true;
const DECLARED = PROBED ? S.output_fields : null;

const LOGIC = `
// ---------------------------------------------------------------------------
// Extract Indeed Jobs.
// ---------------------------------------------------------------------------
const first = $input.first();
if (!first) {
  throw new Error('Extract Indeed Jobs: no input item. Keep Polling? emits exactly one item on its finished branch, so zero items means the graph is not what this node was built against.');
}
const inItem = first.json || {};
const poll = inItem.poll || null;
if (!poll || typeof poll.outcome !== 'string') {
  throw new Error('Extract Indeed Jobs: the input item carries no poll verdict. This node reports what Indeed Poll Guard decided, and without that it can only report what it happens to have, which is the exact blindness the guard exists to remove.');
}
if (poll.continue === true) {
  throw new Error('Extract Indeed Jobs: reached with poll.continue still true, which means the loop routed an unfinished pass to the finished branch. Keep Polling? output 0 is the loop and output 1 is the exit; they are the wrong way round.');
}

// What was PLANNED, read from Plan Queries rather than from the input, because the input can only
// describe the call that came back and part of this node's job is to name what did not.
let plannedAll;
try {
  plannedAll = $('Plan Queries').all().map((i) => i.json);
} catch (e) {
  throw new Error('Extract Indeed Jobs: cannot reach Plan Queries (' + e.message + '). The report sets what arrived against what was planned, and without the plan it can only report what it has.');
}
const planned = plannedAll.filter((j) => j.source === SOURCE_KEY);

let request = null;
try { request = $('Build Indeed Request').first().json; } catch (e) { request = null; }

const run = (planned[0] && planned[0].run) || (request && request.run) || {};
const foundAt = run.run_started_at || new Date().toISOString();

// --- text handling ---------------------------------------------------------
// Same rules as the LinkedIn collector, and for the same reason: these values land in a sheet a
// human reads. The dash rule has no carve-out, and an invisible character inside a title matches
// nothing while looking perfect in the cell.
let sanitisedFields = 0;
function sanitise(s) {
  const before = s;
  const out = String(s)
    .replace(/[\\u2010-\\u2015\\u2212]/g, '-')
    .replace(/[\\u00A0\\u2007\\u202F\\u2009\\u200A]/g, ' ')
    .replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '')
    .replace(/[\\u2018\\u2019]/g, "'")
    .replace(/[\\u201C\\u201D]/g, '"');
  if (out !== before) sanitisedFields += 1;
  return out;
}
function text(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return null;
  const t = sanitise(String(v)).replace(/\\s+/g, ' ').trim();
  return t === '' ? null : t;
}
function clip(s, n) {
  if (s === null) return null;
  return s.length > n ? s.slice(0, n).trim() : s;
}

// --- the envelope ----------------------------------------------------------
// A ready snapshot has never been observed for this dataset, so the shape is TRIED rather than
// assumed, in a declared order, and the winner is named in the report.
function unwrap(body) {
  if (Array.isArray(body)) return { rows: body, via: 'bare array' };
  if (body && typeof body === 'object') {
    if (DECLARED_ENVELOPE) {
      const v = body[DECLARED_ENVELOPE];
      if (Array.isArray(v)) return { rows: v, via: 'contract snapshot_envelope "' + DECLARED_ENVELOPE + '"' };
      return { rows: null, via: null, tried: [DECLARED_ENVELOPE], declared_missing: true };
    }
    for (const k of ENVELOPE_KEYS) {
      if (Array.isArray(body[k])) return { rows: body[k], via: 'object key "' + k + '" (DISCOVERED, not from the contract)' };
    }
    return { rows: null, via: null, tried: ENVELOPE_KEYS, keys_seen: Object.keys(body).slice(0, 30) };
  }
  return { rows: null, via: null, tried: ENVELOPE_KEYS, keys_seen: [] };
}

// --- field resolution ------------------------------------------------------
const discovery = {};
function note(field, key, how) {
  if (discovery[field] === undefined) discovery[field] = { key: key, how: how };
}
function pick(row, field) {
  if (PROBED) {
    const k = DECLARED[field];
    if (!k) { note(field, null, 'not declared in the contract output_fields'); return null; }
    if (row[k] === undefined) { note(field, k, 'DECLARED BUT ABSENT on the row'); return null; }
    note(field, k, 'contract output_fields');
    return row[k];
  }
  for (const k of (CANDIDATES[field] || [])) {
    if (row[k] !== undefined && row[k] !== null && row[k] !== '') { note(field, k, 'discovered'); return row[k]; }
  }
  note(field, null, 'no candidate key matched');
  return null;
}

// The jobkey, which is the one field a row cannot be written without, because it is the dedup id.
// Two paths: a named field, or the viewjob url, which is the only part of this source's shape the
// contract records from something observed rather than guessed.
const RE_JK = /[?&]jk=([A-Za-z0-9]+)/;
function jobKeyOf(row) {
  const direct = pick(row, 'job_id');
  if (direct !== null && direct !== undefined && String(direct).trim() !== '') {
    return { key: String(direct).trim(), via: 'field ' + (discovery.job_id && discovery.job_id.key) };
  }
  const keys = PROBED ? [DECLARED.url, DECLARED.apply_url].filter(Boolean) : URL_BEARING_KEYS;
  for (const k of keys) {
    const m = typeof row[k] === 'string' ? RE_JK.exec(row[k]) : null;
    if (m) return { key: m[1], via: 'jk= parsed out of ' + k };
  }
  for (const k of Object.keys(row)) {
    const m = typeof row[k] === 'string' ? RE_JK.exec(row[k]) : null;
    if (m) return { key: m[1], via: 'jk= parsed out of ' + k + ' (last resort scan of every string field)' };
  }
  return null;
}

// --- classify --------------------------------------------------------------
const rows = [];
const seenIds = {};
let duplicateRows = 0;
let rowsWithoutJobKey = 0;
let rowsSeen = 0;
let envelope = null;
const missingField = { title: 0, company: 0, location: 0, posted_at: 0, url: 0 };

let outcome = poll.outcome;
let reason = poll.reason;

if (outcome === 'ready') {
  envelope = unwrap(inItem.rows);
  if (!Array.isArray(envelope.rows)) {
    outcome = 'shape_unknown';
    reason = 'the snapshot answered 200 and this node could not find the rows in it. ' +
      (envelope.declared_missing
        ? 'The contract declares snapshot_envelope "' + DECLARED_ENVELOPE + '" and the body has no such array.'
        : 'Tried a bare array and then the keys ' + (envelope.tried || []).join(', ') + '. Top level keys actually present: ' + ((envelope.keys_seen || []).join(', ') || 'none') + '.') +
      ' This is NOT zero jobs: rows may well be there under a name nothing has ever seen, because this dataset has never been probed. Record the real shape in the contract as snapshot_envelope.';
  } else {
    rowsSeen = envelope.rows.length;
    for (const raw of envelope.rows) {
      const row0 = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
      const jk = jobKeyOf(row0);
      if (!jk) { rowsWithoutJobKey += 1; continue; }

      const jobId = SOURCE_DEDUP_PREFIX + jk.key;
      if (seenIds[jobId]) duplicateRows += 1;
      seenIds[jobId] = (seenIds[jobId] || 0) + 1;

      const remoteRaw = pick(row0, 'remote');
      const values = {
        job_id: jobId,
        found_at: foundAt,
        source: SOURCE_KEY,
        title: text(pick(row0, 'title')),
        company: text(pick(row0, 'company')),
        location: text(pick(row0, 'location')),
        // Unknown is not false. A false here would drop a remote job at the Stage E geo filter, which
        // is the same rule the LinkedIn collector follows for the same reason.
        remote: remoteRaw === true ? true : (remoteRaw === false ? false : (typeof remoteRaw === 'string' && /^(true|yes|remote)$/i.test(remoteRaw) ? true : null)),
        posted_at: text(pick(row0, 'posted_at')),
        url: text(pick(row0, 'url')),
        apply_url: text(pick(row0, 'apply_url')),
        excerpt: clip(text(pick(row0, 'excerpt')), 600),
      };

      const partial = [];
      for (const f of ['title', 'company', 'location', 'posted_at', 'url']) {
        if (values[f] === null || values[f] === undefined) { partial.push(f); missingField[f] += 1; }
      }

      const row = { _kind: 'job' };
      for (const k of COLLECTOR_FILLS) row[k] = values[k] === undefined ? null : values[k];
      for (const k of LEFT_FOR_LATER) row[k] = null;
      row._collect = {
        source: SOURCE_KEY,
        raw_job_id: jk.key,
        job_id_via: jk.via,
        field_names_verified: PROBED,
        snapshot_id: poll.snapshot_id,
        status_code: poll.status_code,
        dedup_id_rule: (planned[0] && planned[0].dedup_id_rule) || (request && request.dedup_id_rule) || null,
        date_field: (planned[0] && planned[0].date_field) || null,
        date_format: (planned[0] && planned[0].date_format) || null,
        window_start: (planned[0] && planned[0].window_start) || (request && request.window_start) || null,
        window_start_effective: (planned[0] && planned[0].window_start_effective) || (request && request.window_start_effective) || null,
        window_end: (planned[0] && planned[0].window_end) || (request && request.window_end) || null,
        // Bright Data discovers by keyword with no time filter, so nothing was cut server side and
        // Stage E owns the whole freshness decision for these rows.
        window_filtered_server_side: false,
        partial_fields: partial,
        probe_required: (planned[0] && planned[0].probe_required) || [],
      };
      rows.push({ json: row, pairedItem: { item: 0 } });
    }

    if (rowsSeen === 0) {
      outcome = 'empty';
      reason = 'the snapshot was ready and held zero rows. Read as a genuine no-results for these search terms.';
    } else if (rows.length === 0) {
      outcome = 'shape_unknown';
      reason = 'the snapshot returned ' + rowsSeen + ' row(s) and NONE of them carried a recognisable Indeed job key. ' +
        'Tried the field names ' + (PROBED ? '(from the contract) ' + JSON.stringify(DECLARED.job_id) : CANDIDATES_job_id.join(', ')) +
        ' and then a jk= parse over every string field. This is NOT zero jobs, it is rows this lane cannot identify, and ' +
        'without a job key there is no dedup id, so writing them would put unmatched rows in the sheet forever. ' +
        'The row keys actually present are listed in shape_discovery.row_keys_seen: put the real one in the contract.';
    }
  }
}

// --- the report ------------------------------------------------------------
// A snapshot that was READY and produced rows is an ok outcome. empty and shape_unknown were already
// decided above; every other outcome came from the guard and is carried through unchanged.
if (outcome === 'ready' && rows.length > 0) outcome = 'ok';

// Rows that arrived and could NOT be written are a partial parse, and a partial parse is never a
// clean run even when most rows made it. This is the same rule the LinkedIn collector applies to a
// card it could not parse, and for the same reason: those jobs are missing from the sheet and the
// row count alone cannot show it. Without this line a snapshot of 5 rows where 2 had no job key
// would report ok, which is the precise shape of a silent loss.
const partialParse = rowsWithoutJobKey > 0;

let verdict;
if ((outcome === 'ok' || outcome === 'empty') && !partialParse) verdict = 'ok';
else if (rows.length > 0) verdict = 'degraded';
else verdict = 'down';

const warnings = [];
if (outcome === 'timed_out') {
  warnings.push(
    'INDEED TIMED OUT. The poll guard stopped the loop after ' + poll.polls + ' poll(s)' +
    (poll.elapsed_ms === null ? '' : ' and ' + Math.round(poll.elapsed_ms / 1000) + ' s of run time') +
    ' on cap ' + poll.cap_hit + '. Snapshot ' + (poll.snapshot_id || 'unknown') + ' was still building. This is a normal ' +
    'outcome and not a crash: the snapshot may well finish later, and the trigger was already PAID FOR. ' +
    'If this happens repeatedly, the fix is a longer cap or a smaller limit_per_input, not a retry, because ' +
    'a retried trigger is a second billed scrape.'
  );
}
if (poll.account_lapsed) {
  warnings.push(
    'THE BRIGHT DATA ACCOUNT LOOKS LAPSED OR UNBILLABLE (status ' + (poll.status_code === null ? 'n/a' : poll.status_code) + '). ' +
    'The contract records this exact failure happening to this account once before. Nothing in this lane can fix it: ' +
    'it is an account question for Shaheen. Every other source is unaffected, and the source switch can be turned off ' +
    'in the settings tab to stop the lane spending 60 seconds a day discovering it again.'
  );
}
if (outcome === 'shape_unknown') {
  warnings.push(
    'A READY SNAPSHOT PRODUCED NO USABLE ROWS. Read the reason: this is the Indeed equivalent of changed markup and ' +
    'it must not be read as zero jobs. The dataset has NEVER been probed, so the names this node tried are guesses by ' +
    'construction. shape_discovery below names exactly what was tried and what the rows actually look like. One contract ' +
    'edit closes it permanently.'
  );
}
if (!FIELD_NAMES_VERIFIED) {
  warnings.push(
    'DISCOVERY MODE. Every Indeed field name in this run was guessed, because the Stage C probe could not run: the Bright ' +
    'Data key lives inside the n8n credential and nowhere else on this machine. See the contract at ' +
    'sources.brightdata_indeed.probe_attempted. shape_discovery below is the finished probe: copy it into ' +
    'output_fields and snapshot_envelope, set probed true, and this node switches to declared mode on the next build.'
  );
}
if (rowsWithoutJobKey > 0) {
  warnings.push(
    rowsWithoutJobKey + ' row(s) arrived with no recognisable Indeed job key and were NOT written. Without a key there is no ' +
    'dedup id, so the same job would be written again on every run and Stage D could never match it. Those jobs are missing ' +
    'from the sheet and nothing else would have said so.'
  );
}
if (request && request.cost && request.cost.over_settings_cap) {
  warnings.push('This run was allowed to bill up to $' + request.cost.max_cost_usd + ', above the max_cost_per_run_usd in the settings tab.');
}
if (poll.polls >= poll.caps.max_polls - 1 && outcome !== 'timed_out') {
  warnings.push('The snapshot became ready on poll ' + poll.polls + ' of a cap of ' + poll.caps.max_polls + '. That is close enough to the cap that a slightly slower day would be reported as a timeout. Consider raising the cap before it starts producing false degradations.');
}

const report = {
  _kind: 'source_report',
  source: SOURCE_KEY,
  lane: LANE_NUMBER,
  run_started_at: run.run_started_at || null,
  window_start: run.window_start || null,
  window_end: run.window_end || null,
  verdict: verdict,
  outcome: outcome,
  reason: reason,
  source_down: verdict === 'down',
  status_token: verdict === 'down' ? 'source_down:' + SOURCE_KEY : null,
  planned_units: planned.length,
  trigger_inputs_sent: request ? request.planned_units : null,
  rows_in_snapshot: rowsSeen,
  rows_emitted: rows.length,
  distinct_job_ids: Object.keys(seenIds).length,
  duplicate_rows: duplicateRows,
  rows_without_job_key: rowsWithoutJobKey,
  rows_missing_field: missingField,
  text_fields_sanitised: sanitisedFields,
  // The poll loop's own account of itself, carried verbatim so the cap that fired is readable
  // without reconstructing it from timestamps.
  poll: poll,
  cost: request ? request.cost : null,
  field_names_verified: FIELD_NAMES_VERIFIED,
  shape_discovery: {
    mode: PROBED ? 'declared, from the contract output_fields' : 'DISCOVERY, every name below is a guess this run tested',
    envelope: envelope ? (envelope.via || null) : null,
    envelope_tried: envelope ? (envelope.tried || null) : null,
    envelope_keys_seen: envelope ? (envelope.keys_seen || null) : null,
    fields: discovery,
    row_keys_seen: (envelope && Array.isArray(envelope.rows) && envelope.rows.length && typeof envelope.rows[0] === 'object')
      ? Object.keys(envelope.rows[0]).slice(0, 40) : null,
    what_to_do: PROBED ? null : 'Copy envelope and fields into sources.json under brightdata_indeed.snapshot_envelope and .output_fields, fill date_field and date_format, set probed true, and rebuild. The build refuses a half finished edit.',
  },
  raw_excerpt: inItem.raw_excerpt || null,
  warnings: warnings,
};

// The report goes LAST and it always goes, even with zero rows. A Code node returning [] ends the
// branch, and a timed out or refused run has no rows by definition, so returning nothing would
// delete the evidence of the exact failure this node exists to report.
return rows.concat([{ json: report, pairedItem: { item: 0 } }]);
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/16-extract-indeed-jobs.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const SOURCE_KEY = ${JSON.stringify(SOURCE_KEY)};`,
  `const SOURCE_DEDUP_PREFIX = ${JSON.stringify(S.dedup_id_rule.slice(0, S.dedup_id_rule.indexOf('-') + 1))};`,
  // COLLECTOR_FILLS, not shared_row_shape: since 2026-09-17 the sheet is a SUBSET of what this node
  // fills (apply_url and excerpt are collected, used and never written), and the emitted row has to
  // carry every field it fills or the scorer reads a posting with no description.
  `const COLLECTOR_FILLS = ${JSON.stringify(COLLECTOR_FILLS)};`,
  `const LEFT_FOR_LATER = ${JSON.stringify(LEFT_FOR_LATER)};`,
  `const CANDIDATES = ${JSON.stringify(CANDIDATES)};`,
  `const CANDIDATES_job_id = ${JSON.stringify(CANDIDATES.job_id)};`,
  `const URL_BEARING_KEYS = ${JSON.stringify(URL_BEARING_KEYS)};`,
  `const ENVELOPE_KEYS = ${JSON.stringify(ENVELOPE_KEYS)};`,
  `const PROBED = ${JSON.stringify(PROBED)};`,
  `const DECLARED = ${JSON.stringify(DECLARED)};`,
  `const DECLARED_ENVELOPE = ${JSON.stringify(PROBED ? S.snapshot_envelope : null)};`,
  `const FIELD_NAMES_VERIFIED = ${JSON.stringify(PROBED)};`,
  `const LANE_NUMBER = ${JSON.stringify(String(L.lane))};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Extract Indeed Jobs',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [3120, 320],
  connectFrom: 'Keep Polling?',
  outputIndex: 1,
  notes: 'Turns a ready Bright Data snapshot into the shared row shape, and turns every other poll verdict into one honest source report. Runs in DISCOVERY mode while the contract says the dataset is unprobed, naming which field it found the job key under so one real run finishes the probe.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

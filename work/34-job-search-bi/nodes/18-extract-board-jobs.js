'use strict';
/*
 * 18-extract-board-jobs.js - six feeds in, one shared row shape out, and one honest report per
 * board saying what that board actually did.
 *
 * THE DISTINCTION THIS NODE EXISTS FOR, same as the LinkedIn collector's and worth six times as
 * much here. "This board had nothing new" and "this board changed shape" produce the same row count
 * and mean opposite things. Six independent feeds is six independent ways for this lane to start
 * quietly returning nothing while every run stays green. So every call lands in exactly one of five
 * outcomes, carried out as DATA and never inferred later from a count:
 *
 *   ok             2xx, the envelope is where the contract says, at least one row mapped
 *   empty          2xx, the envelope is correct, and it holds zero rows
 *   refused        429, 403, 401, 999, or a 2xx body that is a block page rather than a feed
 *   shape_changed  2xx with a real body, and the envelope or the row fields are not where the
 *                  contract says they are
 *   error          a transport failure, a timeout, a 5xx, or any other non-2xx
 *
 * `empty` and `shape_changed` are the pair a naive mapper collapses into "zero rows", and for these
 * six that collapse is close to inevitable without a deliberate check: they are free public JSON
 * APIs run by small teams, four of the six have already been measured behaving differently from
 * their own documentation, and a renamed key produces `undefined` rather than an exception. A mapper
 * that returns [] when Jobicy renames jobTitle is the single most likely way this lane dies quietly.
 *
 * HOW shape_changed IS ACTUALLY DETECTED, three independent tests rather than one:
 *   1. The envelope. The rows container named in the contract is absent, or is not an array, or the
 *      body is not the kind of thing the contract describes. Loud, and it names the keys it did see.
 *   2. The rows. Rows exist and NONE of them carries the required field set. The feed is answering,
 *      it is just not answering with the shape this lane maps.
 *   3. The stragglers. SOME rows carry the required fields and some do not. That is the case that
 *      leaves no trace in the output at all, because a skipped row simply is not there. Counting
 *      what arrived against what mapped is the only thing that makes it visible, and any non-zero
 *      count degrades the source rather than passing it.
 *
 * ONE BOARD FAILING MUST NOT LOSE THE OTHER FIVE. Partial success is the normal case: six hosts,
 * six policies, two of which state outright that access is suspended or terminated for misuse. So
 * nothing is discarded because something else failed, and the verdict is computed per source, not
 * for the stage.
 *
 * EVERY PLANNED SOURCE REPORTS, even one that returned nothing, and the planned set is read from
 * Plan Queries rather than inferred from what arrived. A response can only describe a call that came
 * back; a board whose call never produced an item is exactly the case that has to be named. This is
 * what lets Stage F tell "ran and found nothing" from "never ran".
 *   The one thing this node CANNOT report on is a board that is switched OFF. A disabled source is
 *   never planned, so it produces no item here, by design: off costs zero calls. It is named in
 *   Plan Queries' `disabled_sources`, and that is where Stage F reads it. Stated here because the
 *   same hole exists on the LinkedIn and Indeed branches and it is the sort of gap that gets
 *   rediscovered once per stage.
 *
 * WHAT IS NORMALISED HERE AND WHAT IS DELIBERATELY NOT.
 *   posted_at IS normalised, to ISO 8601 UTC, and the raw value plus the contract's declared format
 *   ride along in `_collect`. Three date formats arrive from these six boards (unix seconds, ISO
 *   with a real offset, and ISO with NO offset at all), and they land in ONE sheet column. Leaving
 *   them raw would put `1789148410` and `2026-09-10T17:17:28-04:00` in the same column, unreadable
 *   for Shaheen and forcing every later stage to re-derive per-source parsing that this node has
 *   already done once.
 *   THE TRAP INSIDE THAT, and it is the reason the parser is explicit rather than `new Date(x)`:
 *   Remotive publishes ISO with no timezone, and JavaScript reads a date-TIME with no offset as
 *   LOCAL time, while a date-ONLY string is read as UTC. So `new Date('2026-09-08T21:47:54')` means
 *   whatever the n8n process timezone happens to be, which nobody has pinned, and the error is one
 *   or two hours: far too small to notice and exactly big enough to move a job across a window
 *   boundary. The contract says to declare it UTC by convention, so this node appends the Z itself
 *   and refuses a value that does not look like the format the contract declares.
 *
 *   The window is NOT cut here. Every row carries window_start_effective and the collector COUNTS
 *   how many rows fall inside it, but it removes none. Freshness is Stage E's filter, and doing it
 *   in two places is how a run report's numbers stop adding up. The count is the point: it is what
 *   makes a structurally stale source legible instead of looking like a quiet day.
 *
 *   Dedupe is NOT done here either, within a source or across them. Duplicates are counted and
 *   reported. Same rule the LinkedIn collector states, same reason.
 *
 * ATTRIBUTION IS A CONDITION OF ACCESS, NOT A COURTESY, for four of these six. RemoteOK suspends
 * access without a follow link, Remotive terminates it and forbids resubmitting their jobs to
 * third-party job sites, Jobicy requires every apply button to redirect to the original feed url,
 * Arbeitnow appreciates a link back. So the row shape carries `source` and BOTH `url` and
 * `apply_url` for every row, a build-time assertion refuses a contract edit that would null either
 * link for an attribution-bound source, and every report states the obligation in words so the
 * surface that renders these rows cannot claim it did not know. Which later stage each obligation
 * binds is in the Stage D card and in the handoff.
 *
 * TWO SHAPES COME OUT, tagged with `_kind`, exactly as the other two collectors:
 *   _kind: 'job'            one per mapped row, shared_row_shape at the top level plus a `_collect`
 *                           block of provenance that is NOT a sheet column
 *   _kind: 'source_report'  ONE PER PLANNED BOARD, always, even for a board that returned nothing or
 *                           was refused. The reports go last so the branch never ends with zero
 *                           items, which is how a fully refused run would otherwise vanish before
 *                           Stage F could report it.
 *
 * The mapper specs below name source fields, and every one of them is asserted at build time against
 * the contract's own field_map, envelope, date_format and dedup_id_rule for that source. Nothing
 * about the outside world is typed into this file without the contract agreeing.
 */

const { lane, sources } = require('./_lane');
const L = lane();
const CONTRACT = sources();
const SRC = CONTRACT.sources;

const HTTP_NODE = require('./17-fetch-board.js');

// ---------------------------------------------------------------------------------------------
// WHAT THIS NODE FILLS AND WHAT IT LEAVES FOR LATER. Identical split to the other two collectors,
// and asserted against the contract's pipeline_filled_fields, so a column nobody claims cannot
// arrive silently empty in the sheet.
// ---------------------------------------------------------------------------------------------
const COLLECTOR_FILLS = [
  'job_id', 'found_at', 'source', 'title', 'company', 'location',
  'remote', 'posted_at', 'url', 'apply_url', 'lane', 'excerpt',
];
const LEFT_FOR_LATER = ['fit_score', 'fit_reasons', 'status'];

// A full job description in a sheet cell makes the sheet unusable. The two boards that publish a
// real plain-text excerpt keep theirs; the four that publish only description HTML get it stripped
// and cut here rather than four times downstream.
const EXCERPT_MAX = 400;

// Statuses that mean a board decided not to serve us, as opposed to something breaking.
const REFUSAL_STATUSES = {
  401: 'unauthorized, the feed asked for a key this lane does not send',
  403: 'forbidden, the request was rejected outright',
  429: 'rate limited, too many requests from this address',
  999: 'anti-automation status, this address is being refused',
};

// ---------------------------------------------------------------------------------------------
// THE SIX MAPPERS.
//
// Declarative on purpose. One generic runtime walks these specs, so there is ONE code path to test
// rather than six hand-written ones, and the spec itself is the thing checked against the contract.
// A hand-written mapper per board would put six copies of the same null handling in the node and
// give the build nothing to assert.
//
// Handler kinds, all exercised by the offline tests:
//   field         take the field as-is, trim, empty becomes null
//   const         a fixed value the contract declares as constant for that board
//   bool_field    a real boolean the row states per job
//   array_join    an array of strings, joined, with a stated fallback for the empty array
//   regions       a string of region names with a separator that is NOT a plain ', '
//   html_excerpt  strip tags, decode entities, truncate
// ---------------------------------------------------------------------------------------------
const MAPPERS = {
  himalayas: {
    // object envelope, jobs[]
    rows_path: 'jobs',
    skip_elements: 0,
    id: { kind: 'guid_last_segment', field: 'guid' },
    // The contract's own note: the slug is company-scoped, so prefix with companySlug if a collision
    // ever appears. Two of the seven rows in the live capture carry NO numeric suffix at all
    // ("mergers-acquisitions-m-a-attorney-biglaw-firms"), so the collision is realistic rather than
    // theoretical. The contract's rule is followed as written, and a real collision (same id, a
    // DIFFERENT company) is reported by name instead of being counted as a harmless duplicate.
    collision_key: 'companySlug',
    fields: {
      title: { kind: 'field', field: 'title' },
      company: { kind: 'field', field: 'companyName' },
      location: { kind: 'array_join', field: 'locationRestrictions', when_empty: 'Worldwide' },
      remote: { kind: 'const', value: true },
      url: { kind: 'field', field: 'guid' },
      apply_url: { kind: 'field', field: 'applicationLink' },
      excerpt: { kind: 'html_excerpt', field: 'excerpt' },
    },
    date: { kind: 'unix_seconds', field: 'pubDate' },
    required: ['title', 'companyName', 'guid'],
    envelope_report: ['limit', 'totalCount', 'offset', 'updatedAt', 'nextCursor'],
    // D4 and D5 both live on this source and both are still open. The report has to carry the
    // numbers that would answer them, every run, or the question gets re-asked from scratch.
    short_feed_check: { rows_field: 'limit', total_field: 'totalCount' },
  },

  remotive: {
    rows_path: 'jobs',
    skip_elements: 0,
    id: { kind: 'field', field: 'id' },
    fields: {
      title: { kind: 'field', field: 'title' },
      company: { kind: 'field', field: 'company_name' },
      location: { kind: 'field', field: 'candidate_required_location' },
      remote: { kind: 'const', value: true },
      url: { kind: 'field', field: 'url' },
      apply_url: { kind: 'field', field: 'url' },
      excerpt: { kind: 'html_excerpt', field: 'description' },
    },
    date: { kind: 'iso_no_offset', field: 'publication_date' },
    required: ['id', 'title', 'company_name', 'url'],
    // D7: log job-count against total-job-count every run, so a filter that is silently ignored is
    // visible in the report instead of invisible in the data.
    envelope_report: ['job-count', 'total-job-count'],
  },

  remoteok: {
    // bare array, and element 0 is their legal notice rather than a job
    rows_path: null,
    skip_elements: 1,
    skipped_element_keys: ['last_updated', 'legal'],
    id: { kind: 'field_string', field: 'id' },
    fields: {
      title: { kind: 'field', field: 'position' },
      company: { kind: 'field', field: 'company' },
      location: { kind: 'field', field: 'location' },
      remote: { kind: 'const', value: true },
      url: { kind: 'field', field: 'url' },
      apply_url: { kind: 'field', field: 'apply_url' },
      excerpt: { kind: 'html_excerpt', field: 'description' },
    },
    date: { kind: 'unix_seconds', field: 'epoch' },
    required: ['id', 'position', 'company', 'url'],
    envelope_report: [],
  },

  workingnomads: {
    rows_path: null,
    skip_elements: 0,
    // No id field anywhere in the payload, so the dedup id depends entirely on the url shape
    // holding steady. A url that stops matching is therefore an UNMAPPABLE row, never a row with a
    // guessed id, and the count of those is in the report.
    id: { kind: 'url_regex', field: 'url', pattern: '/job/go/(\\d+)/' },
    fields: {
      title: { kind: 'field', field: 'title' },
      company: { kind: 'field', field: 'company_name' },
      location: { kind: 'field', field: 'location' },
      remote: { kind: 'const', value: true },
      url: { kind: 'field', field: 'url' },
      apply_url: { kind: 'field', field: 'url' },
      excerpt: { kind: 'html_excerpt', field: 'description' },
    },
    date: { kind: 'iso_offset', field: 'pub_date' },
    required: ['title', 'company_name', 'url'],
    envelope_report: [],
    // tags is a COMMA-SEPARATED STRING here and an array on every other board (D12). Nothing in the
    // shared row shape reads it, so the trap cannot bite this node. Its observed type is reported
    // anyway: the day it becomes an array is the day someone downstream reaches for it, and a type
    // change nobody recorded is a bug waiting for a later stage.
    watch_string_fields: ['tags'],
  },

  jobicy: {
    rows_path: 'jobs',
    skip_elements: 0,
    id: { kind: 'field', field: 'id' },
    fields: {
      title: { kind: 'field', field: 'jobTitle' },
      company: { kind: 'field', field: 'companyName' },
      // jobGeo separates regions with a comma and TWO spaces (D13), which a split on ', ' turns
      // into leading-space garbage on every multi-region row. Measured on the live capture: 26 of
      // 100 rows carry the double space, so this is a quarter of the feed, not an edge case.
      location: { kind: 'regions', field: 'jobGeo' },
      remote: { kind: 'const', value: true },
      url: { kind: 'field', field: 'url' },
      apply_url: { kind: 'field', field: 'url' },
      excerpt: { kind: 'html_excerpt', field: 'jobExcerpt' },
    },
    date: { kind: 'iso_offset', field: 'pubDate' },
    required: ['id', 'jobTitle', 'companyName', 'url'],
    // appliedFilters is the cheapest confirmation that a param was honoured, and apiVersion is the
    // cheapest warning that the surface moved under us. Both are read and logged, as the contract asks.
    envelope_report: ['apiVersion', 'jobCount', 'appliedFilters', 'success', 'statusCode'],
  },

  arbeitnow: {
    rows_path: 'data',
    skip_elements: 0,
    id: { kind: 'field', field: 'slug' },
    fields: {
      title: { kind: 'field', field: 'title' },
      company: { kind: 'field', field: 'company_name' },
      location: { kind: 'field', field: 'location' },
      // The only source of the six that states remote per row. Taken as the real boolean it is,
      // never coerced: false here is a measurement and null would be a loss.
      remote: { kind: 'bool_field', field: 'remote' },
      url: { kind: 'field', field: 'url' },
      apply_url: { kind: 'field', field: 'url' },
      excerpt: { kind: 'html_excerpt', field: 'description' },
    },
    date: { kind: 'unix_seconds', field: 'created_at' },
    required: ['slug', 'title', 'company_name', 'url'],
    envelope_report: ['meta.per_page', 'meta.current_page', 'links.next', 'links.last'],
  },
};

// Which shared-row field each spec slot fills, for the contract cross-check below.
const SPEC_TO_ROW_FIELD = {
  id: 'job_id',
  date: 'posted_at',
};

// ---------------------------------------------------------------------------------------------
// Build-time assertions. Every one of these runs on this machine before a byte reaches the box.
// ---------------------------------------------------------------------------------------------

// Token-boundary match, never a plain substring. The lesson is this repo's own: `always_drop`
// matched as a plain substring, so a short drop term killed "International BI Analyst". The same
// mistake here would
// let the field name `id` match inside `candidate_required_location` and pass an assertion that
// should have failed.
function mentions(haystack, token) {
  const s = String(haystack);
  const t = String(token);
  let i = s.indexOf(t);
  while (i !== -1) {
    const before = i === 0 ? '' : s[i - 1];
    const after = i + t.length >= s.length ? '' : s[i + t.length];
    const isWord = (c) => c !== '' && /[A-Za-z0-9_]/.test(c);
    if (!isWord(before) && !isWord(after)) return true;
    i = s.indexOf(t, i + 1);
  }
  return false;
}

const BOARD_KEYS = (function readBoardKeys() {
  const code = require('./05-plan-queries.js').parameters.jsCode;
  const m = /const BOARD_KEYS = (\[[^\]]*\]);/.exec(code);
  if (!m) throw new Error('Extract Board Jobs: could not read BOARD_KEYS out of 05-plan-queries.js. That line is how this stage learns which sources are boards.');
  return JSON.parse(m[1]);
}());

const DATE_KIND_EVIDENCE = {
  unix_seconds: /unix seconds/i,
  iso_no_offset: /WITHOUT a timezone/i,
  iso_offset: /WITH a real offset|with a \+00:00 offset/i,
};

const DEDUP_PREFIX = {};

(function assertAgainstContract() {
  // 1. Row shape. Every column is either filled here or deliberately left for a later stage.
  const shape = CONTRACT.shared_row_shape;
  const mine = COLLECTOR_FILLS.concat(LEFT_FOR_LATER).slice().sort();
  const theirs = shape.slice().sort();
  if (mine.length !== theirs.length || mine.some((k, i) => k !== theirs[i])) {
    throw new Error(
      'Extract Board Jobs: this node and the contract disagree about the row shape.\n' +
      '  contract shared_row_shape: ' + theirs.join(', ') + '\n' +
      '  this node accounts for:    ' + mine.join(', ') + '\n' +
      '  A column nobody claims is a column that silently arrives empty in the sheet, and the sheet\n' +
      '  header was written from this same list at provisioning time.'
    );
  }
  const pipelineFilled = Object.keys(CONTRACT.pipeline_filled_fields || {});
  for (const k of LEFT_FOR_LATER) {
    if (!pipelineFilled.includes(k)) {
      throw new Error('Extract Board Jobs: this node leaves "' + k + '" null for a later stage and the contract no longer lists it under pipeline_filled_fields. Do not ship a permanently empty column.');
    }
  }

  // 2. Every planned board has a mapper, and every mapper is a planned board.
  const mapped = Object.keys(MAPPERS).slice().sort();
  const planned = BOARD_KEYS.slice().sort();
  if (mapped.length !== planned.length || mapped.some((k, i) => k !== planned[i])) {
    throw new Error(
      'Extract Board Jobs: the boards Plan Queries plans and the boards this node maps disagree.\n' +
      '  planned: ' + planned.join(', ') + '\n' +
      '  mapped:  ' + mapped.join(', ') + '\n' +
      '  A planned board with no mapper is fetched every run and thrown away; a mapper with no plan\n' +
      '  is code nothing reaches. Failing the build is the point.'
    );
  }

  for (const key of Object.keys(MAPPERS)) {
    const spec = MAPPERS[key];
    const s = SRC[key];
    if (!s) throw new Error('Extract Board Jobs: the shared contract has no source called ' + key + '.');
    const fm = s.field_map || {};

    // 3. Every source field name in the spec must be named in the contract's field_map for the
    // shared column it fills. This is the check that turns a renamed field into a failed build here
    // instead of six empty columns at 06:30 on a Tuesday.
    const uses = [];
    uses.push({ row_field: SPEC_TO_ROW_FIELD.id, spec: spec.id });
    uses.push({ row_field: SPEC_TO_ROW_FIELD.date, spec: spec.date });
    for (const rowField of Object.keys(spec.fields)) uses.push({ row_field: rowField, spec: spec.fields[rowField] });

    for (const u of uses) {
      const rule = fm[u.row_field];
      if (typeof rule !== 'string') {
        throw new Error('Extract Board Jobs: the contract has no field_map rule for "' + u.row_field + '" on ' + key + '.');
      }
      if (u.spec.kind === 'const') {
        if (!/constant/i.test(rule)) {
          throw new Error(
            'Extract Board Jobs: this node writes a CONSTANT ' + JSON.stringify(u.spec.value) + ' into "' + u.row_field + '" for ' + key + ',\n' +
            '  and the contract no longer calls it constant. contract says: ' + rule + '\n' +
            '  If that board now states the value per row, read it per row. A constant that stopped\n' +
            '  being true is a column full of confident wrong answers.'
          );
        }
        continue;
      }
      if (!u.spec.field) throw new Error('Extract Board Jobs: spec for ' + key + '.' + u.row_field + ' has kind ' + u.spec.kind + ' and no field.');
      if (!mentions(rule, u.spec.field)) {
        throw new Error(
          'Extract Board Jobs: the contract\'s field_map for "' + u.row_field + '" on ' + key + ' no longer names "' + u.spec.field + '".\n' +
          '  contract says: ' + rule + '\n' +
          '  This node reads that field. A field renamed in the contract and not here is a mapper that\n' +
          '  returns undefined for every row and calls the board empty.'
        );
      }
    }

    // 4. The date parser matches the format the contract declares. Getting this wrong is a silent
    // one-to-two-hour error on the ISO sources and a fifty-year error on the unix ones.
    const evidence = DATE_KIND_EVIDENCE[spec.date.kind];
    if (!evidence) throw new Error('Extract Board Jobs: unknown date kind ' + spec.date.kind + ' for ' + key + '.');
    if (!evidence.test(s.date_format || '')) {
      throw new Error(
        'Extract Board Jobs: this node parses ' + key + '.' + spec.date.field + ' as ' + spec.date.kind + ',\n' +
        '  and the contract declares the format as: ' + s.date_format + '\n' +
        '  Those disagree. Pick the parser from the format, never the other way round.'
      );
    }
    if (s.date_field !== spec.date.field) {
      throw new Error('Extract Board Jobs: the contract says ' + key + '.date_field is "' + s.date_field + '" and this node reads "' + spec.date.field + '".');
    }

    // 5. The envelope. The rows container has to be where the contract's envelope prose says.
    const env = String(s.envelope || '');
    if (spec.rows_path === null) {
      if (!/flat array|bare array/i.test(env)) {
        throw new Error('Extract Board Jobs: this node expects ' + key + ' to answer with a bare array, and the contract envelope says: ' + env);
      }
    } else if (!mentions(env, spec.rows_path) && !env.includes(spec.rows_path + '[]')) {
      throw new Error('Extract Board Jobs: this node reads ' + key + ' rows from "' + spec.rows_path + '" and the contract envelope does not mention it: ' + env);
    }
    if (spec.skip_elements > 0 && !/element 0/i.test(env)) {
      throw new Error(
        'Extract Board Jobs: this node skips the first ' + spec.skip_elements + ' element(s) of ' + key + ' and the contract\n' +
        '  envelope no longer says element 0 is anything special: ' + env + '\n' +
        '  Skipping a real job every run is exactly as invisible as emitting a legal notice as one.'
      );
    }
    if (spec.skip_elements === 0 && /ELEMENT 0 IS/i.test(env)) {
      throw new Error('Extract Board Jobs: the contract says element 0 of ' + key + ' is not a job, and this node skips nothing. One garbage row per run.');
    }

    // 6. The dedup prefix comes from the contract, never typed.
    const rule = String(s.dedup_id_rule || '');
    const dash = rule.indexOf('-');
    if (dash <= 0) throw new Error('Extract Board Jobs: the contract dedup_id_rule for ' + key + ' is "' + rule + '", which carries no prefix this node can stamp.');
    DEDUP_PREFIX[key] = rule.slice(0, dash + 1);

    // 7. Method, auth and response type, the same three the fetch node asserts, checked again here
    // because this node is the one that would misreport a change.
    if (s.method !== 'GET' || s.auth !== 'none' || s.response_type !== 'json') {
      throw new Error('Extract Board Jobs: ' + key + ' is now method=' + s.method + ' auth=' + s.auth + ' response_type=' + s.response_type + '. This node maps parsed JSON from an unauthenticated GET.');
    }

    if (!Array.isArray(spec.required) || !spec.required.length) {
      throw new Error('Extract Board Jobs: ' + key + ' declares no required fields, so a reshaped feed would map to rows of nulls and report ok.');
    }
  }

  // 8. ATTRIBUTION. Four of these six make it a condition of access. A row that loses its link
  // cannot be attributed by any surface downstream, so a contract edit that nulls either link for a
  // bound source has to fail here rather than produce rows nobody is allowed to display.
  const obligations = CONTRACT.attribution_obligations || {};
  for (const key of Object.keys(obligations)) {
    if (key.startsWith('_')) continue;
    if (!MAPPERS[key]) continue;
    for (const linkField of ['url', 'apply_url']) {
      const slot = MAPPERS[key].fields[linkField];
      if (!slot || slot.kind === 'const' || !slot.field) {
        throw new Error(
          'Extract Board Jobs: ' + key + ' carries an attribution obligation and this node would emit rows\n' +
          '  with no real ' + linkField + '. The obligation: ' + obligations[key] + '\n' +
          '  Attribution is a condition of API access for this source, not a courtesy, so a row that\n' +
          '  cannot carry its original link must not be produced at all.'
        );
      }
    }
  }

  // 9. The pacing has to be readable back out of the fetch node, because the report quotes it. Read
  // defensively at every level: a batching block deleted wholesale must produce this sentence, not a
  // TypeError about reading a property of undefined, which tells the next person nothing.
  const opts = (HTTP_NODE.parameters && HTTP_NODE.parameters.options) || {};
  const batch = (opts.batching && opts.batching.batch) || null;
  if (!batch || typeof batch.batchInterval !== 'number' || typeof batch.batchSize !== 'number') {
    throw new Error(
      'Extract Board Jobs: could not read the pacing back out of 17-fetch-board.js.\n' +
      '  The run report quotes the real batchInterval so it can never claim a pacing this lane is not\n' +
      '  using. If the batching block was removed deliberately, this node has to stop quoting it in the\n' +
      '  same edit rather than reporting a number that no longer exists.'
    );
  }
  if (typeof opts.timeout !== 'number') {
    throw new Error('Extract Board Jobs: 17-fetch-board.js declares no timeout, and the run report quotes it.');
  }
  if (HTTP_NODE.maxTries !== undefined || HTTP_NODE.retryOnFail !== undefined) {
    throw new Error(
      'Extract Board Jobs: 17-fetch-board.js has grown a retry. n8n retries the NODE, so one retry over\n' +
      '  six planned calls is a second call to every board including the five that answered fine, and\n' +
      '  Remotive allows about four calls a DAY. If a retry is genuinely wanted, re-argue it here and\n' +
      '  in the fetch node together, and say what it costs against the daily budgets.'
    );
  }
}());

const PACING = {
  batch_size: HTTP_NODE.parameters.options.batching.batch.batchSize,
  batch_interval_ms: HTTP_NODE.parameters.options.batching.batch.batchInterval,
  timeout_ms: HTTP_NODE.parameters.options.timeout,
  retry: false,
};

// The attribution words, carried into every report so the obligation travels with the data.
const ATTRIBUTION = {};
for (const key of Object.keys(MAPPERS)) {
  const o = (CONTRACT.attribution_obligations || {})[key];
  ATTRIBUTION[key] = o ? { required: true, obligation: o } : { required: false, obligation: null };
}

const LOGIC = `
// ---------------------------------------------------------------------------
// Extract Board Jobs.
// ---------------------------------------------------------------------------
const items = $input.all();

// What was PLANNED, read from Plan Queries rather than from the input, because a response can only
// describe a call that came back and half this node's job is naming the ones that did not.
let plannedAll;
try {
  plannedAll = $('Plan Queries').all().map((i) => i.json);
} catch (e) {
  throw new Error('Extract Board Jobs: cannot reach Plan Queries (' + e.message + '). Without the plan this node can only report what it happens to have, which is the exact blindness it exists to remove.');
}
const planned = plannedAll.filter((j) => BOARD_KEYS.indexOf(j.source) !== -1);
const otherPlanned = plannedAll.filter((j) => BOARD_KEYS.indexOf(j.source) === -1);

if (!planned.length) {
  throw new Error('Extract Board Jobs: ' + items.length + ' response(s) arrived and Plan Queries planned no board units at all. Something is routing other work into the board collector, and every one of those calls is being parsed as a board feed.');
}

const run = planned[0].run || {};
const foundAt = run.run_started_at || new Date().toISOString();
const disabledSources = (run.plan && run.plan.disabled_sources) || [];

// --- text handling ---------------------------------------------------------
// A private copy on purpose. An n8n Code node cannot import from a sibling node, so the alternative
// to a copy is an expression referencing another node's output, which is worse: it would make this
// node's text handling depend on the LinkedIn branch having run.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aring: 'å', auml: 'ä', ouml: 'ö', Aring: 'Å', Auml: 'Ä', Ouml: 'Ö',
  eacute: 'é', egrave: 'è', uuml: 'ü', szlig: 'ß', oslash: 'ø', aelig: 'æ',
  hellip: '...', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"',
};
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, (m, hex) => { try { return String.fromCodePoint(parseInt(hex, 16)); } catch (e) { return m; } })
    .replace(/&#(\\d+);/g, (m, dec) => { try { return String.fromCodePoint(parseInt(dec, 10)); } catch (e) { return m; } })
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => (NAMED_ENTITIES[name] !== undefined ? NAMED_ENTITIES[name] : m));
}

// Characters that must not survive into a surface Shaheen reads. The no-dash rule has no carve-out,
// and these feeds are full of them: German titles from Arbeitnow and region strings from Jobicy both
// carry en-dashes. Invisible characters get the same treatment, for the same reason Parse Settings
// checks for them: a zero width space inside a title matches nothing and looks perfect in the cell.
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

// TWO ENCODINGS ARRIVE FROM THESE SIX BOARDS AND BOTH HAVE TO END AS PLAIN TEXT. Arbeitnow sends
// real HTML. RemoteOK sends the same markup ENTITY-ENCODED (&lt;p&gt;&lt;strong&gt;), and 54 of
// Arbeitnow's 250 rows carry both at once. A single strip-then-decode pass, which is what shipped
// into the first test run here, handles neither properly: it removes the real tags and then the
// decode turns the encoded half back into live tags, so 53 rows went out with visible markup in a
// column Shaheen reads. Decode-then-strip fails the mirror case instead.
// So: alternate, until the string stops changing, with a hard bound. The bound is what stops a
// deliberately multi-encoded payload from spinning; four passes covers double encoding twice over.
function plainText(v) {
  if (v === null || v === undefined) return null;
  let s = String(v);
  for (let pass = 0; pass < 4; pass += 1) {
    const next = decodeEntities(s.replace(/<[^>]*>/g, ' '));
    if (next === s) break;
    s = next;
  }
  // One final strip, because the last decode in the loop can itself have produced tags.
  s = s.replace(/<[^>]*>/g, ' ');
  const t = sanitise(s).replace(/\\s+/g, ' ').trim();
  return t === '' ? null : t;
}
function plainField(v) {
  if (v === null || v === undefined) return null;
  const t = sanitise(String(v)).replace(/\\s+/g, ' ').trim();
  return t === '' ? null : t;
}
function truncate(s, n) {
  if (s === null) return null;
  return s.length <= n ? s : s.slice(0, n - 3).replace(/\\s+\\S*$/, '') + '...';
}

// --- dates -----------------------------------------------------------------
// Every board's posted_at ends up as ISO 8601 UTC. The raw value and the contract's declared format
// ride along in _collect, so nothing is lost and nothing later has to re-derive per-source parsing.
const EPOCH_FLOOR = 1420070400;                                  // 2015-01-01, older than any live posting
const EPOCH_CEIL = Math.floor(Date.now() / 1000) + 400 * 86400;  // a year and a bit ahead

function parseDate(kind, raw) {
  if (raw === null || raw === undefined || raw === '') return { iso: null, problem: 'the field is empty' };
  if (kind === 'unix_seconds') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isFinite(n)) return { iso: null, problem: 'expected unix seconds and got ' + JSON.stringify(raw) };
    if (n > 1e12) return { iso: null, problem: 'value ' + n + ' looks like unix MILLISECONDS, not seconds. Read as seconds it lands about fifty thousand years from now.' };
    if (n < EPOCH_FLOOR || n > EPOCH_CEIL) return { iso: null, problem: 'unix seconds ' + n + ' resolves to ' + new Date(n * 1000).toISOString() + ', outside the plausible range for a job posting' };
    return { iso: new Date(n * 1000).toISOString(), problem: null };
  }
  const s = String(raw).trim();
  if (kind === 'iso_no_offset') {
    // The trap this whole function exists for. JavaScript reads a date-TIME with no offset as LOCAL
    // time, and the n8n process timezone is not pinned anywhere, so new Date(s) here means a silent
    // one-or-two-hour shift. The contract says to declare it UTC by convention, so the Z is appended
    // explicitly and a value that already carries an offset is refused rather than double-handled.
    if (!/^\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?$/.test(s)) {
      return { iso: null, problem: 'expected ISO 8601 with NO timezone (the contract says to declare it UTC) and got ' + JSON.stringify(s) + '. If this source started sending an offset, the contract and this parser change together.' };
    }
    const d = new Date(s.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return { iso: null, problem: 'unparseable after appending Z: ' + JSON.stringify(s) };
    return { iso: d.toISOString(), problem: null };
  }
  if (kind === 'iso_offset') {
    if (!/(Z|[+-]\\d{2}:?\\d{2})$/.test(s)) {
      return { iso: null, problem: 'expected ISO 8601 WITH an offset and got ' + JSON.stringify(s) + '. Parsing it anyway would silently adopt the box timezone.' };
    }
    const d = new Date(s);
    if (isNaN(d.getTime())) return { iso: null, problem: 'unparseable ISO date: ' + JSON.stringify(s) };
    return { iso: d.toISOString(), problem: null };
  }
  return { iso: null, problem: 'unknown date kind ' + kind };
}

// --- ids -------------------------------------------------------------------
function buildId(spec, prefix, row) {
  const raw = row[spec.field];
  if (raw === null || raw === undefined || raw === '') return { id: null, raw: null, problem: spec.field + ' is empty, and it is the only identifier this source offers' };
  if (spec.kind === 'field' || spec.kind === 'field_string') {
    // field_string exists because RemoteOK's id is a STRING and coercing it to a number would drop a
    // leading zero. Both handlers stringify; naming them apart keeps the contract note readable.
    const v = String(raw).trim();
    if (v === '') return { id: null, raw: null, problem: spec.field + ' trims to empty' };
    return { id: prefix + v, raw: v, problem: null };
  }
  if (spec.kind === 'guid_last_segment') {
    const seg = String(raw).split('?')[0].split('#')[0].split('/').filter(Boolean).pop();
    if (!seg) return { id: null, raw: null, problem: 'could not take a last path segment from ' + JSON.stringify(String(raw).slice(0, 120)) };
    return { id: prefix + seg, raw: seg, problem: null };
  }
  if (spec.kind === 'url_regex') {
    const m = new RegExp(spec.pattern).exec(String(raw));
    if (!m || !m[1]) {
      return { id: null, raw: null, problem: 'the url does not match ' + spec.pattern + ', and this source has no id field at all, so there is nothing else to build one from: ' + JSON.stringify(String(raw).slice(0, 120)) };
    }
    return { id: prefix + m[1], raw: m[1], problem: null };
  }
  return { id: null, raw: null, problem: 'unknown id kind ' + spec.kind };
}

// --- fields ----------------------------------------------------------------
function readField(slot, row) {
  if (slot.kind === 'const') return slot.value;
  if (slot.kind === 'bool_field') {
    const v = row[slot.field];
    return typeof v === 'boolean' ? v : null;
  }
  const raw = row[slot.field];
  if (slot.kind === 'field') return plainField(raw);
  if (slot.kind === 'html_excerpt') return truncate(plainText(raw), EXCERPT_MAX);
  if (slot.kind === 'array_join') {
    if (!Array.isArray(raw)) return raw === null || raw === undefined ? null : plainField(raw);
    if (!raw.length) return slot.when_empty;
    return plainField(raw.join(', '));
  }
  if (slot.kind === 'regions') {
    // The separator is a comma and TWO spaces, so a split on ', ' leaves a leading space on every
    // region after the first. Splitting on the comma and trimming is the only shape that survives
    // either separator, which also means a future change back to a single space costs nothing.
    if (raw === null || raw === undefined) return null;
    const parts = String(raw).split(',').map((p) => p.trim()).filter(Boolean);
    return parts.length ? plainField(parts.join(', ')) : null;
  }
  return null;
}

function dig(obj, dotted) {
  let cur = obj;
  for (const part of String(dotted).split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

// --- envelope --------------------------------------------------------------
function resolveBody(res) {
  let body = res.body;
  let reparsed = false;
  if (typeof body === 'string') {
    // A board that stops sending a json content-type would arrive as a string. Parsing it is not a
    // silent rescue: it is recorded, because it means the response changed in a way worth knowing.
    try { body = JSON.parse(body); reparsed = true; } catch (e) { return { body: null, reparsed: false, problem: 'the body arrived as a ' + String(res.body).length + ' character string and is not JSON' }; }
  }
  if (body === null || body === undefined) return { body: null, reparsed: false, problem: 'the response carried no body at all' };
  return { body: body, reparsed: reparsed, problem: null };
}

function resolveRows(spec, body) {
  if (spec.rows_path === null) {
    if (!Array.isArray(body)) {
      return { rows: null, problem: 'the contract says this feed is a bare array and the body is a ' + (Array.isArray(body) ? 'array' : typeof body) + (body && typeof body === 'object' ? ' with keys ' + Object.keys(body).slice(0, 12).join(', ') : ''), keys_seen: (body && typeof body === 'object') ? Object.keys(body).slice(0, 20) : null };
    }
    return { rows: body, problem: null, keys_seen: null };
  }
  if (Array.isArray(body) || typeof body !== 'object') {
    return { rows: null, problem: 'the contract says rows live under "' + spec.rows_path + '" and the body is a ' + (Array.isArray(body) ? 'bare array' : typeof body), keys_seen: null };
  }
  const rows = body[spec.rows_path];
  if (!Array.isArray(rows)) {
    return { rows: null, problem: 'the body has no array at "' + spec.rows_path + '". Keys present: ' + Object.keys(body).slice(0, 20).join(', '), keys_seen: Object.keys(body).slice(0, 20) };
  }
  return { rows: rows, problem: null, keys_seen: Object.keys(body).slice(0, 20) };
}

// --- correlation -----------------------------------------------------------
// The HTTP node emits one item per input item, each stamped with pairedItem.item = the index of the
// call that produced it. Position is only the fallback for an item carrying none. An out-of-range
// pairedItem is NOT rescued by position: it would attach real jobs to the wrong board, which is
// right rows with wrong provenance and nothing anywhere saying so.
function plannedIndexFor(item, i) {
  const pi = item.pairedItem;
  if (typeof pi === 'number') return { idx: pi, via: 'pairedItem' };
  if (pi && typeof pi === 'object' && !Array.isArray(pi) && typeof pi.item === 'number') return { idx: pi.item, via: 'pairedItem' };
  if (Array.isArray(pi) && pi.length && pi[0] && typeof pi[0].item === 'number') return { idx: pi[0].item, via: 'pairedItem' };
  return { idx: i, via: 'position' };
}

// --- classification --------------------------------------------------------
function classify(res) {
  if (res.error !== undefined && res.error !== null && res.error !== false) {
    const e = res.error;
    const msg = (e && typeof e === 'object') ? (e.message || e.description || e.code || JSON.stringify(e).slice(0, 200)) : String(e);
    const code = (e && typeof e === 'object' && typeof e.statusCode === 'number') ? e.statusCode : null;
    if (code !== null && REFUSAL_STATUSES[code]) {
      return { outcome: 'refused', status_code: code, reason: REFUSAL_STATUSES[code] + ' (surfaced as a node error, not as a response)' };
    }
    return { outcome: 'error', status_code: code, reason: 'the request did not complete: ' + msg };
  }
  const status = typeof res.statusCode === 'number' ? res.statusCode : null;
  if (status === null) {
    return { outcome: 'error', status_code: null, reason: 'the response carried no status code. With fullResponse on every real response has one, so this item is not a response.' };
  }
  if (REFUSAL_STATUSES[status]) return { outcome: 'refused', status_code: status, reason: REFUSAL_STATUSES[status] };
  if (status < 200 || status >= 300) return { outcome: 'error', status_code: status, reason: 'HTTP ' + status + ' ' + (res.statusMessage || '') };
  return { outcome: null, status_code: status, reason: null };
}

// ---------------------------------------------------------------------------
// Walk the planned boards. One report each, whatever happened.
// ---------------------------------------------------------------------------
// Index every response by the planned unit it points at. More than one response for the same unit
// is the shape that means the HTTP node split an array feed into one item per job, which would
// otherwise look like a board that answered several times.
//
// pairedItem indexes THIS NODE'S INPUT, not the whole plan. Fetch Board sits behind two routers, so
// its input is the board subset and index 0 is the first BOARD, not the first planned unit. That is
// why the lookup is into planned (filtered, in plan order) and never into plannedAll: indexing the
// full plan here would silently attribute every board's rows to a LinkedIn search term. The subset
// is in plan order because Plan Queries emits LinkedIn, then boards, then Indeed, and neither router
// reorders what it passes through.
const byPlanned = {};
const orphans = [];
for (let i = 0; i < items.length; i += 1) {
  const corr = plannedIndexFor(items[i], i);
  const unit = planned[corr.idx];
  if (!unit) {
    orphans.push({ response_index: i, points_at: corr.idx, via: corr.via });
    continue;
  }
  const slot = byPlanned[unit.source] || (byPlanned[unit.source] = { responses: [], via: corr.via });
  slot.responses.push(items[i]);
}

const rows = [];
const reports = [];
let totalRows = 0;

for (const unit of planned) {
  const key = unit.source;
  const spec = MAPPERS[key];
  const prefix = DEDUP_PREFIX[key];
  const slot = byPlanned[key] || null;
  const warnings = [];

  const report = {
    _kind: 'source_report',
    source: key,
    lane: unit.lane || LANE_NUMBER,
    run_started_at: run.run_started_at || null,
    window_start: unit.window_start || null,
    window_end: unit.window_end || null,
    window_start_effective: unit.window_start_effective || null,
    publish_lag_hours: unit.publish_lag_hours || 0,
    request_url: unit.url || null,
    omitted_params: unit.omitted_params || {},
    verdict: 'down',
    outcome: 'error',
    reason: null,
    source_down: true,
    status_token: 'source_down:' + key,
    status_code: null,
    rows_in_feed: 0,
    rows_emitted: 0,
    rows_unmapped: 0,
    rows_undated: 0,
    rows_in_window: 0,
    rows_outside_window: 0,
    distinct_job_ids: 0,
    duplicate_rows: 0,
    id_collisions: [],
    rows_missing_field: {},
    unmapped_examples: [],
    envelope_observed: {},
    date: { field: unit.date_field, declared_format: unit.date_format, parser: spec.date.kind, unparseable: 0 },
    attribution: ATTRIBUTION[key],
    dedup_id_rule: unit.dedup_id_rule || null,
    probe_required: unit.probe_required || [],
    note: unit.note || null,
    warnings: warnings,
  };

  if (!slot || !slot.responses.length) {
    report.outcome = 'error';
    report.reason =
      'this board was planned and no response item reached the collector at all. The HTTP node emits one item ' +
      'per input item even when a call fails, so a missing item means the branch did not run, not that the feed ' +
      'was empty. Check that Fetch Board is wired to output 1 of Indeed Units Only.';
    warnings.push(report.reason);
    reports.push({ json: report, pairedItem: { item: 0 } });
    continue;
  }

  if (slot.responses.length > 1) {
    report.outcome = 'shape_changed';
    report.verdict = 'down';
    report.reason =
      slot.responses.length + ' response items point at this single planned call. That is the shape n8n produces ' +
      'when an HTTP Request node with responseFormat json and NO fullResponse splits an array response into one ' +
      'item per element, and two of these six boards answer with a bare array. The rows are not lost, but they ' +
      'arrive with no status code and no way to tell which board they came from, so they are reported rather ' +
      'than guessed at. Fix: fullResponse must be true on Fetch Board.';
    warnings.push(report.reason);
    reports.push({ json: report, pairedItem: { item: 0 } });
    continue;
  }
  if (slot.via === 'position') {
    warnings.push('this board was matched to its response by arrival ORDER, because the response carried no pairedItem. Correct here, and fragile: it stops being correct the moment a call produces no item.');
  }

  const res = slot.responses[0].json || {};
  const verdict = classify(res);
  report.status_code = verdict.status_code;

  if (verdict.outcome) {
    report.outcome = verdict.outcome;
    report.reason = verdict.reason;
    report.verdict = 'down';
    if (verdict.outcome === 'refused') {
      warnings.push(
        'REFUSED with HTTP ' + verdict.status_code + '. ' + (ATTRIBUTION[key].required
          ? 'This source makes attribution a condition of access and can suspend or terminate it: ' + ATTRIBUTION[key].obligation
          : 'This source publishes no hard limit, so a refusal here is worth investigating before the next run.') +
        ' This lane makes exactly one call per host per run and does not retry, so the cause is more likely the address or the day\\'s total than this run.'
      );
    }
    reports.push({ json: report, pairedItem: { item: 0 } });
    continue;
  }

  // 2xx. Now the body.
  const resolved = resolveBody(res);
  if (resolved.problem) {
    report.outcome = 'shape_changed';
    report.verdict = 'down';
    report.reason = 'HTTP ' + verdict.status_code + ' and ' + resolved.problem + '. This is NOT an empty feed.';
    warnings.push(report.reason);
    reports.push({ json: report, pairedItem: { item: 0 } });
    continue;
  }
  if (resolved.reparsed) {
    warnings.push('the body arrived as a STRING and had to be JSON.parse-d. The feed stopped declaring a json content type, or n8n stopped detecting it. Worth knowing before it becomes a parse failure.');
  }

  const body = resolved.body;
  for (const path of spec.envelope_report) {
    const v = dig(body, path);
    report.envelope_observed[path] = v === undefined ? null : v;
  }

  const found = resolveRows(spec, body);
  if (found.problem) {
    report.outcome = 'shape_changed';
    report.verdict = 'down';
    report.reason =
      'HTTP ' + verdict.status_code + ' with a real body and the rows are not where the contract says: ' + found.problem + '. ' +
      'Re-read the live response against envelope and field_map for ' + key + ' in the source contract and fix it THERE, ' +
      'in the same session. Read as an empty feed this would be a healthy looking zero for as long as nobody looked.';
    report.envelope_keys_seen = found.keys_seen;
    warnings.push(report.reason);
    reports.push({ json: report, pairedItem: { item: 0 } });
    continue;
  }

  let feedRows = found.rows;
  report.rows_in_feed = feedRows.length;

  if (spec.skip_elements > 0) {
    const skipped = feedRows.slice(0, spec.skip_elements);
    feedRows = feedRows.slice(spec.skip_elements);
    report.elements_skipped = spec.skip_elements;
    // The contract says element 0 of this feed is a legal notice. Checking that it still looks like
    // one costs nothing and catches the day it becomes a real job, which would otherwise be one job
    // silently dropped every run forever.
    const looksRight = skipped.every((el) => el && typeof el === 'object' && (spec.skipped_element_keys || []).some((k) => k in el));
    report.skipped_element_matched_contract = looksRight;
    if (!looksRight) {
      warnings.push(
        'the first ' + spec.skip_elements + ' element(s) of this feed were skipped because the contract says element 0 is a ' +
        'legal notice, and they no longer carry ' + (spec.skipped_element_keys || []).join(' or ') + '. If the notice moved or ' +
        'went away, this lane is dropping a real job every single run. Keys seen: ' + skipped.map((el) => (el && typeof el === 'object') ? Object.keys(el).slice(0, 8).join('/') : typeof el).join(' | ')
      );
    }
  }

  if (spec.watch_string_fields) {
    report.observed_field_types = {};
    const sample = feedRows[0];
    for (const f of spec.watch_string_fields) {
      const v = sample ? sample[f] : undefined;
      report.observed_field_types[f] = v === undefined ? 'absent' : (Array.isArray(v) ? 'array' : typeof v);
    }
  }

  if (!feedRows.length) {
    report.outcome = 'empty';
    report.verdict = 'ok';
    report.source_down = false;
    report.status_token = null;
    report.reason = 'HTTP ' + verdict.status_code + ', the envelope is exactly where the contract says, and it holds zero rows. Read as a genuine empty feed.';
    reports.push({ json: report, pairedItem: { item: 0 } });
    continue;
  }

  // --- map the rows --------------------------------------------------------
  const missingField = {};
  for (const f of ['title', 'company', 'location', 'url', 'apply_url', 'excerpt']) missingField[f] = 0;
  const seenIds = {};
  const idOwner = {};
  let duplicates = 0;
  let unmapped = 0;
  let undated = 0;
  let inWindow = 0;
  let outsideWindow = 0;
  const unmappedExamples = [];
  const cutIso = unit.window_start_effective || unit.window_start || null;
  const cutMs = cutIso ? Date.parse(cutIso) : null;

  for (const raw of feedRows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      unmapped += 1;
      if (unmappedExamples.length < 3) unmappedExamples.push({ why: 'the element is a ' + (Array.isArray(raw) ? 'array' : typeof raw) + ', not a job object' });
      continue;
    }
    const absent = spec.required.filter((f) => raw[f] === undefined || raw[f] === null || raw[f] === '');
    if (absent.length) {
      unmapped += 1;
      if (unmappedExamples.length < 3) {
        unmappedExamples.push({ why: 'required field(s) absent: ' + absent.join(', '), keys_present: Object.keys(raw).slice(0, 16) });
      }
      continue;
    }
    const built = buildId(spec.id, prefix, raw);
    if (!built.id) {
      unmapped += 1;
      if (unmappedExamples.length < 3) unmappedExamples.push({ why: 'no usable id: ' + built.problem, keys_present: Object.keys(raw).slice(0, 16) });
      continue;
    }

    const parsed = parseDate(spec.date.kind, raw[spec.date.field]);
    if (parsed.problem) {
      undated += 1;
      if (unmappedExamples.length < 3) unmappedExamples.push({ why: 'date unparseable, the row is still emitted: ' + parsed.problem, job_id: built.id });
    }

    if (parsed.iso === null) {
      // Nothing to compare, so it is neither in nor out. Counted as undated above; never counted as
      // fresh, because an unknown date silently treated as inside the window is how a stale row
      // reaches the sheet looking new.
    } else if (cutMs !== null) {
      if (Date.parse(parsed.iso) >= cutMs) inWindow += 1; else outsideWindow += 1;
    }

    if (seenIds[built.id]) {
      duplicates += 1;
      if (spec.collision_key) {
        const owner = idOwner[built.id];
        const mine = raw[spec.collision_key] === undefined ? null : String(raw[spec.collision_key]);
        if (owner !== undefined && owner !== mine) {
          report.id_collisions.push({ job_id: built.id, first: owner, second: mine, key: spec.collision_key });
        }
      }
    } else if (spec.collision_key) {
      idOwner[built.id] = raw[spec.collision_key] === undefined ? null : String(raw[spec.collision_key]);
    }
    seenIds[built.id] = (seenIds[built.id] || 0) + 1;

    const values = {
      job_id: built.id,
      found_at: foundAt,
      source: key,
      posted_at: parsed.iso,
      lane: unit.lane || LANE_NUMBER,
    };
    for (const rowField of Object.keys(spec.fields)) values[rowField] = readField(spec.fields[rowField], raw);

    const partial = [];
    for (const f of Object.keys(missingField)) {
      if (values[f] === null || values[f] === undefined) { partial.push(f); missingField[f] += 1; }
    }
    if (parsed.iso === null) partial.push('posted_at');

    const row = { _kind: 'job' };
    for (const k of ROW_SHAPE) row[k] = values[k] === undefined ? null : values[k];
    for (const k of LEFT_FOR_LATER) row[k] = null;
    row._collect = {
      source: key,
      unit: 'board',
      seq: unit.seq,
      of: unit.of,
      request_url: unit.url,
      status_code: verdict.status_code,
      raw_job_id: built.raw,
      dedup_id_rule: unit.dedup_id_rule,
      date_field: unit.date_field,
      date_format: unit.date_format,
      // The raw value, so normalising here loses nothing and a later stage can always re-derive.
      posted_at_raw: raw[spec.date.field] === undefined ? null : raw[spec.date.field],
      posted_at_problem: parsed.problem,
      window_start: unit.window_start,
      // The line Stage E cuts on. Equal to window_start for every board except Remotive, which is
      // shifted back by its publish lag.
      window_start_effective: unit.window_start_effective,
      window_end: unit.window_end,
      publish_lag_hours: unit.publish_lag_hours || 0,
      // Boards are filtered LOCALLY, never server side, so Stage E must cut every one of these rows.
      window_filtered_server_side: false,
      attribution_required: ATTRIBUTION[key].required,
      partial_fields: partial,
      probe_required: unit.probe_required || [],
    };
    rows.push({ json: row, pairedItem: { item: 0 } });
  }

  const emittedCount = feedRows.length - unmapped;
  report.rows_emitted = emittedCount;
  report.rows_unmapped = unmapped;
  report.rows_undated = undated;
  report.rows_in_window = inWindow;
  report.rows_outside_window = outsideWindow;
  report.distinct_job_ids = Object.keys(seenIds).length;
  report.duplicate_rows = duplicates;
  report.rows_missing_field = missingField;
  report.unmapped_examples = unmappedExamples;
  report.date.unparseable = undated;
  totalRows += emittedCount;

  if (emittedCount === 0) {
    // Rows arrived and not one of them mapped. That is the feed answering in a shape this lane does
    // not read, and it is the single most important thing this node can say.
    report.outcome = 'shape_changed';
    report.verdict = 'down';
    report.reason =
      'HTTP ' + verdict.status_code + ' with ' + feedRows.length + ' row(s) in the envelope and NOT ONE of them ' +
      'carried the fields this lane maps (' + spec.required.join(', ') + '). The feed is answering; it is answering ' +
      'in a shape the contract no longer describes. Re-read field_map for ' + key + ' against the live response.';
    warnings.push(report.reason);
  } else if (unmapped > 0) {
    report.outcome = 'ok';
    report.verdict = 'degraded';
    report.source_down = false;
    report.status_token = null;
    report.reason = emittedCount + ' of ' + feedRows.length + ' row(s) mapped. The rest are missing fields this lane requires.';
    warnings.push(
      unmapped + ' row(s) arrived and could not be mapped, so those jobs are missing from the sheet and nothing else ' +
      'would have said so. A skipped row leaves no trace in the output, which is why they are counted here rather than ' +
      'inferred from a total. First reasons: ' + unmappedExamples.map((e) => e.why).join(' | ')
    );
  } else {
    report.outcome = 'ok';
    report.verdict = 'ok';
    report.source_down = false;
    report.status_token = null;
    report.reason = null;
  }

  if (undated > 0) {
    warnings.push(
      undated + ' row(s) carried a date this parser refused, and they are emitted with posted_at null rather than with a ' +
      'guess. The contract declares ' + key + '.' + unit.date_field + ' as: ' + unit.date_format + '. A date guessed wrong ' +
      'moves a job across the freshness boundary and nothing downstream can tell.'
    );
    report.verdict = report.verdict === 'ok' ? 'degraded' : report.verdict;
  }
  if (report.id_collisions.length) {
    warnings.push(
      report.id_collisions.length + ' ID COLLISION(S): two different ' + spec.collision_key + ' values produced the same ' +
      'job_id under the contract rule "' + unit.dedup_id_rule + '". These are different jobs about to be deduped into one. ' +
      'The contract already anticipates this and says to prefix with ' + spec.collision_key + '; that is now due.'
    );
    report.verdict = report.verdict === 'ok' ? 'degraded' : report.verdict;
  }

  // The freshness picture, per source, because this is where a structurally stale feed becomes
  // legible instead of looking like a quiet day.
  if (emittedCount > 0 && inWindow === 0) {
    warnings.push(
      'NOT ONE of the ' + emittedCount + ' mapped row(s) falls inside this run\\'s effective window (nothing newer than ' +
      (unit.window_start_effective || unit.window_start) + (unit.publish_lag_hours ? ', already shifted back ' + unit.publish_lag_hours + 'h for this source\\'s publish lag' : '') +
      '). The feed answered and every row in it is older than the window. Stage E will filter them all out, so this source ' +
      'contributes zero to this run. That is a real zero with a reason, and it is not the same thing as a broken feed.'
    );
  }
  if (spec.short_feed_check) {
    const limit = report.envelope_observed[spec.short_feed_check.rows_field];
    const total = report.envelope_observed[spec.short_feed_check.total_field];
    if (typeof limit === 'number' && feedRows.length < limit) {
      warnings.push(
        'D4: this feed returned ' + feedRows.length + ' row(s) against its own stated limit of ' + limit +
        (typeof total === 'number' ? ' with a totalCount of ' + total : '') + '. The row count does NOT track the limit, so ' +
        '"fewer rows than the limit" must never be read as "that is all there is". Whatever narrows this response, it is not ' +
        'a param this lane sends. The probe is still open.'
      );
    }
    if (report.envelope_observed.nextCursor === null || report.envelope_observed.nextCursor === undefined) {
      warnings.push('D5: no nextCursor in the response, so the cursor pagination the API says it prefers still has nothing to exercise it. Paging this source stays unbuilt rather than built on the offset param the API calls deprecated.');
    }
  }

  reports.push({ json: report, pairedItem: { item: 0 } });
}

// --- stage level notes -----------------------------------------------------
const stageWarnings = [];
if (orphans.length) {
  stageWarnings.push(
    orphans.length + ' response item(s) could not be matched to any planned board unit: ' +
    orphans.map((o) => 'response ' + (o.response_index + 1) + ' points at plan index ' + o.points_at + ' via ' + o.via).join('; ') +
    '. They are reported rather than parsed, because a row whose board is unknown cannot be attributed, and three of ' +
    'these six sources require attribution as a condition of access.'
  );
}
if (items.length !== planned.length) {
  stageWarnings.push('expected one response per planned board (' + planned.length + ') and got ' + items.length + '.');
}
const disabledBoards = disabledSources.filter((d) => BOARD_KEYS.indexOf(d.source) !== -1);
if (disabledBoards.length) {
  stageWarnings.push(
    disabledBoards.length + ' board(s) are switched OFF in the settings tab and cost zero calls this run: ' +
    disabledBoards.map((d) => d.source).join(', ') + '. A disabled source emits no report of its own because n8n skips a ' +
    'node with empty input, so this line is the only place it appears. Stage F reads disabled_sources from Plan Queries.'
  );
}
for (const r of reports) {
  r.json.stage = {
    boards_planned: planned.length,
    boards_disabled: disabledBoards.map((d) => d.source),
    boards_reporting: reports.length,
    rows_emitted_all_boards: totalRows,
    pacing: PACING,
    not_collected_here: Array.from(new Set(otherPlanned.map((u) => u.source))),
    warnings: stageWarnings,
  };
}

// The reports go LAST and they always go, one per planned board, even for a board that was refused
// and produced zero rows. A Code node returning [] ends the branch, which would delete the evidence
// of the exact failure this node exists to report.
return rows.concat(reports);
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/18-extract-board-jobs.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const BOARD_KEYS = ${JSON.stringify(BOARD_KEYS)};`,
  `const MAPPERS = ${JSON.stringify(MAPPERS)};`,
  `const DEDUP_PREFIX = ${JSON.stringify(DEDUP_PREFIX)};`,
  `const ROW_SHAPE = ${JSON.stringify(CONTRACT.shared_row_shape)};`,
  `const LEFT_FOR_LATER = ${JSON.stringify(LEFT_FOR_LATER)};`,
  `const REFUSAL_STATUSES = ${JSON.stringify(REFUSAL_STATUSES)};`,
  `const ATTRIBUTION = ${JSON.stringify(ATTRIBUTION)};`,
  `const EXCERPT_MAX = ${JSON.stringify(EXCERPT_MAX)};`,
  `const PACING = ${JSON.stringify(PACING)};`,
  `const LANE_NUMBER = ${JSON.stringify(String(L.lane))};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Extract Board Jobs',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1820, 480],
  connectFrom: 'Fetch Board',
  notes:
    'Six board feeds into the shared row shape, one source_report per PLANNED board whatever happened to it. ' +
    'A 2xx whose rows are not where the contract says is reported as a changed shape, never as an empty feed. ' +
    'posted_at is normalised to ISO UTC here because three date formats arrive and one column receives them. ' +
    'No dedupe and no freshness cut: both are counted and reported, and both belong to later stages.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

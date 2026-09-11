'use strict';
/*
 * 25-board-page-guard.js - CURSOR PAGING for the board branch, same capped-loop shape as the
 * LinkedIn guard next door and as the Indeed poll guard before it.
 *
 * WHERE IT SITS (the file number is 25 only because 01 to 22 were taken):
 *
 *     Indeed Units Only [out1] --\
 *                                 > Fetch Board -> Board Page Guard -> More Board Pages?
 *     Board Page Pause -----------/                                      [out0] -> Board Page Pause -> Fetch Board
 *                                                                        [out1] -> Extract Board Jobs
 *
 * WHY THE LOOP GOES ROUND `Fetch Board` AND NOT ROUND A HIMALAYAS-ONLY NODE. Splitting Himalayas
 * onto its own branch would give `Extract Board Jobs` two incoming sources, and a node fed by two
 * branches RUNS TWICE, once per branch, each run seeing one of them (measured on this box in Stage
 * E, execution 5065 of another project: nine branches into one Code node produced nine runs). The
 * board extractor emits one source_report per PLANNED board and counts rows across all six; split in
 * two it would emit two half reports. Looping the shared fetch node costs nothing, because after the
 * first pass the loop carries only the pageable source's next page: one item, one call.
 *
 * WHY IT IS A CURSOR AND NOT AN OFFSET (D5, settled 2026-09-11 by probe). The API's own comments
 * field has said since 21/08/2026 that cursor pagination is preferred and that `offset` is
 * deprecated and will be removed. Two earlier probes found no `nextCursor` anywhere, so the contract
 * was to be trusted about the offset being deprecated and could not be trusted about the cursor
 * existing. The depth probes found why: the lane was reading `/jobs/api/search`, a SAMPLE surface
 * that ignores `limit`, never emits a cursor, and served 7 rows while claiming a totalCount of
 * 105546. `/jobs/api` is the real feed: 20 ordered rows a page, `nextCursor` present, and passing it
 * back returns the next 20 with ZERO overlap. That is D19, and it is the largest under-collection
 * this build found. The cursor was verified END TO END by following one, not by reading a field name.
 *
 * THE STOP CONDITIONS, four of them, and the FIRST one is the one that normally fires.
 *   1. WINDOW. The feed is ordered pubDate DESCENDING, verified across a page boundary. So once the
 *      OLDEST row on a page falls before this source's effective window start, every later page is
 *      older still and there is nothing left to want. This is why the endpoint change matters twice
 *      over: on the old search surface the rows came back in no order at all (D17), so this rule
 *      would have stopped at a random point, and the contract said so in writing.
 *   2. SHORT PAGE. Fewer rows than the page size means the end of the feed. Also only trustworthy on
 *      this endpoint: the old one returned 7 of a stated 20 on every call forever (D4).
 *   3. NO CURSOR. The API said it would give one and did not, so there is nowhere to go.
 *   4. THE CAP. A per-run page cap, read from the settings tab, then lane.json, then the shipped
 *      default, and CLAMPED in code to a number no settings cell can raise. On a normal 24h window
 *      the window rule fires first: measured density over the two probe pages is about 4 rows an
 *      hour, so a day is on the order of 5 pages. The first 168h run is the case where the cap bites,
 *      and when it does the collector reports the OLDEST pubDate it actually reached, so the gap is
 *      quantified in hours rather than flagged as "truncated".
 *
 * IT HOLDS EVERYTHING BACK UNTIL THE LAST PASS, exactly like the LinkedIn guard, and for the same
 * reason: n8n skips a node with empty input, so an exit branch that stays empty until the end makes
 * `Extract Board Jobs` run EXACTLY ONCE with the whole corpus. Its report is one per planned board
 * with whole-run counts; released per pass it would be one report per board PER PASS.
 * Accumulation is by REPLAY, reading every previous run of the fetch node with
 * `$('Fetch Board').all(0, r)` and re-running the same pure decision from run 0 forward.
 * `$getWorkflowStaticData` was refused here for the reason node 14 gives: it persists ACROSS
 * executions, so a crashed run leaves residue the next morning reads as its own history.
 *
 * WHAT IT PARSES, AND WHAT IT LEAVES ALONE. It reads exactly three things off a page: the rows
 * container, the cursor field and the date field, and every one of those three names comes from the
 * contract's `pagination` block rather than from this file. It does not map rows, classify outcomes
 * or normalise anything; the response is passed through untouched so the extractor classifies
 * exactly the bodies the boards sent.
 */

const { sources } = require('./_lane');
const CONTRACT = sources();
const SRC = CONTRACT.sources;

const HTTP_NODE = require('./17-fetch-board.js');
const PLAN_NODE = require('./05-plan-queries.js');
const EXTRACT_NODE = require('./18-extract-board-jobs.js');

// THE CLAMP. Not configurable, on purpose. These are the bounds past which no settings cell can take
// this lane. A configurable cap is a convenience; the clamp is the guard.
const HARD_MAX_PAGES_PER_SOURCE = 40;
const HARD_MAX_PASSES = 45;

// Which board sources page, and how. READ from Plan Queries' generated BOARD_PAGINATION rather than
// declared here, so the contract is the one place that decides. Plan Queries already refuses to
// build when the contract and its own BOARD_PLAN disagree about whether a board is paged, so the
// chain is: contract changes -> Plan Queries refuses until it is classified -> this node follows.
const BOARD_PAGINATION = (function readBoardPagination() {
  const code = PLAN_NODE.parameters.jsCode;
  const m = /const BOARD_PAGINATION = (\{.*?\});\n/.exec(code);
  if (!m) {
    throw new Error(
      'Board Page Guard: could not read BOARD_PAGINATION out of 05-plan-queries.js.\n' +
      '  That line is how this node learns which boards page and on what field. A local copy here would\n' +
      '  be two lists, which is how a board gets planned as paged and never paged, or paged on a field\n' +
      '  nobody verified.'
    );
  }
  return JSON.parse(m[1]);
}());

const PAGED_KEYS = Object.keys(BOARD_PAGINATION);

(function assertAgainstContract() {
  if (!PAGED_KEYS.length) {
    throw new Error(
      'Board Page Guard: no board in the contract carries a verified pagination block, so this node has\n' +
      '  nothing to page and every pass would be a pass-through. Take it out of the graph deliberately\n' +
      '  rather than leaving a loop in a weekday workflow that can never do anything.'
    );
  }
  for (const key of PAGED_KEYS) {
    const s = SRC[key];
    if (!s) throw new Error('Board Page Guard: Plan Queries pages a board called ' + key + ' and the contract has no such source.');
    const pag = s.pagination || {};
    if (pag.verified !== true) throw new Error('Board Page Guard: ' + key + ' is planned as paged and its contract pagination is not verified. Paging on an unproven mechanism is what D5 spent two probes refusing to do.');
    if (pag.kind !== 'cursor') throw new Error('Board Page Guard: ' + key + ' declares pagination.kind "' + pag.kind + '" and this node only implements cursor paging.');
    if (typeof pag.page_size !== 'number' || pag.page_size < 1) throw new Error('Board Page Guard: ' + key + ' pagination.page_size is ' + JSON.stringify(pag.page_size) + '. The short-page stop rule compares against that number.');
    if (!pag.ordering || !/descending/i.test(pag.ordering)) {
      throw new Error(
        'Board Page Guard: ' + key + ' pagination has no DESCENDING ordering claim.\n' +
        '  The window stop rule pages until the oldest row on a page falls before the window, and that is\n' +
        '  only valid on a descending feed. The old /jobs/api/search surface returned rows spanning twelve\n' +
        '  days in no order at all (D17), and this rule on that surface would have stopped at random.'
      );
    }
    if (!/unix seconds/i.test(s.date_format || '')) {
      throw new Error('Board Page Guard: ' + key + ' declares date_format "' + s.date_format + '" and this node only parses unix seconds for the window stop rule. A second date shape would compare NaN and page to the cap every run.');
    }
  }
  const resp = HTTP_NODE.parameters.options.response.response;
  if (resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error('Board Page Guard: 17-fetch-board.js no longer sets fullResponse and neverError. Without them a refusal arrives with no status code and this node would read it as a page with no cursor, which means "done" and stops paging silently.');
  }
  if (resp.responseFormat !== 'json') {
    throw new Error('Board Page Guard: 17-fetch-board.js responseFormat is ' + JSON.stringify(resp.responseFormat) + '. This node walks a parsed envelope for the cursor.');
  }
  if (HTTP_NODE.retryOnFail || HTTP_NODE.maxTries) {
    throw new Error('Board Page Guard: 17-fetch-board.js has grown a retry. n8n retries the NODE, so one retry inside a paging loop is a second call to EVERY board on every pass, against a source whose terms allow about four calls a day.');
  }
  if (!/_unit/.test(EXTRACT_NODE.parameters.jsCode)) {
    throw new Error(
      'Board Page Guard: 18-extract-board-jobs.js does not mention _unit.\n' +
      '  This node stamps every response with the planned unit that produced it, because pages past the\n' +
      '  first have no entry in Plan Queries to correlate against. An extractor still correlating by\n' +
      '  position would attribute a Himalayas page 3 to whichever board sat at that index.'
    );
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Board Page Guard. Replays every pass, decides the next one, releases at the end.
// ---------------------------------------------------------------------------
const runIndex = typeof $runIndex === 'number' ? $runIndex : 0;

let plannedAll;
try {
  plannedAll = $(PLAN_NODE_NAME).all().map((i) => i.json);
} catch (e) {
  throw new Error('Board Page Guard: cannot reach ' + PLAN_NODE_NAME + ' (' + e.message + '). The base plan is the first pass, so without it this node cannot replay anything.');
}
const base = plannedAll.filter((j) => j.unit === 'board');
if (!base.length) {
  throw new Error('Board Page Guard: ' + PLAN_NODE_NAME + ' planned no board units, yet this node is running. Something is routing other work into the board branch.');
}

const runBlock = base[0].run || {};
const P = runBlock.paging || {};
const capsIn = P.caps || {};
const capSrc = P.caps_source || {};

const clamped = [];
function cap(name, hard, fallback) {
  let v = capsIn[name];
  let from = capSrc[name] || 'missing';
  if (typeof v !== 'number' || !isFinite(v) || Math.floor(v) !== v || v < 1) {
    clamped.push({ cap: name, was: v === undefined ? null : v, now: fallback, why: 'not a whole number of 1 or more, so the shipped fallback applies' });
    v = fallback;
    from = 'fallback in the guard';
  }
  if (v > hard) {
    clamped.push({ cap: name, was: v, now: hard, why: 'above the hard clamp in 25-board-page-guard.js, which no settings cell can raise' });
    v = hard;
    from = from + ', clamped';
  }
  return { value: v, from: from };
}
// One cap per pageable source. Today that is himalayas alone, and its cap key is named after it, so
// a second pageable board would need its own key rather than quietly sharing this one.
const CAPS = {};
for (const key of PAGED_KEYS) {
  CAPS[key] = cap(key + '_max_pages_per_run', HARD_MAX_PAGES_PER_SOURCE, 3);
}

// --- reading a page --------------------------------------------------------
function bodyOf(res) {
  let b = res ? res.body : undefined;
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch (e) { return null; }
  }
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  return b;
}

function readPage(res, spec, cutMs) {
  const err = res && res.error;
  if (err !== undefined && err !== null && err !== false) {
    return { ok: false, why: 'the call did not complete', cursor: null, rows: 0, oldest: null, reached_window: false };
  }
  const status = (res && typeof res.statusCode === 'number') ? res.statusCode : null;
  if (status === null) return { ok: false, why: 'no status code on the response', cursor: null, rows: 0, oldest: null, reached_window: false };
  if (status < 200 || status >= 300) return { ok: false, why: 'HTTP ' + status, cursor: null, rows: 0, oldest: null, reached_window: false };
  const body = bodyOf(res);
  if (!body) return { ok: false, why: 'the body is not an object this node can read a cursor out of', cursor: null, rows: 0, oldest: null, reached_window: false };

  const rowsRaw = body[spec.rows_path];
  const rows = Array.isArray(rowsRaw) ? rowsRaw : [];
  const cursorRaw = body[spec.cursor_field];
  const cursor = (typeof cursorRaw === 'string' && cursorRaw !== '') ? cursorRaw : null;

  // The oldest publish timestamp on this page. Unix seconds, asserted at build time against the
  // contract's declared date_format, so a format change fails the build rather than comparing NaN.
  let oldest = null;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const v = Number(r[spec.date_field]);
    if (!isFinite(v)) continue;
    const ms = v * 1000;
    if (oldest === null || ms < oldest) oldest = ms;
  }
  const reachedWindow = (cutMs !== null && oldest !== null && oldest < cutMs);
  return { ok: true, why: null, status: status, cursor: cursor, rows: rows.length, oldest: oldest, reached_window: reachedWindow };
}

// --- the url rewrite -------------------------------------------------------
// Plan Queries assembled the page 1 url with the cursor param DROPPED, because an empty param is not
// the same request as no param. The next page is that url with the cursor set. The value is opaque
// by contract: it is passed back verbatim, never constructed.
function withCursor(url, param, value) {
  let u = String(url);
  const re = new RegExp('([?&])' + param + '=[^&]*&?', 'g');
  u = u.replace(re, '$1').replace(/[?&]$/, '');
  return u + (u.indexOf('?') === -1 ? '?' : '&') + param + '=' + encodeURIComponent(String(value));
}

// --- correlate one pass ----------------------------------------------------
function pairIndex(item, i) {
  const pi = item.pairedItem;
  if (typeof pi === 'number') return { idx: pi, via: 'pairedItem' };
  if (pi && typeof pi === 'object' && !Array.isArray(pi) && typeof pi.item === 'number') return { idx: pi.item, via: 'pairedItem' };
  if (Array.isArray(pi) && pi.length && pi[0] && typeof pi[0].item === 'number') return { idx: pi[0].item, via: 'pairedItem' };
  return { idx: i, via: 'position' };
}

let correlationDegraded = false;
const orphans = [];
// A REPLAY SANITY CHECK, and it is here because of the one thing in this node that has never run on
// the box. The whole design rests on $("node").all(0, r) returning run r, which n8n documents. If an
// n8n version ever ignored the runIndex argument and returned the CURRENT run instead, the replay
// would re-read the same responses for every pass. That would not throw: it would quietly attribute
// a page to the wrong query, which is real rows with wrong provenance and the exact failure this
// lane keeps refusing. It IS detectable, because the pass sizes differ once anything stops paging:
// a replayed run whose item count does not match that pass's unit count is the signature. So it is
// checked, and the warning names the cause rather than leaving the next person to find it.
function replayMismatchNote(passesArr, pairsArr) {
  const rows = [];
  for (let q = 0; q < pairsArr.length; q += 1) {
    const want = passesArr[q] ? passesArr[q].length : null;
    const got = pairsArr[q] ? pairsArr[q].length : 0;
    if (want !== null && want !== got) rows.push({ pass: q, units_requested: want, responses_read_back: got });
  }
  if (!rows.length) return null;
  return {
    passes: rows,
    likely_cause: 'a replayed pass read back a different number of responses than it requested. The usual cause is benign (a call produced no item), but the one to rule out FIRST is that $("' + HTTP_NODE_NAME + '").all(0, runIndex) is not honouring its runIndex argument on this n8n version, which would make every pass replay the same responses and attribute pages to the wrong unit. Compare the pass sizes below: if they are all equal to the LAST pass, that is the signature.',
  };
}

function zip(units, items, pass) {
  const out = [];
  if (items.length !== units.length) correlationDegraded = true;
  for (let i = 0; i < items.length; i += 1) {
    const corr = pairIndex(items[i], i);
    const unit = units[corr.idx];
    if (!unit) {
      orphans.push({ pass: pass, response_index: i, points_at: corr.idx, of: units.length, via: corr.via });
      correlationDegraded = true;
      continue;
    }
    if (corr.via === 'position') correlationDegraded = true;
    out.push({ unit: unit, res: items[i].json || {}, via: corr.via, pass: pass });
  }
  return out;
}

// --- the decision, pure and therefore replayable ---------------------------
function decideNext(pairs, pagesSoFar) {
  const units = [];
  const stops = [];
  for (const p of pairs) {
    const key = p.unit.source;
    const spec = BOARD_PAGINATION[key];
    if (!spec) { p.page = null; continue; }
    const cutIso = p.unit.window_start_effective || p.unit.window_start || null;
    const cutMs = cutIso ? Date.parse(cutIso) : null;
    const page = readPage(p.res, spec, isFinite(cutMs) ? cutMs : null);
    p.page = page;

    const taken = (pagesSoFar[key] || 0);
    if (!page.ok) { stops.push({ source: key, reason: 'not_ok', detail: page.why, pages: taken }); continue; }
    if (page.reached_window) {
      stops.push({ source: key, reason: 'window', detail: 'the oldest row on this page is ' + new Date(page.oldest).toISOString() + ', before the effective window start ' + cutIso + ', and the feed is ordered newest first, so every later page is older still.', pages: taken });
      continue;
    }
    if (page.rows < spec.page_size) {
      stops.push({ source: key, reason: 'short_page', detail: page.rows + ' row(s) against a page size of ' + spec.page_size + ', which on this endpoint means the end of the feed.', pages: taken });
      continue;
    }
    if (!page.cursor) {
      stops.push({ source: key, reason: 'no_cursor', detail: 'the response carried no ' + spec.cursor_field + ', so there is nowhere to go even though the page was full.', pages: taken });
      continue;
    }
    const capped = CAPS[key];
    if (taken >= capped.value) {
      stops.push({
        source: key,
        reason: 'page_cap',
        detail: 'stopped at the cap of ' + capped.value + ' page(s) per run (' + capped.from + ') with a full page and a live cursor still in hand. The oldest row reached was ' +
          (page.oldest === null ? 'unknown' : new Date(page.oldest).toISOString()) + ' and the window wanted back to ' + cutIso + '. This is a SIZED gap, not a failure: raise the cap to close it.',
        pages: taken,
        oldest_reached: page.oldest === null ? null : new Date(page.oldest).toISOString(),
        window_wanted: cutIso,
      });
      continue;
    }
    units.push(Object.assign({}, p.unit, {
      url: withCursor(p.unit.url, spec.param, page.cursor),
      // taken is how many pages of this source have already been REQUESTED, and page indexes are
      // zero based, so the next page's index IS taken: one page fetched means the next one is index 1.
      page_index: taken,
      cursor_used: page.cursor,
    }));
  }
  return { units: units, stops: stops };
}

// --- replay ----------------------------------------------------------------
const passes = [base];
const allPairs = [];
const allStops = [];
let stoppedByPassClamp = false;

for (let r = 0; r <= runIndex; r += 1) {
  let got = null;
  try { got = $(HTTP_NODE_NAME).all(0, r); } catch (e) { got = null; }
  if (!Array.isArray(got)) {
    throw new Error(
      'Board Page Guard: could not read run ' + r + ' of ' + HTTP_NODE_NAME + '. This node replays every pass so it ' +
      'can release the whole corpus at the end, and n8n documents $("node").all(branchIndex, runIndex). Without it ' +
      'the loop would have to keep state between passes, and the only place to keep it persists across executions.'
    );
  }
  if (r === runIndex && got.length !== $input.all().length) {
    correlationDegraded = true;
    orphans.push({ pass: r, response_index: null, points_at: null, of: got.length, via: 'input-vs-replay mismatch: this node received ' + $input.all().length + ' item(s) and run ' + r + ' of ' + HTTP_NODE_NAME + ' reads back ' + got.length });
  }
  const pairs = zip(passes[r], got, r);
  allPairs.push(pairs);

  // Pages taken per source so far, counted from what was actually requested.
  const pagesSoFar = {};
  for (let q = 0; q <= r; q += 1) {
    for (const u of passes[q]) {
      if (BOARD_PAGINATION[u.source]) pagesSoFar[u.source] = (pagesSoFar[u.source] || 0) + 1;
    }
  }
  const next = decideNext(pairs, pagesSoFar);
  for (const st of next.stops) allStops.push(st);

  if (r < runIndex) {
    if (!next.units.length) {
      throw new Error(
        'Board Page Guard: replaying pass ' + r + ' produced no next page, yet ' + HTTP_NODE_NAME + ' ran again (this is ' +
        'pass ' + runIndex + '). The decision is supposed to be pure, so either a response changed between passes or ' +
        'something other than this loop is feeding the board collector. Refusing to guess which.'
      );
    }
    passes.push(next.units);
    continue;
  }

  if (runIndex + 1 >= HARD_MAX_PASSES) stoppedByPassClamp = true;
  if (next.units.length && !stoppedByPassClamp) {
    return next.units.map(function (u) {
      return { json: { page_more: true, url: u.url, source: u.source, page_index: u.page_index, seq: u.seq }, pairedItem: { item: 0 } };
    });
  }

  // --- release ------------------------------------------------------------
  const perSource = {};
  for (const pass of allPairs) {
    for (const p of pass) {
      const k = p.unit.source;
      const slot = perSource[k] || (perSource[k] = { source: k, pageable: !!BOARD_PAGINATION[k], pages: 0, rows_seen: 0, oldest_reached: null, cap: BOARD_PAGINATION[k] ? CAPS[k].value : null, cap_from: BOARD_PAGINATION[k] ? CAPS[k].from : null });
      slot.pages += 1;
      if (p.page && p.page.ok) {
        slot.rows_seen += p.page.rows;
        if (p.page.oldest !== null && (slot.oldest_reached === null || p.page.oldest < slot.oldest_reached)) slot.oldest_reached = p.page.oldest;
      }
    }
  }
  for (const k of Object.keys(perSource)) {
    if (perSource[k].oldest_reached !== null) perSource[k].oldest_reached = new Date(perSource[k].oldest_reached).toISOString();
  }
  // EVERY pass's stop reasons, not just the last one's, for the same reason the LinkedIn guard
  // accumulates its refusals: a source stopped on pass 2 never appears in pass 5's list.
  const stops = allStops.slice();
  if (stoppedByPassClamp) {
    for (const u of next.units) stops.push({ source: u.source, reason: 'pass_clamp', detail: 'the loop hit the hard pass clamp of ' + HARD_MAX_PASSES + ' in 25-board-page-guard.js, which no settings cell can raise.', pages: u.page_index });
  }
  const truncating = stops.filter(function (s) { return s.reason === 'page_cap' || s.reason === 'pass_clamp'; });

  const report = {
    enabled: true,
    pageable_sources: PAGED_KEYS,
    passes: runIndex + 1,
    calls_made: passes.reduce(function (n, p) { return n + p.length; }, 0),
    base_calls: base.length,
    extra_calls: passes.reduce(function (n, p) { return n + p.length; }, 0) - base.length,
    per_source: perSource,
    stops: stops,
    truncated: truncating.length > 0,
    truncated_sources: truncating.map(function (s) { return s.source; }),
    caps: CAPS,
    hard_clamp_pages_per_source: HARD_MAX_PAGES_PER_SOURCE,
    hard_clamp_passes: HARD_MAX_PASSES,
    clamped: clamped,
    stopped_by_pass_clamp: stoppedByPassClamp,
    replay_mismatch: replayMismatchNote(passes, allPairs),
    correlation_degraded: correlationDegraded,
    orphans: orphans,
  };

  const out = [];
  for (const pass of allPairs) {
    for (const p of pass) {
      const carried = {};
      for (const k of Object.keys(p.res)) carried[k] = p.res[k];
      carried.page_more = false;
      carried._unit = p.unit;
      carried._page = {
        index: typeof p.unit.page_index === 'number' ? p.unit.page_index : 0,
        pass: p.pass,
        via: p.via,
        cursor_used: p.unit.cursor_used || null,
        rows_counted: p.page ? p.page.rows : null,
        next_cursor: p.page ? p.page.cursor : null,
        oldest_on_page: (p.page && p.page.oldest !== null && p.page.oldest !== undefined) ? new Date(p.page.oldest).toISOString() : null,
      };
      carried._paging = report;
      out.push({ json: carried, pairedItem: { item: 0 } });
    }
  }
  if (!out.length) {
    throw new Error(
      'Board Page Guard: ' + allPairs.reduce(function (n, p) { return n + p.length; }, 0) + ' response(s) arrived across ' +
      (runIndex + 1) + ' pass(es) and not one could be matched to a planned board unit. Orphans: ' + JSON.stringify(orphans).slice(0, 400)
    );
  }
  return out;
}

throw new Error('Board Page Guard: the replay loop ended without returning, which cannot happen for runIndex ' + runIndex + '.');
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/25-board-page-guard.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const BOARD_PAGINATION = ${JSON.stringify(BOARD_PAGINATION)};`,
  `const PAGED_KEYS = ${JSON.stringify(PAGED_KEYS)};`,
  `const HTTP_NODE_NAME = ${JSON.stringify(HTTP_NODE.name)};`,
  `const PLAN_NODE_NAME = ${JSON.stringify(PLAN_NODE.name)};`,
  `const HARD_MAX_PAGES_PER_SOURCE = ${JSON.stringify(HARD_MAX_PAGES_PER_SOURCE)};`,
  `const HARD_MAX_PASSES = ${JSON.stringify(HARD_MAX_PASSES)};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Board Page Guard',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1690, 480],
  connectFrom: 'Fetch Board',
  notes:
    'Cursor paging for the pageable board(s) (D5, D19). Pages until the oldest row on a page falls before the ' +
    'effective window, or the page is short, or there is no cursor, or the per-run page cap is reached. The cap ' +
    'is read from the settings tab, then lane.json, then the shipped default, and clamped in code to at most ' +
    HARD_MAX_PAGES_PER_SOURCE + ' pages and ' + HARD_MAX_PASSES + ' passes, which no settings cell can raise. ' +
    'Holds every response back until paging is finished so Extract Board Jobs runs exactly once. A cap that bites ' +
    'is reported with the oldest pubDate actually reached, so the gap is measured in hours rather than flagged.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

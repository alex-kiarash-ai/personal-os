'use strict';
/*
 * 23-linkedin-page-guard.js - ADAPTIVE PAGING, and the second max-loops guard in this workflow.
 *
 * WHERE IT SITS, and the number does not say it. This file is numbered 23 because 01 to 22 were
 * already taken and renumbering twenty two files would churn every test that names one. Its place in
 * the graph is between `Search LinkedIn` (07) and `Extract LinkedIn` (08):
 *
 *     LinkedIn Units Only [out0] --\
 *                                   > Search LinkedIn -> LinkedIn Page Guard -> More LinkedIn Pages?
 *     More LinkedIn Pages? [out0] -/                                              [out0] loops back
 *                                                                                 [out1] -> Extract LinkedIn
 *
 * WHY IT EXISTS (D15). The guest page size is 10, proven by probe, and this lane only ever requested
 * start=0. So every one of the 12 BI queries (14 for #35) was truncated at ten rows and nothing said
 * so, because a full page and a genuinely quiet day return the same number. The depth probe settled
 * that it keeps going: start=0, 10 and 20 returned 30 DISTINCT job ids with zero overlap in any pair.
 *
 * SHAHEEN'S RULE, implemented literally: PAGE ONLY WHILE A PAGE COMES BACK FULL. A full page means
 * there may be more, so ask for the next one. A partial page means that query is exhausted, so stop.
 * On a normal 24h window most terms cost exactly one call and only the busy ones cost two, which
 * spends the extra calls precisely where they are earned.
 *
 * WHY THE STOP CONDITION IS A PARTIAL PAGE AND NOT A DATE, which is the obvious alternative and is
 * wrong here. The three probed pages are not in date order WITHIN a page (page 1 runs 09-07, 09-11,
 * 09-09) and page 3 is not older than page 2 on average. A first-old-row rule would stop at a random
 * point. The Stage C note that page 2 was "recency ordered" was an over-read and the contract now
 * says so. A partial page needs no ordering assumption at all.
 *
 * THE HARD PER-RUN CALL CEILING IS THE POINT OF THIS NODE, not a detail of it. The first run is the
 * worst case: a 168 hour backfill makes most queries full, and naive paging would multiply 12 calls
 * without bound against a refusal threshold of roughly ten for a datacenter IP (D20). So:
 *   - the ceiling is checked BEFORE any next page is requested, never after;
 *   - hitting it STOPS paging and keeps every row already collected;
 *   - the truncation is REPORTED with the count of queries left unfinished, because a ceiling that
 *     is hit silently is worse than no ceiling at all;
 *   - and the ceiling caps PAGING, NEVER THE BASE PLAN. A ceiling at or below the base plan buys
 *     zero extra pages and drops nothing. Stage A refused to trim search terms to fit under a
 *     number and that decision stands.
 *
 * THE CEILING CANNOT BE EDITED AWAY. The caps are read from the settings tab when the rows exist,
 * then lane.json, then the shipped default, so Shaheen can tune them from his phone without anyone
 * touching code. That means the number is HAND EDITABLE, and a hand edited cap of 9999 would be an
 * unbounded loop on a weekday cron with nobody in the room. So there is a second ceiling in this
 * file, in code, that the configured one is CLAMPED to, and the clamp is named in the run report.
 * A configurable cap is a convenience; the clamp is the guard.
 *
 * HOW IT ACCUMULATES ACROSS PASSES, and this is the mechanism that makes the loop safe for a
 * MULTI ITEM branch, which the Stage C poll loop never had to be.
 *   n8n skips a node whose input is empty (measured in Stage B). So if this guard emits nothing on
 *   the "finished" branch until the last pass, `Extract LinkedIn` runs EXACTLY ONCE and sees every
 *   response from every pass in one input. If instead each pass released its finished queries,
 *   Extract LinkedIn would run once per pass, each run seeing a slice, and it would emit one
 *   source_report per pass with per-pass counts. That is not a cosmetic difference: the truncation
 *   accounting, the verdict and the duplicate count are all whole-run numbers.
 *   So on every pass but the last this node emits ONLY next-page requests, and on the last pass it
 *   emits the whole corpus. To do that it REPLAYS: it reads every previous run of Search LinkedIn
 *   with `$('Search LinkedIn').all(0, r)` (documented n8n: `.all(branchIndex, runIndex)`) and re-runs
 *   the same pure decision function from run 0 forward, which reconstructs exactly which units were
 *   requested on each pass. Nothing is stored between passes.
 *   `$getWorkflowStaticData` was deliberately NOT used for this, for the same reason node 14 refused
 *   it: static data persists ACROSS EXECUTIONS, so a crashed run would leave residue that the next
 *   morning's run would read as its own history.
 *
 * WHAT IT DOES NOT DO. It does not parse job cards, classify outcomes or build rows. It counts the
 * ONE thing the paging decision needs, how many job ids a page carried, using the SAME regex
 * `Extract LinkedIn` parses with, read back out of that node's generated code at build time rather
 * than written twice. Everything else about a response is passed through untouched, so the extractor
 * classifies exactly the bodies LinkedIn sent.
 */

const { sources } = require('./_lane');
const CONTRACT = sources();
const SRC = CONTRACT.sources;

const SOURCE_KEY = 'linkedin_guest_search';
const S = SRC[SOURCE_KEY];

const HTTP_NODE = require('./07-search-linkedin.js');
const PLAN_NODE = require('./05-plan-queries.js');
const EXTRACT_NODE = require('./08-extract-linkedin.js');

// THE CLAMP. Not configurable, on purpose: see the header. These are the numbers past which no
// settings cell can take this lane, whatever anyone types into the sheet.
const HARD_MAX_CALLS = 60;
const HARD_MAX_PAGES_PER_QUERY = 10;
// A pass is one execution of Search LinkedIn. Even with a huge call budget, this bounds the number
// of times the loop can go round at all, which is the thing that turns a bug into an execution that
// is still running on Friday.
const HARD_MAX_PASSES = 12;

// The card-counting regex, READ from the extractor's generated code so the two can never disagree
// about what a job card looks like. If they disagreed, the guard would page on one count while the
// extractor parsed another, and the truncation number in the report would be fiction.
const URN_REGEX_LITERAL = (function readUrnRegex() {
  const code = EXTRACT_NODE.parameters.jsCode;
  const m = /const RE_URN = (\/.+?\/g);/.exec(code);
  if (!m) {
    throw new Error(
      'LinkedIn Page Guard: could not read RE_URN out of 08-extract-linkedin.js.\n' +
      '  This node counts cards to decide whether a page was FULL, and the extractor parses cards with\n' +
      '  that regex. Declaring a second copy here would be the wrong fix: two definitions is how the\n' +
      '  guard pages on one count while the extractor reports another, and the truncation number in the\n' +
      '  run report becomes fiction that nothing contradicts.'
    );
  }
  return m[1];
}());

(function assertAgainstContract() {
  if (!S) {
    throw new Error('LinkedIn Page Guard: the shared contract has no source called ' + SOURCE_KEY + '. It carries: ' + Object.keys(SRC).join(', '));
  }
  const pag = S.pagination || null;
  if (!pag || pag.verified !== true) {
    throw new Error(
      'LinkedIn Page Guard: the contract no longer calls LinkedIn paging verified.\n' +
      '  This node exists to page it. Building a loop on an unverified step is exactly what D2 spent a\n' +
      '  probe to avoid. If the page size became unknown again, take this node out deliberately rather\n' +
      '  than letting it guess a step.'
    );
  }
  if (typeof S.page_size !== 'number' || S.page_size < 1) {
    throw new Error('LinkedIn Page Guard: contract page_size is ' + JSON.stringify(S.page_size) + '. The full-page test compares against that number.');
  }
  if (pag.step !== S.page_size) {
    throw new Error('LinkedIn Page Guard: the contract says the page size is ' + S.page_size + ' and that start steps by ' + pag.step + '. A loop built on the smaller repeats rows and on the larger skips them.');
  }
  if (pag.param !== 'start') {
    throw new Error('LinkedIn Page Guard: the contract pages on "' + pag.param + '" and this node rewrites the start param. Change both together.');
  }
  if (!new RegExp('\\{' + pag.param + '\\}').test(S.endpoint)) {
    throw new Error('LinkedIn Page Guard: the endpoint template has no {' + pag.param + '} placeholder, so Plan Queries never puts one in the url and this node has nothing to rewrite.');
  }
  // The response shape this node reads. Both of these are 07's decisions and both are load-bearing
  // here: without fullResponse there is no statusCode to refuse on, and without outputPropertyName
  // 'body' the body arrives under `data` and every page counts zero cards and looks exhausted.
  const resp = HTTP_NODE.parameters.options.response.response;
  if (resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error('LinkedIn Page Guard: 07-search-linkedin.js no longer sets fullResponse and neverError. Without them a refusal arrives as an error string with no status code, and this node would read it as a page with zero cards, which means "exhausted" and stops paging silently.');
  }
  if (resp.outputPropertyName !== 'body') {
    throw new Error('LinkedIn Page Guard: 07-search-linkedin.js outputPropertyName is ' + JSON.stringify(resp.outputPropertyName) + '. This node counts cards in json.body. With any other name every page counts zero cards, reads as exhausted, and paging silently never happens.');
  }
  if (HTTP_NODE.retryOnFail || HTTP_NODE.maxTries) {
    throw new Error('LinkedIn Page Guard: 07-search-linkedin.js has grown a retry. n8n retries the NODE, so a retry multiplies every call in a pass, and the per-run ceiling in this node counts planned calls rather than attempts. Decide the retry and the ceiling together or the ceiling is not one.');
  }
  if (!(HARD_MAX_CALLS > 0) || !(HARD_MAX_PAGES_PER_QUERY > 0) || !(HARD_MAX_PASSES > 1)) {
    throw new Error('LinkedIn Page Guard: a clamp is not a positive number. These are the only bounds a hand edited settings cell cannot raise.');
  }
  // The extractor has to read the unit off the item, because a page 2 response has no plan unit to
  // correlate to. If it went back to correlating by pairedItem against Plan Queries, every paged
  // response would be attributed to the wrong search term.
  if (!/_unit/.test(EXTRACT_NODE.parameters.jsCode)) {
    throw new Error(
      'LinkedIn Page Guard: 08-extract-linkedin.js does not mention _unit.\n' +
      '  This node stamps every response with the planned unit that produced it, because pages past the\n' +
      '  first have no entry in Plan Queries to correlate against. An extractor that went back to\n' +
      '  correlating by position would attach real jobs to the wrong search term and report success.'
    );
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// LinkedIn Page Guard. Replays every pass, decides the next one, and releases
// the whole corpus only when the paging is finished.
// ---------------------------------------------------------------------------
const runIndex = typeof $runIndex === 'number' ? $runIndex : 0;

let plannedAll;
try {
  plannedAll = $(PLAN_NODE_NAME).all().map((i) => i.json);
} catch (e) {
  throw new Error('LinkedIn Page Guard: cannot reach ' + PLAN_NODE_NAME + ' (' + e.message + '). The base plan is the first pass, so without it this node cannot replay anything.');
}
const base = plannedAll.filter((j) => j.source === SOURCE_KEY);
if (!base.length) {
  throw new Error('LinkedIn Page Guard: ' + PLAN_NODE_NAME + ' planned no ' + SOURCE_KEY + ' units, yet this node is running. Something is routing other work into the LinkedIn branch.');
}

const runBlock = base[0].run || {};
const P = runBlock.paging || {};
const capsIn = P.caps || {};
const capSrc = P.caps_source || {};
const LI = P.linkedin || {};

// --- the caps, clamped -----------------------------------------------------
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
    clamped.push({ cap: name, was: v, now: hard, why: 'above the hard clamp in 23-linkedin-page-guard.js, which no settings cell can raise' });
    v = hard;
    from = from + ', clamped';
  }
  return { value: v, from: from };
}
const maxCalls = cap('linkedin_max_calls_per_run', HARD_MAX_CALLS, Math.min(HARD_MAX_CALLS, base.length + 4));
const maxPages = cap('linkedin_max_pages_per_query', HARD_MAX_PAGES_PER_QUERY, 2);

// --- counting a page -------------------------------------------------------
const RE_URN_COUNT = ${'$'}{RE_URN_PLACEHOLDER};
function countCards(html) {
  RE_URN_COUNT.lastIndex = 0;
  let n = 0;
  while (RE_URN_COUNT.exec(html)) n += 1;
  return n;
}

// A page is PAGEABLE only when it came back as a clean 2xx. Anything else stops that query: paging
// into a refusal is how a soft block becomes a hard one, and paging into an error is asking a
// question that already failed.
function readPage(res) {
  const err = res && res.error;
  if (err !== undefined && err !== null && err !== false) {
    return { ok: false, why: 'the call did not complete', status: (err && typeof err === 'object' && typeof err.statusCode === 'number') ? err.statusCode : null, cards: 0 };
  }
  const status = (res && typeof res.statusCode === 'number') ? res.statusCode : null;
  if (status === null) return { ok: false, why: 'no status code on the response', status: null, cards: 0 };
  if (status < 200 || status >= 300) return { ok: false, why: 'HTTP ' + status, status: status, cards: 0 };
  const body = (res && typeof res.body === 'string') ? res.body : (res && res.body !== undefined && res.body !== null ? String(res.body) : '');
  return { ok: true, why: null, status: status, cards: countCards(body) };
}

// --- the url rewrite -------------------------------------------------------
// Plan Queries already assembled and encoded the page 1 url, so the next page is that url with one
// param moved. Rebuilding it from the endpoint template here would be a second place for the
// endpoint to live, which is the thing this lane keeps refusing.
function withStart(url, value) {
  const u = String(url);
  const re = new RegExp('([?&]' + PAGE_PARAM + '=)[^&]*');
  if (re.test(u)) return u.replace(re, '$1' + encodeURIComponent(String(value)));
  return u + (u.indexOf('?') === -1 ? '?' : '&') + PAGE_PARAM + '=' + encodeURIComponent(String(value));
}

// --- correlate one pass ----------------------------------------------------
// pairedItem.item indexes THIS PASS'S input, which is the unit list for this pass and not the whole
// plan. An out of range pairedItem is reported, never rescued by position: rescuing it would attach
// a real page of jobs to the wrong search term, and nothing anywhere would say so.
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
    out.push({ unit: unit, item: items[i], res: items[i].json || {}, via: corr.via, pass: pass });
  }
  return out;
}

// --- the decision, pure and therefore replayable ---------------------------
// Given one pass's (unit, response) pairs and how many calls the run has already spent, decide the
// NEXT pass. Pure: same inputs, same output, which is what makes replaying from run 0 legitimate.
function decideNext(pairs, callsUsed) {
  const candidates = [];
  const unfollowed = [];
  for (const p of pairs) {
    const page = readPage(p.res);
    p.page = page;
    if (!page.ok) continue;
    if (page.cards < PAGE_SIZE) continue;
    const nextIndex = (typeof p.unit.page_index === 'number' ? p.unit.page_index : 0) + 1;
    if (nextIndex >= maxPages.value) {
      unfollowed.push({ seq: p.unit.seq, term: p.unit.term, location_setting: p.unit.location_setting, pages_taken: nextIndex, reason: 'page_cap' });
      continue;
    }
    candidates.push({ unit: p.unit, nextIndex: nextIndex });
  }
  // THE CEILING, checked BEFORE any next page is requested. Breadth first, in plan order, so one
  // busy term cannot spend the whole budget while another never gets a second page.
  const budget = Math.max(0, maxCalls.value - callsUsed);
  const take = candidates.slice(0, budget);
  for (const c of candidates.slice(budget)) {
    unfollowed.push({ seq: c.unit.seq, term: c.unit.term, location_setting: c.unit.location_setting, pages_taken: c.nextIndex, reason: 'call_ceiling' });
  }
  const units = take.map(function (c) {
    const start = (typeof c.unit.start === 'number' ? c.unit.start : 0) + STEP;
    return Object.assign({}, c.unit, {
      url: withStart(c.unit.url, start),
      start: start,
      page_index: c.nextIndex,
      page_of_query: c.unit.seq,
      probe_required: c.unit.probe_required || [],
    });
  });
  return { units: units, unfollowed: unfollowed, candidates: candidates.length };
}

// --- replay ----------------------------------------------------------------
if (!LI.verified || typeof PAGE_SIZE !== 'number' || typeof STEP !== 'number') {
  // The contract un-verified the page size. Pass everything straight through rather than guess a
  // step: a loop on an unproven step repeats rows or skips them, and both look healthy.
  const items0 = $input.all();
  return items0.map(function (it, i) {
    const u = base[i] || null;
    return { json: Object.assign({}, it.json, {
      page_more: false,
      _unit: u,
      _page: { index: 0, start: u ? (u.start || 0) : 0, pass: 0, via: 'position' },
      _paging: { source: SOURCE_KEY, enabled: false, reason: 'the contract does not call LinkedIn paging verified, so no page past the first was requested.', passes: 1, calls_made: items0.length, base_calls: base.length, extra_calls: 0, truncated: false, queries_truncated: [], caps: {}, correlation_degraded: false, orphans: [] },
    }), pairedItem: { item: i } };
  });
}

const passes = [base];
const allPairs = [];
// EVERY pass's refusals, not just the last one's. A query the ceiling refused on pass 1 is never
// offered again, so it never appears in pass 2's list, and a report built from the last pass alone
// would under-count the truncation and say the run reached further than it did. That is the exact
// class of quiet under-reporting this whole node exists to prevent.
const allUnfollowed = [];
let stoppedByPassClamp = false;

for (let r = 0; r <= runIndex; r += 1) {
  let got = null;
  try { got = $(HTTP_NODE_NAME).all(0, r); } catch (e) { got = null; }
  if (!Array.isArray(got)) {
    throw new Error(
      'LinkedIn Page Guard: could not read run ' + r + ' of ' + HTTP_NODE_NAME + '. This node replays every ' +
      'pass so it can release the whole corpus at the end, and n8n documents $("node").all(branchIndex, runIndex). ' +
      'Without it the loop would have to keep state between passes, and the only place to keep it persists ' +
      'across executions, which would carry one day\\'s pages into the next.'
    );
  }
  // Cross check on the CURRENT pass only: this node's own input is that same run's output, so if the
  // two disagree the replay is reading a different stream from the one feeding this node, and every
  // number after here would be about the wrong data.
  if (r === runIndex && got.length !== $input.all().length) {
    correlationDegraded = true;
    orphans.push({ pass: r, response_index: null, points_at: null, of: got.length, via: 'input-vs-replay mismatch: this node received ' + $input.all().length + ' item(s) and run ' + r + ' of ' + HTTP_NODE_NAME + ' reads back ' + got.length });
  }
  const pairs = zip(passes[r], got, r);
  allPairs.push(pairs);
  const callsUsed = passes.reduce(function (n, p, idx) { return idx <= r ? n + p.length : n; }, 0);
  const next = decideNext(pairs, callsUsed);
  for (const u of next.unfollowed) allUnfollowed.push(u);
  if (r < runIndex) {
    // Replaying a pass that already happened. The decision must have produced the units that were
    // actually requested, or the replay is not reconstructing history and every later number is wrong.
    if (!next.units.length) {
      throw new Error(
        'LinkedIn Page Guard: replaying pass ' + r + ' produced no next page, yet ' + HTTP_NODE_NAME + ' ran again ' +
        '(this is pass ' + runIndex + '). The decision is supposed to be pure, so either a response changed between ' +
        'passes or something other than this loop is feeding the collector. Refusing to guess which.'
      );
    }
    passes.push(next.units);
    continue;
  }

  // --- the last pass we know about. Continue, or release. ------------------
  if (runIndex + 1 >= HARD_MAX_PASSES) {
    stoppedByPassClamp = true;
  }
  if (next.units.length && !stoppedByPassClamp) {
    // ONE item per next page, carrying the whole unit. Search LinkedIn reads {{ $json.url }} and
    // drops everything else, so the unit is re-read from this node's own replay on the next pass
    // rather than carried through the HTTP node, which cannot carry it.
    return next.units.map(function (u) {
      return { json: { page_more: true, url: u.url, source: SOURCE_KEY, seq: u.seq, term: u.term, start: u.start, page_index: u.page_index }, pairedItem: { item: 0 } };
    });
  }

  // --- release ------------------------------------------------------------
  const perQuery = {};
  for (const pass of allPairs) {
    for (const p of pass) {
      const k = String(p.unit.page_of_query || p.unit.seq);
      const slot = perQuery[k] || (perQuery[k] = { seq: p.unit.page_of_query || p.unit.seq, term: p.unit.term, location_setting: p.unit.location_setting, pages: 0, cards: [], last_ok: null });
      slot.pages += 1;
      slot.cards.push(p.page ? p.page.cards : 0);
      slot.last_ok = p.page ? p.page.ok : false;
    }
  }
  const truncated = allUnfollowed.slice();
  const callsMade = passes.reduce(function (n, p) { return n + p.length; }, 0);
  const byReason = {};
  for (const t of truncated) byReason[t.reason] = (byReason[t.reason] || 0) + 1;
  if (stoppedByPassClamp && next.candidates > 0) {
    byReason.pass_clamp = next.candidates;
  }

  const report = {
    source: SOURCE_KEY,
    enabled: true,
    stop_rule: LI.stop_rule || 'page while a page comes back full',
    page_size: PAGE_SIZE,
    step: STEP,
    passes: runIndex + 1,
    calls_made: callsMade,
    base_calls: base.length,
    extra_calls: callsMade - base.length,
    caps: {
      max_calls_per_run: maxCalls.value,
      max_calls_per_run_from: maxCalls.from,
      max_pages_per_query: maxPages.value,
      max_pages_per_query_from: maxPages.from,
      hard_clamp_calls: HARD_MAX_CALLS,
      hard_clamp_pages_per_query: HARD_MAX_PAGES_PER_QUERY,
      hard_clamp_passes: HARD_MAX_PASSES,
      clamped: clamped,
    },
    pages_per_query: Object.keys(perQuery).map(function (k) { return perQuery[k]; }),
    queries_truncated: truncated,
    truncated: truncated.length > 0 || (stoppedByPassClamp && next.candidates > 0),
    truncation_by_reason: byReason,
    stopped_by_pass_clamp: stoppedByPassClamp,
    replay_mismatch: replayMismatchNote(passes, allPairs),
    correlation_degraded: correlationDegraded,
    orphans: orphans,
    responses_seen: allPairs.reduce(function (n, p) { return n + p.length; }, 0),
    missing_responses: callsMade - allPairs.reduce(function (n, p) { return n + p.length; }, 0),
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
        start: typeof p.unit.start === 'number' ? p.unit.start : 0,
        pass: p.pass,
        via: p.via,
        cards_counted: p.page ? p.page.cards : null,
        full: p.page ? (p.page.ok && p.page.cards >= PAGE_SIZE) : false,
      };
      carried._paging = report;
      out.push({ json: carried, pairedItem: { item: 0 } });
    }
  }
  if (!out.length) {
    // Every response orphaned. The extractor cannot report on nothing, and a Code node returning []
    // ends the branch, so the evidence of the failure would vanish.
    throw new Error(
      'LinkedIn Page Guard: ' + allPairs.reduce(function (n, p) { return n + p.length; }, 0) + ' response(s) arrived across ' +
      (runIndex + 1) + ' pass(es) and not one could be matched to a planned unit. Orphans: ' + JSON.stringify(orphans).slice(0, 400)
    );
  }
  return out;
}

throw new Error('LinkedIn Page Guard: the replay loop ended without returning, which cannot happen for runIndex ' + runIndex + '.');
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/23-linkedin-page-guard.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const SOURCE_KEY = ${JSON.stringify(SOURCE_KEY)};`,
  `const PAGE_SIZE = ${JSON.stringify(S.page_size)};`,
  `const STEP = ${JSON.stringify(S.pagination.step)};`,
  `const PAGE_PARAM = ${JSON.stringify(S.pagination.param)};`,
  `const HTTP_NODE_NAME = ${JSON.stringify(HTTP_NODE.name)};`,
  `const PLAN_NODE_NAME = ${JSON.stringify(PLAN_NODE.name)};`,
  `const HARD_MAX_CALLS = ${JSON.stringify(HARD_MAX_CALLS)};`,
  `const HARD_MAX_PAGES_PER_QUERY = ${JSON.stringify(HARD_MAX_PAGES_PER_QUERY)};`,
  `const HARD_MAX_PASSES = ${JSON.stringify(HARD_MAX_PASSES)};`,
  // Function form on purpose: a string replacement would let a `$` sequence inside the regex
  // literal be read as a capture-group reference and silently mangle the pattern.
  LOGIC.replace('${RE_URN_PLACEHOLDER}', () => URN_REGEX_LITERAL),
].join('\n');

if (!jsCode.includes(URN_REGEX_LITERAL)) {
  throw new Error('LinkedIn Page Guard: the card-counting regex did not land in the generated code. Without it every page counts zero cards, reads as exhausted, and paging silently never happens.');
}

module.exports = {
  name: 'LinkedIn Page Guard',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1430, 0],
  connectFrom: 'Search LinkedIn',
  notes:
    'Adaptive paging (D15). Pages a query only while its page comes back FULL, under a per-run call ceiling ' +
    'read from the settings tab, then lane.json, then the shipped default, and clamped in code to at most ' +
    HARD_MAX_CALLS + ' calls, ' + HARD_MAX_PAGES_PER_QUERY + ' pages per query and ' + HARD_MAX_PASSES + ' passes, ' +
    'which no settings cell can raise. The ceiling caps PAGING, never the base plan. ' +
    'Holds every response back until the paging is finished so Extract LinkedIn runs exactly once and its ' +
    'counts are whole-run numbers. Reports every full page it refused to follow, with the reason.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

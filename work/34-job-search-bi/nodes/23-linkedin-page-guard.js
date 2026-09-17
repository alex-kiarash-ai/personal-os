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
 * AND SINCE 2026-09-12, A SECOND CONDITION: ONLY WHILE THE RUN CAN STILL USE MORE (execution 5182).
 * A full page means there MAY be more, which is true and beside the point when the row cap is going
 * to discard the surplus. Worse than beside the point: a search call and a detail call come out of
 * the same whole-run LinkedIn budget, so an extra page is bought with a DESCRIPTION. On 5182 the
 * search leg spent 20 of the 25 whole-run calls, 9 of them on paging, the detail stage got 5, and
 * 15 of the 20 rows the run kept were scored on their titles alone and can never be enriched,
 * because a written row is deleted as known next run. The 9 pages bought 38 new distinct ids that
 * the cap then discarded to a backlog it re-covers anyway. A job scored on its title is worth much
 * less than a job not yet seen.
 * So the guard now prices a page against a description: it stops asking once the run holds more
 * unique posting ids than it can keep AND describe, by the SAME arithmetic Remove Known uses for the
 * row cap. On a busy window paging does not fire; on a genuinely quiet one it still does, because a
 * quiet window has nothing like the supply the target asks for.
 * THE PRICE IS NAMED RATHER THAN HIDDEN: a page not asked for is not deferred, and once the backlog
 * drains and the window advances nothing comes back for it. The count is on the run row. It is also
 * deliberately NOT counted as a truncation, because truncation holds `last_run_at` and a demand stop
 * does not change between runs of the same window, so counting it would hold the window forever.
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
// The demand multiple is the only cap here whose WRONG direction is more paging, not less, so it
// cannot cause a runaway: the three clamps above still bound the loop whatever it is set to. It is
// clamped anyway, because an unbounded number in a report reads as a number nobody thought about.
const HARD_MAX_DEMAND_MULTIPLE = 50;

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
  // The demand rule counts DISTINCT posting ids, not cards, so the regex has to hand back the id.
  // Without a capture group the guard would still count correctly and would dedupe on the whole
  // match, which happens to contain the id and therefore still works. That is luck rather than
  // design, so it is asserted: if the extractor ever matched something without the id in it, the
  // "unique ids" number would silently become "cards" and the demand stop would fire far too early.
  if (!/\(/.test(m[1])) {
    throw new Error(
      'LinkedIn Page Guard: the card regex in 08-extract-linkedin.js has no capture group: ' + m[1] + '\n' +
      '  The demand rule counts DISTINCT posting ids so it can tell a page of new jobs from a page of\n' +
      '  ones it already has. With nothing captured it would be counting card markup instead, and two\n' +
      '  queries returning the same ten jobs would read as twenty units of supply.'
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
  // --- the demand rule's inputs (added 2026-09-12, execution 5182) ----------------------------
  const { settingsSchema, pagingDefaults } = require('./_lane');
  const SC = settingsSchema();
  for (const k of ['linkedin_detail_max_calls_per_run', 'linkedin_total_max_calls_per_run', 'linkedin_page_demand_multiple']) {
    if (SC.optional_number.indexOf(k) === -1) {
      throw new Error('LinkedIn Page Guard: ' + k + ' is not an optional number in the settings schema. The demand rule prices an extra page against a description, and it cannot do that without all three.');
    }
  }
  if (SC.number.indexOf('max_scored_per_run') === -1) {
    throw new Error('LinkedIn Page Guard: max_scored_per_run is no longer a required number in the settings schema. The demand rule stops paging once the run holds more supply than it can keep, and that ceiling is the number it compares against.');
  }
  if (SC.switch.indexOf('source_linkedin_guest_detail') === -1) {
    throw new Error('LinkedIn Page Guard: source_linkedin_guest_detail is not a switch in the settings schema. With the detail fetch off there is no description to protect and an extra page costs nothing, so the demand rule has to read it or it would stop paging for a reason that does not apply.');
  }
  if (typeof pagingDefaults().values.linkedin_page_demand_multiple !== 'number') {
    throw new Error('LinkedIn Page Guard: the shipped paging defaults carry no linkedin_page_demand_multiple, so a sheet with no row for it would have no demand target at all.');
  }
  // The row cap this node prices a page against is applied in Remove Known, and the two have to mean
  // the same thing by the same arithmetic. Read rather than remembered.
  const removeKnown = require('./22-remove-known.js');
  const rkCode = String(removeKnown.parameters.jsCode || '');
  if (rkCode.indexOf('const detailBudget = Math.min(detailStageCap.value, remainingTotal);') === -1) {
    throw new Error(
      'LinkedIn Page Guard: 22-remove-known.js no longer computes its detail budget as\n' +
      '  min(per-stage cap, whole-run total minus the search spend).\n' +
      '  This node stops paging once the run already holds more supply than that budget can describe,\n' +
      '  so if the cap downstream changed shape, this node would be refusing pages against a number\n' +
      '  nobody applies any more, and the run would collect less for no reason at all.'
    );
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
const demandMultiple = cap('linkedin_page_demand_multiple', HARD_MAX_DEMAND_MULTIPLE, DEFAULT_DEMAND_MULTIPLE);
const detailStageCapV = cap('linkedin_detail_max_calls_per_run', HARD_MAX_DEMAND_MULTIPLE * 1000, DEFAULT_DETAIL_CALLS).value;
const totalCapV = cap('linkedin_total_max_calls_per_run', HARD_MAX_DEMAND_MULTIPLE * 1000, DEFAULT_TOTAL_CALLS).value;

// The row ceiling the demand rule prices a page against. It rides on the plan next to the filters,
// which is where Filter and Remove Known both read it from. Unusable means the demand rule is OFF
// and paging behaves exactly as it did before it existed, which is stated in the report rather than
// left as a silently different run.
let MAX_SCORED = null;
let demandOffBecause = null;
{
  const f = (base[0] && base[0].filters) || {};
  const v = Number(f.max_scored_per_run);
  if (isFinite(v) && v >= 1) MAX_SCORED = Math.floor(v);
  else demandOffBecause = 'max_scored_per_run reached this node as ' + JSON.stringify(f.max_scored_per_run) + ', so there is no row ceiling to price a page against';
}
// With the detail fetch switched OFF there is no description to protect, so an extra page costs
// nothing but time and the demand target is the row ceiling alone. UNREADABLE is treated as OFF,
// which is the direction that pages MORE: the detail gate reads the same switch and makes zero calls
// when it cannot read it, so the calls an extra page spends were not going to buy a description.
let detailOn = false;
try {
  const cfgItems = $('Parse Settings').all().map((i) => i.json);
  const cfg = {};
  for (const c of cfgItems) if (c && typeof c === 'object') Object.assign(cfg, c);
  if (typeof cfg.source_linkedin_guest_detail === 'boolean') detailOn = cfg.source_linkedin_guest_detail;
} catch (e) {
  detailOn = false;
}

// --- counting a page, and counting what is NEW on it -----------------------
// The demand rule needs DISTINCT posting ids, not cards. Measured on execution 5182: 20 calls
// returned 200 cards carrying only 88 distinct ids, because eleven search terms aimed at the same
// market return the same jobs. Counting cards would have read that as 200 units of supply.
const RE_URN_COUNT = ${'$'}{RE_URN_PLACEHOLDER};
function pageIds(html) {
  RE_URN_COUNT.lastIndex = 0;
  const ids = [];
  let m;
  while ((m = RE_URN_COUNT.exec(html))) ids.push(m[1] === undefined ? m[0] : m[1]);
  return ids;
}

// A page is PAGEABLE only when it came back as a clean 2xx. Anything else stops that query: paging
// into a refusal is how a soft block becomes a hard one, and paging into an error is asking a
// question that already failed.
function readPage(res) {
  const err = res && res.error;
  if (err !== undefined && err !== null && err !== false) {
    return { ok: false, why: 'the call did not complete', status: (err && typeof err === 'object' && typeof err.statusCode === 'number') ? err.statusCode : null, cards: 0, ids: [] };
  }
  const status = (res && typeof res.statusCode === 'number') ? res.statusCode : null;
  if (status === null) return { ok: false, why: 'no status code on the response', status: null, cards: 0, ids: [] };
  if (status < 200 || status >= 300) return { ok: false, why: 'HTTP ' + status, status: status, cards: 0, ids: [] };
  const body = (res && typeof res.body === 'string') ? res.body : (res && res.body !== undefined && res.body !== null ? String(res.body) : '');
  const ids = pageIds(body);
  return { ok: true, why: null, status: status, cards: ids.length, ids: ids };
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

// --- DEMAND: how much supply this run can actually use ----------------------
// A search call and a detail call come out of the SAME whole-run LinkedIn budget, so an extra page
// of results is bought with a description. On execution 5182 the search leg spent 20 of 25, the
// detail stage got 5, and 15 of the 20 rows this run kept went to the scorer on their titles alone,
// permanently, because a written row is deleted as known next run. A job scored on its title is
// worth much less than a job not yet seen, and the surplus this paging bought was going to be
// discarded by the row cap anyway.
//
// So a full page no longer means "ask for the next one" on its own. It means that only while the
// run holds less supply than it can keep AND describe.
//
// WHAT IT CANNOT SEE, stated because it is the honest limit of the rule: these are RAW ids, before
// the title filter and before dedupe against the jobs tab. The gap is covered by a MULTIPLE rather
// than pretended away. Measured on 5182, 26 of 50 distinct ids from page 1 survived the filter
// (52%), 40 of 88 across both pages (45%); the shipped multiple of 3 therefore stops with roughly
// 1.35x the cap in expected survivors. The count is also LinkedIn-only while the cap counts every
// source, which under-states supply, so that error runs toward more paging as well.
//
// THE PRICE, and it is real: a page this rule does not ask for is a full page nobody follows, and
// once the backlog drains and the window advances nothing comes back for it. That is why the target
// is deliberately generous, why every refusal is listed by reason, and why the count of pages not
// followed on demand is on the run row rather than buried here.
const seenIds = Object.create(null);
let seenCount = 0;
function addIds(ids) {
  for (const id of ids) if (!seenIds[id]) { seenIds[id] = true; seenCount += 1; }
}
// The effective row cap Remove Known will apply if this run stops paging right now, by that node's
// own arithmetic. Every extra search call takes one row off it once the whole-run total is what
// binds, which is exactly the trade this function exists to price.
function rowCapAt(callsUsed) {
  if (MAX_SCORED === null) return null;
  const remaining = Math.max(0, totalCapV - callsUsed);
  const detailBudget = Math.min(detailStageCapV, remaining);
  // Nothing describable at all: Remove Known switches its coupling off and the ceiling applies, so
  // an extra page costs no description and the only limit left is how many rows can be kept.
  if (!detailOn || detailBudget <= 0) return MAX_SCORED;
  return Math.min(MAX_SCORED, detailBudget);
}
// by_pass keeps EVERY decision, not just the last one, for the same reason the truncation list does:
// the numbers move as calls are spent, so a report carrying only the final values describes a moment
// nobody made a decision at. The pass that mattered is usually the first.
const demandLog = { row_cap_if_we_stop: null, target: null, unique_ids_seen: 0, met: false, pages_not_followed: 0, by_pass: [] };

// --- the decision, pure and therefore replayable ---------------------------
// Given one pass's (unit, response) pairs and how many calls the run has already spent, decide the
// NEXT pass. Pure in the sense that matters: same responses in the same order, same output, which is
// what makes replaying from run 0 legitimate. It accumulates the seen-id set as it goes, and the
// replay walks the passes in the same order every time, so the set is identical on every execution.
function decideNext(pairs, callsUsed, passIndex) {
  const candidates = [];
  const unfollowed = [];
  for (const p of pairs) {
    const page = readPage(p.res);
    p.page = page;
    addIds(page.ids || []);
    if (!page.ok) continue;
    if (page.cards < PAGE_SIZE) continue;
    const nextIndex = (typeof p.unit.page_index === 'number' ? p.unit.page_index : 0) + 1;
    if (nextIndex >= maxPages.value) {
      unfollowed.push({ seq: p.unit.seq, term: p.unit.term, location_setting: p.unit.location_setting, pages_taken: nextIndex, reason: 'page_cap' });
      continue;
    }
    candidates.push({ unit: p.unit, nextIndex: nextIndex });
  }
  // DEMAND, checked BEFORE the ceiling, because it is the cheaper stop and it is the one that says
  // why. A run holding three times what it can keep does not need another page; it needs the calls.
  const rowCapNow = rowCapAt(callsUsed);
  const target = rowCapNow === null ? null : rowCapNow * demandMultiple.value;
  demandLog.row_cap_if_we_stop = rowCapNow;
  demandLog.target = target;
  demandLog.unique_ids_seen = seenCount;
  const metNow = target !== null && candidates.length > 0 && seenCount >= target;
  demandLog.by_pass.push({ pass: passIndex, calls_used: callsUsed, row_cap_if_we_stop: rowCapNow, target: target, unique_ids_seen: seenCount, full_pages_available: candidates.length, met: metNow });
  if (metNow) {
    demandLog.met = true;
    demandLog.pages_not_followed += candidates.length;
    for (const c of candidates) {
      unfollowed.push({ seq: c.unit.seq, term: c.unit.term, location_setting: c.unit.location_setting, pages_taken: c.nextIndex, reason: 'demand_met' });
    }
    return { units: [], unfollowed: unfollowed, candidates: candidates.length };
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
  const next = decideNext(pairs, callsUsed, r);
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
  // A DEMAND STOP IS NOT A TRUNCATION, and the distinction decides whether the window moves.
  // Build Run Row treats paging.truncated as "this run has not covered its window", which HOLDS
  // last_run_at. A ceiling hit means the run wanted more and was refused, so holding is right and
  // the next run drains the backlog. A demand stop means the run already had more than it could
  // keep, and that state does NOT change between runs of the same window: the same base pages come
  // back with the same ids however much of the backlog has drained. Counting it as a truncation
  // would hold the window on every busy run and never let go, which is a lane that emits nothing
  // forever. The refusals are still listed in queries_truncated with reason demand_met, and the
  // count is carried separately so nothing is hidden by the distinction.
  const ceilingTruncations = truncated.filter(function (t) { return t.reason !== 'demand_met'; });

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
    demand: {
      applied: demandOffBecause === null,
      off_because: demandOffBecause,
      rule: 'page only while the run holds less unique supply than it can keep AND describe. A search call and a detail call come out of the same whole-run budget, so an extra page is bought with a description, and a job scored on its title is worth much less than a job not yet seen.',
      multiple: demandMultiple.value,
      multiple_from: demandMultiple.from,
      max_scored_per_run: MAX_SCORED,
      detail_switch_on: detailOn,
      whole_run_linkedin_calls: totalCapV,
      per_stage_detail_cap: detailStageCapV,
      unique_ids_seen: seenCount,
      row_cap_if_we_stop: demandLog.row_cap_if_we_stop,
      target: demandLog.target,
      met: demandLog.met,
      pages_not_followed_on_demand: demandLog.pages_not_followed,
      by_pass: demandLog.by_pass,
      price: demandLog.pages_not_followed > 0
        ? demandLog.pages_not_followed + ' full page(s) were not followed because this run already held ' + seenCount +
          ' distinct posting id(s) against a target of ' + demandLog.target + '. Those pages are not deferred, they are ' +
          'not asked for: once the backlog drains and the window advances nothing comes back for them. That is the price ' +
          'of spending the budget on descriptions instead, and it is on the run row so it can be argued with.'
        : null,
    },
    pages_per_query: Object.keys(perQuery).map(function (k) { return perQuery[k]; }),
    queries_truncated: truncated,
    truncated: ceilingTruncations.length > 0 || (stoppedByPassClamp && next.candidates > 0),
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
  `const HARD_MAX_DEMAND_MULTIPLE = ${JSON.stringify(HARD_MAX_DEMAND_MULTIPLE)};`,
  `const DEFAULT_DEMAND_MULTIPLE = ${JSON.stringify(require('./_lane').pagingDefaults().values.linkedin_page_demand_multiple)};`,
  `const DEFAULT_DETAIL_CALLS = ${JSON.stringify(require('./_lane').pagingDefaults().values.linkedin_detail_max_calls_per_run)};`,
  `const DEFAULT_TOTAL_CALLS = ${JSON.stringify(require('./_lane').pagingDefaults().values.linkedin_total_max_calls_per_run)};`,
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
    'Adaptive paging (D15). Pages a query only while its page comes back FULL and only while the run holds less ' +
    'unique supply than it can keep AND describe, because a search call and a detail call come out of the same ' +
    'whole-run LinkedIn budget. Under a per-run call ceiling ' +
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

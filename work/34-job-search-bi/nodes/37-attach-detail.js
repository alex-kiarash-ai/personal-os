'use strict';
/*
 * 37-attach-detail.js - "Attach Detail". Parses each LinkedIn detail response, puts the description
 * on the row that asked for it, and emits the detail source report. The last node of the detail
 * stage and the one that feeds `Budget Gate`.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. WHAT IT WRITES, AND THE THREE THINGS IT REFUSES TO WRITE.
 * ---------------------------------------------------------------------------------------------
 * WRITES: `excerpt`, and nothing else in the shared row shape.
 * REFUSES: `title`, `company`, `location`, `posted_at`, `url`, `remote`, `job_id`.
 *
 * The detail page publishes all of those and they are deliberately ignored, for three separate
 * reasons that all point the same way:
 *   - the row already carries them from the search card, and Remove Known has ALREADY deduped and
 *     ranked on them. Rewriting a field after the dedupe decision was made on its old value is how
 *     a run ends up with a row whose provenance and content disagree;
 *   - `posted_at` on the detail surface is RELATIVE TEXT ("2 days ago"), which is not a parseable
 *     date, and the contract says so. Replacing a real ISO timestamp with that would break the
 *     window sort in Remove Known and the freshness read in the sheet;
 *   - `remote` is a collector-derived fact inferred from the request (f_WT=2 means the whole result
 *     set is remote) and the detail surface does not state it at all. Agent 5's rule that a model
 *     read must not replace a measurement applies just as hard to a second scrape.
 * So the detail fetch adds the ONE field the search card cannot carry and touches nothing else.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. WHAT GOES IN THE EXCERPT, AND WHY IT IS LONGER THAN A BOARD EXCERPT.
 * ---------------------------------------------------------------------------------------------
 * The six free boards publish a SUMMARY and `18-extract-board-jobs.js` caps it at 400 characters
 * (EXCERPT_MAX, read back from that file at build time here, never retyped). LinkedIn publishes the
 * FULL body, and 400 characters of a Swedish job ad is almost always the company boilerplate
 * paragraph before the requirements start. So this stage caps at 1200, which is what
 * `28-budget-gate.js` was already built for: its USER_EXCERPT_MAX is 2000 and its header says the
 * constant exists precisely so a raised upstream cap cannot silently multiply the per-call bill.
 * Both bounds are asserted at build time here, in both directions.
 *
 * THE CRITERIA GO FIRST, INSIDE THE CAP, AND THAT IS A DECISION. The detail page carries a criteria
 * list (Seniority level, Employment type, Job function, Industries; four on the 2026-09-12 probe,
 * three on the Stage C one, so the count varies). Seniority level is the highest-signal field on
 * the whole page for the scoring rubric, whose red flags are literally about seniority above and
 * below his level. Putting the criteria at the FRONT means they survive truncation; putting them at
 * the back means they are the first thing cut. They cost about 130 characters of the 1200.
 * The structured version also rides on `_detail.criteria`, so nothing downstream has to parse the
 * string back out, and one constant turns the prefix off.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. A 429 OR A 999 IS A REFUSED SOURCE, NEVER AN EMPTY DESCRIPTION.
 * ---------------------------------------------------------------------------------------------
 * Same rule as the search leg and the same five outcomes, because the two legs share an IP and a
 * host and a refusal on either means the same thing about the box:
 *   ok              2xx and a description was parsed.
 *   empty           2xx, the description SECTION is present and its body is empty. A posting with
 *                   no text. Marked unproven: it has never been observed live.
 *   refused         401, 403, 429, 999, or a 2xx carrying an authwall or a challenge. This is the
 *                   D20 signal and the report says so with the status code.
 *   error           a transport failure, a 404 (the posting is gone), or any other non-2xx.
 *   markup_changed  2xx, LinkedIn markup, and the description selector is not in it. The cards are
 *                   there and the thing this lane keys on is not. Never read as "no description".
 * A row is emitted on EVERY one of those paths, carrying `detail_status` and a `detail_reason`
 * sentence. Nothing is dropped, which is non-negotiable 1 of the dispatch and the whole complaint
 * Shaheen had about the old engines.
 *
 * ---------------------------------------------------------------------------------------------
 * 4. HOW A RESPONSE FINDS ITS ROW.
 * ---------------------------------------------------------------------------------------------
 * The HTTP node emits { body, headers, statusCode, statusMessage } and DROPS every input field, so
 * a row routed into the fetch branch does not come out of the other side. Detail Gate therefore
 * never sends one: an admitted row is emitted TWICE, once as the row itself on the carry branch and
 * once as a scaffolding REQUEST item carrying only the url and the job_id. This node reads those
 * request items back with `$('Detail Gate').all()` filtered to `_detail_now === true`, which is in
 * order exactly what the HTTP node was fed. `pairedItem.item` indexes into that list and is used
 * when present; position is the fallback and USING it degrades the report, because attaching a real
 * description to the wrong job is worse than attaching none. An out of range pairedItem is reported
 * as an orphan and never rescued by position, and the row it belonged to is stamped as an error.
 *
 * THE PROPERTY THAT FALLS OUT OF THAT SPLIT, and it is the reason for it: this node can attach
 * NOTHING AT ALL, including when Detail Gate is unreachable, and still emit every row and every
 * report. The rows never depended on the fetch branch surviving.
 *
 * The two streams are separated by SHAPE, not by position: a fetched item carries a statusCode or
 * an error and no `_kind`, and everything on the carry branch carries a `_kind`. That survives any
 * future change to which Merge input is which.
 *
 * ---------------------------------------------------------------------------------------------
 * 5. THE STREAM CONTRACT, which is what Budget Gate and Stage F read.
 * ---------------------------------------------------------------------------------------------
 * IN: `Detail Results`, which is the fetch branch appended to the carry branch.
 * OUT, in this order: every job row (enriched or not), every `source_report` and `stage_report`
 * that came through untouched, and ONE more `_kind: 'source_report'` for `linkedin_guest_detail`.
 *
 * THAT REPORT TAKES THE SOURCE COUNT FROM EIGHT TO NINE and it is worth saying why it is a
 * source_report rather than a stage_report. `linkedin_guest_detail` is one of the nine sources in
 * the contract, it has its own settings switch, its own endpoint, its own refusal semantics and its
 * own rank in Remove Known's dedupe priority. Eight was never the intended number: it was the eight
 * sources that happened to have a reporter. Nothing else can double-report it either, because
 * `20-filter.js` synthesises a disabled report only for sources in `run.plan.disabled_sources`, and
 * Plan Queries never puts this one there (it is an `enrichment` unit kind, not a query unit). That
 * is asserted at build time rather than remembered.
 */

const { lane, sources } = require('./_lane');

const L = lane();
const CONTRACT = sources();
const SOURCE_KEY = 'linkedin_guest_detail';
const SEARCH_KEY = 'linkedin_guest_search';
const S = CONTRACT.sources[SOURCE_KEY];

// The board excerpt cap, READ out of the board extractor rather than retyped, so the two can never
// drift apart silently and the difference between them stays a stated decision.
const BOARD_EXCERPT_MAX = (function readBoardCap() {
  const code = require('./18-extract-board-jobs.js').parameters.jsCode;
  const m = /const EXCERPT_MAX = (\d+);/.exec(code);
  if (!m) {
    throw new Error(
      'Attach Detail: could not read EXCERPT_MAX out of 18-extract-board-jobs.js.\n' +
      '  This node caps its own excerpt LONGER than the board cap on purpose, and the whole argument for\n' +
      '  that rests on knowing what the board cap is. Declaring a second copy here would let the two\n' +
      '  drift until one column meant two different things and nothing said so.'
    );
  }
  return Number(m[1]);
}());

// The cap for a LinkedIn detail excerpt. See section 2 of the header for why it is not 400.
const DETAIL_EXCERPT_MAX = 1200;
// Put the criteria list at the FRONT of the excerpt so it survives truncation. One constant.
const CRITERIA_IN_EXCERPT = true;
// The most criteria pairs carried into the excerpt. Four on the 2026-09-12 probe. The bound stops a
// page that grew a twenty-item list from eating the whole excerpt.
const CRITERIA_MAX = 6;

const REFUSAL_STATUSES = {
  401: 'unauthorized, the guest surface asked for a session',
  403: 'forbidden, the request was rejected outright',
  429: 'rate limited, too many requests from this address',
  999: 'LinkedIn anti-automation status, this address is being refused',
};

// The selector tokens this node keys on, named once so an error message can quote the real string
// rather than a description of it.
const SELECTORS = {
  description: 'show-more-less-html__markup',
  description_section: 'description__text',
  criteria_item: 'description__job-criteria-item',
  criteria_label: 'description__job-criteria-subheader',
  criteria_value: 'description__job-criteria-text',
  applicants: 'num-applicants__caption',
  scaffold: 'topcard__title',
};

(function assertAgainstContract() {
  if (!S) {
    throw new Error('Attach Detail: the shared contract has no source called ' + SOURCE_KEY + '. It carries: ' + Object.keys(CONTRACT.sources).join(', '));
  }
  // The field_map is the contract's statement about where the description lives. If it stops naming
  // this selector, the contract and this parser have diverged and one of them is wrong.
  if (!new RegExp(SELECTORS.description).test(String(S.field_map && S.field_map.excerpt))) {
    throw new Error(
      'Attach Detail: the contract field_map for ' + SOURCE_KEY + '.excerpt no longer names ' +
      SELECTORS.description + '. It says: ' + JSON.stringify(S.field_map && S.field_map.excerpt) + '\n' +
      '  This node parses that class and nothing else. Change both in the same edit, or every posting is\n' +
      '  reported as markup_changed against a source that is answering perfectly.'
    );
  }
  if (!S.extra_fields_available || !new RegExp(SELECTORS.criteria_label).test(String(S.extra_fields_available.criteria))) {
    throw new Error('Attach Detail: the contract no longer describes the criteria list at ' + SELECTORS.criteria_label + '. This node puts that list at the front of the excerpt, so the contract and the parser have to agree on where it is.');
  }
  // excerpt LOST ITS SHEET COLUMN on 2026-09-17 and did NOT stop existing. It is declared in the
  // contract's internal_only_fields, and it is still the one field this stage writes, still the
  // description block of the scoring prompt, and therefore still the only reason this stage spends
  // linkedin_detail_max_calls_per_run on a morning. Checking shared_row_shape here would now refuse a
  // perfectly correct lane; checking nothing would let a real deletion through silently.
  if (Object.keys(CONTRACT.internal_only_fields || {}).indexOf('excerpt') === -1
      && CONTRACT.shared_row_shape.indexOf('excerpt') === -1) {
    throw new Error(
      'Attach Detail: the contract carries no excerpt field, as a sheet column or as internal.\n' +
      '  It is the one field this stage writes and the description block of the scoring prompt, so with\n' +
      '  it gone this stage buys LinkedIn detail pages that feed nothing and the scorer reads titles.'
    );
  }

  // The caps, in both directions.
  if (!(DETAIL_EXCERPT_MAX > BOARD_EXCERPT_MAX)) {
    throw new Error(
      'Attach Detail: DETAIL_EXCERPT_MAX is ' + DETAIL_EXCERPT_MAX + ' and the board cap is ' + BOARD_EXCERPT_MAX + '.\n' +
      '  A detail excerpt no longer than a board summary means this whole stage buys the first paragraph of\n' +
      '  boilerplate and stops. If that is genuinely wanted, say so here rather than letting the number drift\n' +
      '  down until the stage quietly stops being worth its calls.'
    );
  }
  // READ AS TEXT, NOT REQUIRED, and that is not a style choice. 28-budget-gate.js requires this
  // file to assert the wiring name, so requiring it back would be a cycle and node would hand one
  // of the two a half-built module whose `parameters` is undefined. The constant being read is a
  // build-time literal in that file's source, so the text is where it actually lives.
  const gateSrc = require('fs').readFileSync(require('path').join(__dirname, '28-budget-gate.js'), 'utf8');
  const um = /const USER_EXCERPT_MAX = (\d+);/.exec(gateSrc);
  if (!um) {
    throw new Error('Attach Detail: could not read USER_EXCERPT_MAX out of 28-budget-gate.js. This node writes the field that node prices, and shipping an excerpt longer than the scorer will send would mean paying to collect text nobody reads.');
  }
  if (DETAIL_EXCERPT_MAX > Number(um[1])) {
    throw new Error(
      'Attach Detail: DETAIL_EXCERPT_MAX is ' + DETAIL_EXCERPT_MAX + ' and Budget Gate truncates the prompt at ' + um[1] + '.\n' +
      '  Every character above that is collected, written to the sheet, and cut before the model sees it, so\n' +
      '  the score would be built on less text than the report claims. Raise USER_EXCERPT_MAX deliberately,\n' +
      '  with the per-call cost in front of you, or lower this one.'
    );
  }

  // The nodes this one reads back from, by name.
  const gate = require('./33-detail-gate.js');
  if (gate.name !== 'Detail Gate') {
    throw new Error('Attach Detail: node 33 is named ' + JSON.stringify(gate.name) + ' and this node reads $(\'Detail Gate\') to correlate responses to rows. Rename both in the same edit.');
  }
  const merge = require('./36-detail-results.js');
  if (merge.name !== 'Detail Results') {
    throw new Error('Attach Detail: node 36 is named ' + JSON.stringify(merge.name) + ' and this node connects from "Detail Results".');
  }
  if (merge.parameters.numberInputs !== 2) {
    throw new Error('Attach Detail: Detail Results declares numberInputs ' + JSON.stringify(merge.parameters.numberInputs) + '. This node depends on BOTH branches arriving, and a Merge reads only the inputs it declares.');
  }
  const http = require('./35-get-linkedin-detail.js');
  const resp = http.parameters.options.response.response;
  if (resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error('Attach Detail: 35-get-linkedin-detail.js no longer sets fullResponse and neverError. Without them a refusal arrives as an error string with no status code, and a 429 would be classified as a posting with no description, which is the exact confusion non-negotiable 2 of the dispatch forbids.');
  }
  if (resp.outputPropertyName !== 'body') {
    throw new Error('Attach Detail: 35-get-linkedin-detail.js outputPropertyName is ' + JSON.stringify(resp.outputPropertyName) + '. This node parses json.body. With any other name every response parses to nothing and every posting is reported as having no description, which is the symptom the whole stage exists to remove.');
  }
  if (http.retryOnFail || http.maxTries) {
    throw new Error('Attach Detail: 35-get-linkedin-detail.js has grown a retry. n8n retries the NODE, so a retry multiplies every call in the leg, and the whole-run budget in 33-detail-gate.js counts admitted rows rather than attempts. Decide the retry and the budget together or the budget is not one.');
  }

  // NOBODY ELSE MAY REPORT FOR THIS SOURCE. 20-filter.js synthesises a disabled source_report for
  // every source in run.plan.disabled_sources, and two reports for one source would double every
  // per-source count in Stage F. Plan Queries never puts this one in that list because it is an
  // enrichment unit rather than a query unit, and that is checked here rather than remembered.
  // UNIT_KIND is a build-time constant in that file rather than something that lands in its jsCode,
  // so the source text is where the claim actually lives.
  const planSrc = require('fs').readFileSync(require('path').join(__dirname, '05-plan-queries.js'), 'utf8');
  if (!/linkedin_guest_detail:\s*'enrichment'/.test(planSrc)) {
    throw new Error(
      'Attach Detail: 05-plan-queries.js no longer classes ' + SOURCE_KEY + ' as an enrichment unit.\n' +
      '  If it became a board or a query unit it would land in run.plan.disabled_sources when switched off,\n' +
      '  20-filter.js would synthesise a second source_report for it, and every per-source count downstream\n' +
      '  would be doubled for exactly one source with nothing anywhere saying so.'
    );
  }
  const filterCode = require('./20-filter.js').parameters.jsCode;
  if (filterCode.indexOf('if (reportedSources[key]) continue;') === -1) {
    throw new Error('Attach Detail: 20-filter.js lost the guard that skips a source which already reported for itself. That guard is the second half of the no-double-report rule this node depends on.');
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Attach Detail. Parse each response, put the description on its row, report.
// ---------------------------------------------------------------------------
const merged = $input.all();

// --- 1. split the merged stream by SHAPE, never by position ------------------
// A fetched item carries a statusCode or an error and no _kind. Everything on the carry branch
// carries a _kind. That holds whichever Merge input is which, which matters because the ordering is
// a debugging convenience and should never become load-bearing.
const responses = [];
const carried = [];
for (const it of merged) {
  const j = (it && it.json) || {};
  const isResponse = j._kind === undefined &&
    (typeof j.statusCode === 'number' || (j.error !== undefined && j.error !== null && j.error !== false) || typeof j.body === 'string');
  if (isResponse) responses.push(it);
  else carried.push(j);
}

// --- 2. the REQUEST items, in the order the HTTP node was fed them ----------
// These are scaffolding, not rows: { _kind: 'detail_request', detail_url, job_id, seq }. The row
// they belong to came down the carry branch and is already in the carried list.
let requested = [];
let gateReachable = true;
try {
  requested = $('Detail Gate').all().map(function (i) { return i.json; }).filter(function (j) { return j && j._detail_now === true; });
} catch (e) {
  gateReachable = false;
}

let correlationDegraded = false;
const orphans = [];
function pairIndex(item, i) {
  const pi = item.pairedItem;
  if (typeof pi === 'number') return { idx: pi, via: 'pairedItem' };
  if (pi && typeof pi === 'object' && !Array.isArray(pi) && typeof pi.item === 'number') return { idx: pi.item, via: 'pairedItem' };
  if (Array.isArray(pi) && pi.length && pi[0] && typeof pi[0].item === 'number') return { idx: pi[0].item, via: 'pairedItem' };
  return { idx: i, via: 'position' };
}
if (!gateReachable) {
  correlationDegraded = true;
  orphans.push({ response_index: null, points_at: null, of: 0, via: 'Detail Gate could not be reached, so no response can be matched to the row that asked for it' });
}
if (gateReachable && responses.length !== requested.length) {
  correlationDegraded = true;
  orphans.push({ response_index: null, points_at: null, of: requested.length, via: 'count mismatch: ' + requested.length + ' row(s) were sent to fetch and ' + responses.length + ' response(s) came back' });
}

// --- 3. text helpers ---------------------------------------------------------
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aring: '\\u00e5', auml: '\\u00e4', ouml: '\\u00f6', Aring: '\\u00c5', Auml: '\\u00c4', Ouml: '\\u00d6',
  eacute: '\\u00e9', egrave: '\\u00e8', uuml: '\\u00fc', szlig: '\\u00df', oslash: '\\u00f8', aelig: '\\u00e6',
  hellip: '...', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"',
};
function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-fA-F]+);/g, function (m, hex) { try { return String.fromCodePoint(parseInt(hex, 16)); } catch (e) { return m; } })
    .replace(/&#(\\d+);/g, function (m, dec) { try { return String.fromCodePoint(parseInt(dec, 10)); } catch (e) { return m; } })
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, function (m, name) { return NAMED_ENTITIES[name] !== undefined ? NAMED_ENTITIES[name] : m; });
}
// The no-dash rule has no carve-out and this endpoint is a known offender: the source contract's
// own quirks list records that LinkedIn titles can carry an en-dash, and a description is far more
// text than a title.
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
// A <br> is a real line break in this markup and stripping it bare would run two sentences
// together. Turned into a space FIRST, then the rest of the tags go.
function plainText(v) {
  if (v === null || v === undefined) return null;
  let s = String(v).replace(/<br\\s*\\/?>/gi, ' ').replace(/<\\/(p|div|li|h[1-6])>/gi, ' ');
  for (let pass = 0; pass < 4; pass += 1) {
    const next = decodeEntities(s.replace(/<[^>]*>/g, ' '));
    if (next === s) break;
    s = next;
  }
  s = s.replace(/<[^>]*>/g, ' ');
  const t = sanitise(s).replace(/\\s+/g, ' ').trim();
  return t === '' ? null : t;
}
function truncate(s, n) {
  if (s === null) return null;
  return s.length <= n ? s : s.slice(0, n - 3).replace(/\\s+\\S*$/, '') + '...';
}

// --- 4. the parser -----------------------------------------------------------
// A DEPTH AWARE SCAN, not a lazy regex to the first </div>. The 2026-09-12 probe's description body
// carries <strong> and <br> and no nested <div>, so a first-close read happens to work today and
// would silently truncate the day LinkedIn wraps a paragraph in one. Cutting a description in half
// is invisible: the row still has text, the score still looks reasonable, and nothing says so.
function sliceDescription(html) {
  const open = new RegExp('<div[^>]*class="[^"]*' + SEL_DESCRIPTION + '[^"]*"[^>]*>', 'i');
  const m = open.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  const re = /<\\/?div\\b[^>]*>/gi;
  re.lastIndex = start;
  let depth = 1;
  let hit;
  while ((hit = re.exec(html))) {
    if (hit[0].charAt(1) === '/') {
      depth -= 1;
      if (depth === 0) return html.slice(start, hit.index);
    } else {
      depth += 1;
    }
  }
  // Unbalanced. Everything to the end of the body is better than nothing, and the caller is told.
  return html.slice(start);
}
function readCriteria(html) {
  const out = [];
  const item = new RegExp('<li[^>]*class="[^"]*' + SEL_CRITERIA_ITEM + '[^"]*"[^>]*>([\\\\s\\\\S]*?)<\\\\/li>', 'gi');
  const label = new RegExp('<h3[^>]*class="[^"]*' + SEL_CRITERIA_LABEL + '[^"]*"[^>]*>([\\\\s\\\\S]*?)<\\\\/h3>', 'i');
  const value = new RegExp('<span[^>]*class="[^"]*' + SEL_CRITERIA_VALUE + '[^"]*"[^>]*>([\\\\s\\\\S]*?)<\\\\/span>', 'i');
  let m;
  while ((m = item.exec(html))) {
    const lm = label.exec(m[1]);
    const vm = value.exec(m[1]);
    const l = lm ? plainText(lm[1]) : null;
    const v = vm ? plainText(vm[1]) : null;
    if (l && v) out.push({ label: l, value: v });
    if (out.length >= CRITERIA_MAX) break;
  }
  return out;
}
function readApplicants(html) {
  const re = new RegExp('<figcaption[^>]*class="[^"]*' + SEL_APPLICANTS + '[^"]*"[^>]*>([\\\\s\\\\S]*?)<\\\\/figcaption>', 'i');
  const m = re.exec(html);
  return m ? plainText(m[1]) : null;
}

const RE_WALL = /authwall|checkpoint\\/challenge|captcha|cf-browser-verification|Just a moment\\.\\.\\./i;

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
    return { outcome: 'error', status_code: null, reason: 'the response carried no status code. With fullResponse on, every real response has one, so this item is not a response.' };
  }
  if (REFUSAL_STATUSES[status]) {
    return { outcome: 'refused', status_code: status, reason: REFUSAL_STATUSES[status] };
  }
  if (status === 404) {
    return { outcome: 'error', status_code: 404, reason: 'HTTP 404. The posting is gone from the guest surface, which happens when an ad is closed between the search call and this one. The row keeps its title and is scored on it.' };
  }
  if (status < 200 || status >= 300) {
    return { outcome: 'error', status_code: status, reason: 'HTTP ' + status + ' ' + (res.statusMessage || '') };
  }
  const body = typeof res.body === 'string' ? res.body : (res.body === null || res.body === undefined ? '' : String(res.body));
  if (RE_WALL.test(body)) {
    return { outcome: 'refused', status_code: status, reason: 'HTTP ' + status + ' carrying a login wall or a bot challenge instead of a posting. A refusal dressed as a success.' };
  }

  const slice = sliceDescription(body);
  const hasSection = body.indexOf(SEL_DESCRIPTION_SECTION) !== -1;
  const hasScaffold = body.indexOf(SEL_SCAFFOLD) !== -1 || body.indexOf(SEL_CRITERIA_ITEM) !== -1;

  if (slice !== null) {
    const textOut = plainText(slice);
    if (textOut) {
      return {
        outcome: 'ok', status_code: status, reason: null,
        description: textOut, criteria: readCriteria(body), applicants: readApplicants(body),
        bytes: body.length, description_chars: textOut.length,
      };
    }
    return {
      outcome: 'empty', status_code: status,
      reason: 'HTTP ' + status + ' and the description block is present and holds no text. Read as a posting that genuinely published no body. UNPROVEN: this has never been observed live, so if it starts appearing on many postings at once, suspect the markup before believing the postings.',
      criteria: readCriteria(body), applicants: readApplicants(body), bytes: body.length, description_chars: 0,
    };
  }
  if (hasSection) {
    return {
      outcome: 'empty', status_code: status,
      reason: 'HTTP ' + status + ' with a description SECTION and no ' + SEL_DESCRIPTION + ' block inside it. Read as a posting with no body rather than as a markup change, because the section that would hold one is there and it is empty.',
      criteria: readCriteria(body), applicants: readApplicants(body), bytes: body.length, description_chars: 0,
    };
  }
  if (hasScaffold) {
    return {
      outcome: 'markup_changed', status_code: status,
      reason: 'HTTP ' + status + ' with ' + body.length + ' bytes of LinkedIn posting markup and NO ' + SEL_DESCRIPTION + ' block and no description section at all. The page is there and the thing this lane keys on is not. Re-read the posting HTML and update field_map for ' + SOURCE_KEY + ' in the source contract; do not read this as a posting with no description.',
      criteria: readCriteria(body), applicants: readApplicants(body), bytes: body.length, description_chars: 0,
    };
  }
  const visible = plainText(body);
  return {
    outcome: 'markup_changed', status_code: status,
    reason: 'HTTP ' + status + ' with ' + ((visible && visible.length) || 0) + ' characters of text and no LinkedIn posting markup at all. Something other than this endpoint is answering.',
    criteria: [], applicants: null, bytes: body.length, description_chars: 0,
  };
}

// --- 5. build the excerpt ----------------------------------------------------
function buildExcerpt(verdict) {
  const parts = [];
  if (CRITERIA_IN_EXCERPT && verdict.criteria && verdict.criteria.length) {
    parts.push(verdict.criteria.map(function (c) { return c.label + ': ' + c.value + '.'; }).join(' '));
  }
  if (verdict.description) parts.push(verdict.description);
  const joined = parts.join(' ').replace(/\\s+/g, ' ').trim();
  if (!joined) return null;
  return truncate(joined, DETAIL_EXCERPT_MAX);
}

// --- 6. attach ----------------------------------------------------------------
const calls = [];
const attachedById = {};
let sanitiseStart = sanitisedFields;

for (let i = 0; i < responses.length; i += 1) {
  const item = responses[i];
  const res = (item && item.json) || {};
  const corr = pairIndex(item, i);
  const req = gateReachable ? requested[corr.idx] : null;
  if (!req || !req.job_id) {
    orphans.push({ response_index: i, points_at: corr.idx, of: requested.length, via: corr.via });
    correlationDegraded = true;
    continue;
  }
  if (corr.via === 'position') correlationDegraded = true;

  const verdict = classify(res);
  const excerpt = (verdict.outcome === 'ok') ? buildExcerpt(verdict) : null;
  const key = String(req.job_id);
  attachedById[key] = {
    outcome: verdict.outcome,
    status_code: verdict.status_code,
    reason: verdict.reason,
    excerpt: excerpt,
    criteria: verdict.criteria || [],
    applicants: verdict.applicants || null,
    bytes: verdict.bytes || null,
    description_chars: verdict.description_chars || 0,
    via: corr.via,
  };
  calls.push({
    job_id: req.job_id,
    url: req.detail_url,
    outcome: verdict.outcome,
    status_code: verdict.status_code,
    reason: verdict.reason,
    bytes: verdict.bytes || null,
    description_chars: verdict.description_chars || 0,
    criteria_found: (verdict.criteria || []).length,
    excerpt_chars: excerpt ? excerpt.length : 0,
    excerpt_truncated: !!(excerpt && /\\.\\.\\.$/.test(excerpt)),
  });
}

// --- 7. rewrite the rows -------------------------------------------------------
const ROUTING_KEYS = ['_detail_now', 'detail_url'];
let enriched = 0;
let excerptChars = 0;

const outRows = [];
const outReports = [];
for (const j of carried) {
  if (!j || j._kind !== 'job') {
    // A COPY, never the input object. Deleting a key off the item this node was handed mutates a
    // structure other nodes hold a reference to inside one execution, and a Code node that edits its
    // own input is the kind of action-at-a-distance nobody looks for. n8n serialises between nodes
    // so it would not have shown up live; it showed up immediately in the offline simulator, which
    // is the argument for having one.
    const carriedCopy = Object.assign({}, j);
    for (const k of ROUTING_KEYS) delete carriedCopy[k];
    outReports.push(carriedCopy);
    continue;
  }
  const row = Object.assign({}, j);
  const hit = attachedById[String(row.job_id)];
  if (hit) {
    row.detail_status = hit.outcome;
    row.detail_reason = hit.reason;
    if (hit.excerpt) {
      row.excerpt = hit.excerpt;
      enriched += 1;
      excerptChars += hit.excerpt.length;
    }
    row._detail = {
      source: SOURCE_KEY,
      outcome: hit.outcome,
      status_code: hit.status_code,
      fetched: true,
      criteria: hit.criteria,
      applicants: hit.applicants,
      response_bytes: hit.bytes,
      description_chars: hit.description_chars,
      excerpt_chars: hit.excerpt ? hit.excerpt.length : 0,
      excerpt_shape: hit.excerpt ? (CRITERIA_IN_EXCERPT && hit.criteria.length ? 'criteria list, then the posting description' : 'the posting description') : null,
      excerpt_max: DETAIL_EXCERPT_MAX,
      board_excerpt_max: BOARD_EXCERPT_MAX,
      correlated_via: hit.via,
      fields_deliberately_not_overwritten: ['title', 'company', 'location', 'posted_at', 'url', 'remote', 'job_id'],
    };
  } else {
    // Never fetched. Detail Gate already stamped why, and that stamp is the answer: disabled,
    // budget, not_applicable or error. Only a row that WAS sent and lost its response is changed
    // here, and that becomes an error rather than staying silently pending.
    if (row.detail_status === 'pending') {
      row.detail_status = 'error';
      row.detail_reason = 'this row was sent to the detail fetch and no response could be matched back to it. The row is scored on its title. That is a correlation failure inside this run, not a statement about the posting.';
    }
    row._detail = { source: SOURCE_KEY, outcome: row.detail_status, fetched: false, criteria: [], applicants: null };
  }
  for (const k of ROUTING_KEYS) delete row[k];
  outRows.push(row);
}

// --- 8. the source report -------------------------------------------------------
const counts = { ok: 0, empty: 0, refused: 0, error: 0, markup_changed: 0 };
for (const c of calls) counts[c.outcome] = (counts[c.outcome] || 0) + 1;
const delivered = counts.ok + counts.empty;
const failed = counts.refused + counts.error + counts.markup_changed;
const missingResponses = (gateReachable ? requested.length : 0) - responses.length;

// The gate's own report carries the budget and the switch. Read from there rather than re-derived,
// so the two can never disagree about why a row went unenriched.
const gateReport = carried.filter(function (j) { return j && j._kind === 'stage_report' && j.stage === 'linkedin_detail_gate'; })[0] || null;
const switchOn = gateReport ? gateReport.switch_on : null;
const admitted = gateReport ? gateReport.admitted_for_fetch : requested.length;

const byStatus = {};
for (const r of outRows) byStatus[r.detail_status || 'unstamped'] = (byStatus[r.detail_status || 'unstamped'] || 0) + 1;

let verdict;
if (switchOn !== true) {
  verdict = 'disabled';
} else if (admitted === 0) {
  // Nothing was asked of the source, so it cannot be ok and it certainly is not down. On a lane
  // whose boards contribute nothing, this is what a quiet day looks like.
  verdict = 'idle';
} else if (failed === 0 && missingResponses === 0 && !correlationDegraded) {
  verdict = 'ok';
} else if (delivered === 0) {
  verdict = 'down';
} else {
  verdict = 'degraded';
}

const warnings = [];
if (counts.refused) {
  warnings.push(
    'LINKEDIN REFUSED ' + counts.refused + ' of ' + calls.length + ' detail call(s), and this is the D20 signal, not a ' +
    'posting problem. This run made ' + (gateReport ? gateReport.budget.search_calls_already_made : '?') + ' search call(s) and ' +
    admitted + ' detail call(s) against a documented threshold of roughly ten for a datacenter IP. Levers, cheapest ' +
    'first: lower linkedin_total_max_calls_per_run in the settings tab, cut search_terms, raise the batchInterval on ' +
    'both LinkedIn HTTP nodes, then try a browser User-Agent, which is deliberately absent so a refusal can be ' +
    'attributed to the address rather than to an unmeasured header. The documented Jina Reader fallback was NOT ' +
    'built, on purpose: it would have made this line disappear while the box stayed blocked. Now that the refusal ' +
    'is real, it is worth building, and it needs Shaheen to approve a new outbound channel first.'
  );
}
if (counts.markup_changed) {
  warnings.push(
    counts.markup_changed + ' response(s) were 2xx LinkedIn markup with no ' + SEL_DESCRIPTION + ' block. The endpoint is ' +
    'answering and the selector this lane keys on is gone. Re-read the posting HTML and update field_map for ' +
    SOURCE_KEY + ' in the source contract. Do NOT read these as postings without a description.'
  );
}
if (counts.error) {
  warnings.push(counts.error + ' detail call(s) failed outright. A 404 here is ordinary: an ad closed between the search call and this one. Anything else is worth reading in the calls list below.');
}
if (correlationDegraded) {
  warnings.push(
    'CORRELATION DEGRADED. At least one response could not be matched to the row that asked for it by pairedItem, or ' +
    'the counts did not line up. No description was attached on a guess, because attaching a real description to the ' +
    'wrong job is worse than attaching none. Orphans are listed on this report.'
  );
}
if (verdict === 'idle') {
  warnings.push(
    'the detail source made ZERO calls this run and was not switched off. Read the gate report beside this one for ' +
    'which of the ordinary reasons applied: no LinkedIn rows survived dedupe, the budget was already spent by the ' +
    'search leg, or the day was quiet. Zero calls is not zero jobs and it is not a fault.'
  );
}
const stillBlank = outRows.filter(function (r) { return r.source === SEARCH_KEY && String(r.excerpt === null || r.excerpt === undefined ? '' : r.excerpt).trim() === ''; }).length;
if (stillBlank > 0) {
  warnings.push(
    stillBlank + ' LinkedIn row(s) still reach the scorer with NO description and will be scored on title, company and ' +
    'location alone. Each carries a detail_status saying which of disabled, budget, refused, error, empty or ' +
    'markup_changed applied. A row written unenriched is not enriched later: it is known next run and Remove Known ' +
    'deletes it, so this number is a permanent cost for this set of jobs rather than a backlog.'
  );
}

const report = {
  _kind: 'source_report',
  source: SOURCE_KEY,
  lane: LANE_NUMBER,
  reported_by: 'Attach Detail',
  verdict: verdict,
  source_down: verdict === 'down',
  status_token: verdict === 'down' ? 'source_down:' + SOURCE_KEY : null,
  switch_on: switchOn,
  planned_queries: admitted,
  planned_calls: admitted,
  calls_made: responses.length,
  responses_received: responses.length,
  missing_responses: missingResponses,
  correlation_degraded: correlationDegraded,
  orphans: orphans,
  counts: counts,
  rows_enriched: enriched,
  rows_still_without_a_description: stillBlank,
  rows_by_detail_status: byStatus,
  excerpt: {
    max_chars: DETAIL_EXCERPT_MAX,
    board_max_chars: BOARD_EXCERPT_MAX,
    criteria_in_excerpt: CRITERIA_IN_EXCERPT,
    criteria_max: CRITERIA_MAX,
    total_chars_written: excerptChars,
    mean_chars: enriched ? Math.round(excerptChars / enriched) : 0,
    why_longer_than_a_board_excerpt: 'the boards publish a summary and LinkedIn publishes the full body. 400 characters of a Swedish posting is the company boilerplate before the requirements start. Budget Gate truncates the prompt at its own USER_EXCERPT_MAX, which is asserted at build time to be at least this number.',
  },
  text_fields_sanitised: sanitisedFields - sanitiseStart,
  budget: gateReport ? gateReport.budget : null,
  pacing: gateReport ? gateReport.pacing : null,
  fields_written: ['excerpt'],
  fields_deliberately_not_overwritten: ['title', 'company', 'location', 'posted_at', 'url', 'remote', 'job_id'],
  fallback_not_built: 'the documented Jina Reader fallback is deliberately absent. It would hide the one signal this lane most needs (whether the box is refused), it is a new outbound channel that is Shaheen\\'s to approve, it adds calls rather than removing them, and it needs a second parser for a different page. See 35-get-linkedin-detail.js.',
  warnings: warnings,
  calls: calls,
};

// The report goes LAST and it always goes. A run where every call was refused enriches zero rows,
// and a Code node returning [] ends the branch, which would delete the evidence of the exact
// failure this node exists to report along with every upstream report on the carry branch.
const rowItems = outRows.map(function (j) { return { json: j, pairedItem: { item: 0 } }; });
const reportItems = outReports.map(function (j) { return { json: j, pairedItem: { item: 0 } }; });
return rowItems.concat(reportItems, [{ json: report, pairedItem: { item: 0 } }]);
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/37-attach-detail.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const SOURCE_KEY = ${JSON.stringify(SOURCE_KEY)};`,
  `const SEARCH_KEY = ${JSON.stringify(SEARCH_KEY)};`,
  `const REFUSAL_STATUSES = ${JSON.stringify(REFUSAL_STATUSES)};`,
  `const DETAIL_EXCERPT_MAX = ${JSON.stringify(DETAIL_EXCERPT_MAX)};`,
  `const BOARD_EXCERPT_MAX = ${JSON.stringify(BOARD_EXCERPT_MAX)};`,
  `const CRITERIA_IN_EXCERPT = ${JSON.stringify(CRITERIA_IN_EXCERPT)};`,
  `const CRITERIA_MAX = ${JSON.stringify(CRITERIA_MAX)};`,
  `const SEL_DESCRIPTION = ${JSON.stringify(SELECTORS.description)};`,
  `const SEL_DESCRIPTION_SECTION = ${JSON.stringify(SELECTORS.description_section)};`,
  `const SEL_CRITERIA_ITEM = ${JSON.stringify(SELECTORS.criteria_item)};`,
  `const SEL_CRITERIA_LABEL = ${JSON.stringify(SELECTORS.criteria_label)};`,
  `const SEL_CRITERIA_VALUE = ${JSON.stringify(SELECTORS.criteria_value)};`,
  `const SEL_APPLICANTS = ${JSON.stringify(SELECTORS.applicants)};`,
  `const SEL_SCAFFOLD = ${JSON.stringify(SELECTORS.scaffold)};`,
  `const LANE_NUMBER = ${JSON.stringify(String(L.lane))};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Attach Detail',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [4720, 380],
  connectFrom: 'Detail Results',
  notes:
    'Parses each LinkedIn detail response and writes ONE field, excerpt, on the row that asked for it: the ' +
    'criteria list then the posting description, capped at ' + DETAIL_EXCERPT_MAX + ' characters against the ' +
    'board cap of ' + BOARD_EXCERPT_MAX + '. Overwrites nothing else, because the row was already deduped and ' +
    'ranked on those fields. A 429 or a 999 is classified as a REFUSED source with its status code, never as a ' +
    'posting with no description. Every row is emitted whatever happened, with a detail_status and a reason.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

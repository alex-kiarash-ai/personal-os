'use strict';
/*
 * 08-extract-linkedin.js - HTML job cards in, shared-row-shape rows out, plus one honest report of
 * what this source did NOT give us.
 *
 * THE ONE DISTINCTION THIS NODE EXISTS FOR. "LinkedIn returned no jobs" and "LinkedIn refused us"
 * produce the same row count and mean opposite things. One is a quiet Tuesday. The other is the
 * lane going blind while the run report stays green. So every call is classified into exactly one
 * of five outcomes and the classification is carried out of here as data, never inferred later
 * from a count:
 *
 *   ok              2xx, LinkedIn's card markup recognised, at least one card parsed
 *   empty           2xx, and the body carries no text and no card scaffolding at all
 *   refused         429, 999, 403, 401, or a 2xx body that is an authwall or a bot challenge
 *   markup_changed  2xx with a real body, but the cards are not where the contract says they are
 *   error           a transport failure, a timeout, a 5xx, or any other non-2xx
 *
 * `empty` and `markup_changed` are the pair that matters most, and they are the pair a naive
 * parser collapses into "zero rows". A parser that returns [] when LinkedIn reshuffles a class
 * name is the single most likely way this lane dies quietly in three months: every run stays
 * green, the sheet just stops growing, and by the time anyone notices the cause is months old.
 * So a 200 whose body has weight but no cards is a LOUD degradation, not a zero.
 *
 * HOW markup_changed IS ACTUALLY DETECTED, and it is not one test but three.
 *   1. No job ids anywhere, but card scaffolding present. The cards exist and the id attribute the
 *      contract keys on has moved. Loud.
 *   2. Fewer job ids than title elements. Cards found by id are a SUBSET of the cards in the body,
 *      so some were skipped invisibly. This is the case a card-missing-its-id produces, and it is
 *      undetectable by counting parsed rows alone, because the missing card leaves no trace in the
 *      output. Counting a second, independent marker is what makes it visible at all.
 *   3. A body with real text and neither ids nor scaffolding. Something is being served that is
 *      not this endpoint.
 *
 * WHY EVERY GOOD ROW SURVIVES A BAD CALL. Partial success is the normal case here, not the
 * exception: twelve calls against a source with a documented refusal threshold of about ten. So
 * nothing is thrown away because something else failed. Calls 1 to 7 succeeding and 8 to 12 being
 * refused is a run that keeps 7 and reports 5, and both halves are in the report.
 *
 * WHAT IT REPORTS THAT THE INPUT CANNOT SEE. A response can only describe a call that came back.
 * So the planned work is read from Plan Queries directly, and the report names calls that produced
 * no response at all, plus the planned units that this stage does not collect (the boards, sitting
 * on the router's unwired output). An absence nobody counted is indistinguishable from a success.
 *
 * TWO SHAPES COME OUT OF THIS NODE, tagged with `_kind`:
 *   _kind: 'job'            one per parsed card, the contract's shared_row_shape at the top level
 *                           plus a `_collect` block of provenance that is NOT a sheet column
 *   _kind: 'source_report'  exactly one, always, even when every call failed and there are zero
 *                           rows. Emitting it last means the branch never ends with zero items,
 *                           which is how a fully refused run would otherwise vanish before Stage F
 *                           could report it.
 * Stage D filters on `_kind`. That is a contract, and it is stated here because a stream carrying
 * two shapes is a trap for whoever reads it next.
 *
 * The row shape, the field selectors, the dedup prefix and the date format are all READ from
 * config/sources.json at build time and asserted against it. Nothing about the outside world is
 * typed into this file.
 */

const { lane, sources } = require('./_lane');
const L = lane();
const CONTRACT = sources();
const SRC = CONTRACT.sources;

const SOURCE_KEY = 'linkedin_guest_search';
const S = SRC[SOURCE_KEY];

// The pacing numbers come from the HTTP node itself, not from a second copy, so the run report can
// never quote an interval this lane is not actually using.
const HTTP_NODE = require('./07-search-linkedin.js');

// ---------------------------------------------------------------------------------------------
// WHAT THIS NODE FILLS, AND WHAT IT DELIBERATELY LEAVES NULL.
// The contract's pipeline_filled_fields says found_at, source and lane are the COLLECTOR's job and
// fit_score, fit_reasons and status belong to later stages. Leaving a later stage's field null is
// not laziness: writing a plausible 'new' into `status` here would invent a vocabulary Stage D has
// not chosen yet, and a value nobody set is easier to find than a value someone guessed.
// ---------------------------------------------------------------------------------------------
const COLLECTOR_FILLS = [
  'job_id', 'found_at', 'source', 'title', 'company', 'location',
  'remote', 'posted_at', 'url', 'apply_url', 'lane', 'excerpt',
];
const LEFT_FOR_LATER = ['fit_score', 'fit_reasons', 'status'];

// The class tokens this node parses on. Declared here, asserted against the contract's field_map
// prose below, so a selector changing in the contract fails THIS BUILD instead of producing twelve
// changed-markup reports at 06:30 on a Tuesday.
const SELECTOR_TOKENS = {
  job_id: 'data-entity-urn',
  title: 'base-search-card__title',
  company: 'base-search-card__subtitle',
  location: 'job-search-card__location',
  url: 'base-card__full-link',
  posted_at: 'time[datetime]',
};

// Statuses that mean LinkedIn decided not to serve us, as opposed to something breaking.
const REFUSAL_STATUSES = {
  401: 'unauthorized, the guest surface asked for a session',
  403: 'forbidden, the request was rejected outright',
  429: 'rate limited, too many requests from this address',
  999: 'LinkedIn anti-automation status, this address is being refused',
};

// --- build-time assertions ---------------------------------------------------------------------
(function assertAgainstContract() {
  if (!S) {
    throw new Error('Extract LinkedIn: the shared contract has no source called ' + SOURCE_KEY + '. It carries: ' + Object.keys(SRC).join(', '));
  }

  const shape = CONTRACT.shared_row_shape;
  const mine = COLLECTOR_FILLS.concat(LEFT_FOR_LATER).slice().sort();
  const theirs = shape.slice().sort();
  if (mine.length !== theirs.length || mine.some((k, i) => k !== theirs[i])) {
    throw new Error(
      'Extract LinkedIn: this node and the contract disagree about the row shape.\n' +
      '  contract shared_row_shape: ' + theirs.join(', ') + '\n' +
      '  this node accounts for:    ' + mine.join(', ') + '\n' +
      '  Every column has to be either filled here or deliberately left for a later stage. A column\n' +
      '  nobody claims is a column that silently arrives empty in the sheet, and the sheet header is\n' +
      '  already written from this same list.'
    );
  }

  const pipelineFilled = Object.keys(CONTRACT.pipeline_filled_fields || {});
  for (const k of LEFT_FOR_LATER) {
    if (!pipelineFilled.includes(k)) {
      throw new Error(
        'Extract LinkedIn: this node leaves "' + k + '" null for a later stage.\n' +
        '  The contract no longer lists it under pipeline_filled_fields. Either a source supplies it now,\n' +
        '  in which case fill it here, or the contract drifted. Do not ship a permanently empty column.'
      );
    }
  }

  for (const field of Object.keys(SELECTOR_TOKENS)) {
    const rule = S.field_map && S.field_map[field];
    if (typeof rule !== 'string') {
      throw new Error('Extract LinkedIn: the contract has no field_map rule for "' + field + '" on ' + SOURCE_KEY + '.');
    }
    if (!rule.includes(SELECTOR_TOKENS[field])) {
      throw new Error(
        'Extract LinkedIn: the contract\'s field_map for "' + field + '" no longer mentions "' + SELECTOR_TOKENS[field] + '".\n' +
        '  contract says: ' + rule + '\n' +
        '  This node parses on that token. A selector that changed in the contract and not here is a\n' +
        '  parser that returns nothing and calls it a quiet day.'
      );
    }
  }

  if (!/^li-/.test(S.dedup_id_rule || '')) {
    throw new Error('Extract LinkedIn: the contract dedup_id_rule for ' + SOURCE_KEY + ' is "' + S.dedup_id_rule + '", which does not start with the li- prefix this node stamps.');
  }
  if (!/YYYY-MM-DD/.test(S.date_format || '')) {
    throw new Error(
      'Extract LinkedIn: the contract date_format for ' + SOURCE_KEY + ' is "' + S.date_format + '".\n' +
      '  This node passes the time[datetime] value through verbatim on the promise that it is a bare\n' +
      '  YYYY-MM-DD date and that Stage E does the timezone work. If the format changed, the conversion\n' +
      '  decision changes with it.'
    );
  }

  const batch = HTTP_NODE.parameters.options.batching.batch;
  if (!batch || typeof batch.batchInterval !== 'number') {
    throw new Error('Extract LinkedIn: could not read the pacing back out of 07-search-linkedin.js. The run report quotes it, so it must be readable.');
  }
}());

const PACING = {
  batch_size: HTTP_NODE.parameters.options.batching.batch.batchSize,
  batch_interval_ms: HTTP_NODE.parameters.options.batching.batch.batchInterval,
  timeout_ms: HTTP_NODE.parameters.options.timeout,
  max_tries: HTTP_NODE.maxTries,
  wait_between_tries_ms: HTTP_NODE.waitBetweenTries,
};

const LOGIC = `
// ---------------------------------------------------------------------------
// Extract LinkedIn.
// ---------------------------------------------------------------------------
const items = $input.all();

// What was PLANNED. Read from Plan Queries rather than from the input, because a response can only
// describe a call that came back, and the whole job of this node is also to name the ones that did
// not.
let plannedAll;
try {
  plannedAll = $('Plan Queries').all().map((i) => i.json);
} catch (e) {
  throw new Error('Extract LinkedIn: cannot reach Plan Queries (' + e.message + '). This node reports what was planned against what arrived, so without the plan it can only report what it happens to have, which is the exact blindness it exists to remove.');
}
const planned = plannedAll.filter((j) => j.source === SOURCE_KEY);
const otherPlanned = plannedAll.filter((j) => j.source !== SOURCE_KEY);

if (!items.length) {
  throw new Error('Extract LinkedIn: no input items at all. The HTTP node emits one item per input item even when every call fails, so zero items means the graph is not what this node was built against.');
}
if (!planned.length) {
  throw new Error('Extract LinkedIn: ' + items.length + ' response(s) arrived but Plan Queries planned no ' + SOURCE_KEY + ' units. Something is routing non-LinkedIn work into the LinkedIn collector, and every one of those calls is being parsed as LinkedIn HTML.');
}

const run = planned[0].run || {};
const foundAt = run.run_started_at || new Date().toISOString();

// --- text handling ---------------------------------------------------------
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

// Characters that must not survive into a surface Shaheen reads. The dash rule has no carve-out,
// and the contract itself flags that LinkedIn job titles carry en-dashes (one of the ten cards in
// the captured sample does). Invisible characters get the same treatment as in Parse Settings: a
// zero width space inside a title matches nothing and looks perfect in the cell.
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

// Strip tags BEFORE decoding entities. The other order lets a decoded &lt;b&gt; turn into a tag
// that the stripper then eats, quietly removing real text from a title.
function text(html) {
  if (html === null || html === undefined) return null;
  const t = sanitise(decodeEntities(String(html).replace(/<[^>]*>/g, ' '))).replace(/\\s+/g, ' ').trim();
  return t === '' ? null : t;
}

// --- card parsing ----------------------------------------------------------
const RE_URN = /data-entity-urn="urn:li:jobPosting:(\\d+)"/g;
const RE_TITLE = /<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\\s\\S]*?)<\\/h3>/;
const RE_COMPANY = /<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\\s\\S]*?)<\\/h4>/;
const RE_LOCATION = /<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\\s\\S]*?)<\\/span>/;
const RE_TIME = /<time[^>]*datetime="([^"]+)"/;
const RE_LINK = /<a[^>]*class="[^"]*base-card__full-link[^"]*"[^>]*href="([^"]+)"/;
// A second, independent marker for "a card is here". Counting these against the ids found is the
// only way a card whose id attribute is missing leaves any trace at all.
const RE_TITLE_MARKER = /base-search-card__title/g;
// Scaffolding that says "this is still a LinkedIn job list", used to tell a reshaped page from a
// page that is not this endpoint.
const RE_SCAFFOLD = /base-search-card|job-search-card|base-card/;
// A challenge or a login wall served with a 200. Kept deliberately tight: every one of these
// strings would be strange inside a real result fragment.
const RE_WALL = /authwall|checkpoint\\/challenge|captcha|cf-browser-verification|Just a moment\\.\\.\\./i;

function sliceCards(html) {
  RE_URN.lastIndex = 0;
  const hits = [];
  let m;
  while ((m = RE_URN.exec(html))) hits.push({ id: m[1], at: m.index });
  return hits.map((h, i) => ({
    id: h.id,
    html: html.slice(h.at, i + 1 < hits.length ? hits[i + 1].at : html.length),
  }));
}

function countMatches(html, re) {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(html)) n += 1;
  return n;
}

function firstGroup(re, chunk) {
  const m = re.exec(chunk);
  return m ? m[1] : null;
}

function cleanUrl(href) {
  if (!href) return null;
  // The query string is tracking only per the contract (position, pageNum, refId, trackingId), and
  // keeping it would make the same job look like a different row on every run.
  const base = decodeEntities(String(href)).split('?')[0].split('#')[0].trim();
  return base === '' ? null : base;
}

// --- classification --------------------------------------------------------
function classify(res, html) {
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
  if (status < 200 || status >= 300) {
    return { outcome: 'error', status_code: status, reason: 'HTTP ' + status + ' ' + (res.statusMessage || '') };
  }

  const body = typeof html === 'string' ? html : (html === null || html === undefined ? '' : String(html));
  if (RE_WALL.test(body)) {
    return { outcome: 'refused', status_code: status, reason: 'HTTP ' + status + ' carrying a login wall or a bot challenge instead of results. A refusal dressed as a success.' };
  }

  const ids = countMatches(body, RE_URN);
  const titleMarkers = countMatches(body, RE_TITLE_MARKER);
  const visibleText = decodeEntities(body.replace(/<[^>]*>/g, ' ')).replace(/\\s+/g, ' ').trim();

  if (ids > 0) {
    const out = { outcome: 'ok', status_code: status, reason: null, cards_seen: ids, title_markers: titleMarkers };
    if (titleMarkers > ids) {
      out.cards_unparsed = titleMarkers - ids;
      out.reason = 'parsed ' + ids + ' card(s) but the body carries ' + titleMarkers + ' title element(s): ' + (titleMarkers - ids) + ' card(s) have no ' + SELECTOR_TOKENS_job_id + ' and were skipped. That is a markup change hiding inside a working call.';
    }
    return out;
  }

  // 2xx, no ids. Now the three ways that happens.
  if (titleMarkers > 0 || RE_SCAFFOLD.test(body)) {
    return {
      outcome: 'markup_changed',
      status_code: status,
      reason: 'HTTP ' + status + ' with ' + body.length + ' bytes of LinkedIn card markup and ZERO job ids. The cards are there and the ' + SELECTOR_TOKENS_job_id + ' attribute this lane keys on is not. Re-read the card HTML and update field_map in the source contract; do not read this as no jobs.',
      title_markers: titleMarkers,
    };
  }
  if (visibleText === '') {
    return {
      outcome: 'empty',
      status_code: status,
      reason: 'HTTP ' + status + ' with no cards and no text. Read as a genuine no-results-in-this-window.',
      empty_shape_unverified: true,
    };
  }
  return {
    outcome: 'markup_changed',
    status_code: status,
    reason: 'HTTP ' + status + ' with ' + visibleText.length + ' characters of text and no LinkedIn card markup at all. Something other than this endpoint is answering.',
  };
}

// --- correlate, classify, extract ------------------------------------------
// The HTTP node emits one item per input item, in order, each stamped with pairedItem.item = the
// index of the call that produced it. So pairedItem is the correlation, and position is only the
// fallback for an item that carries none.
//
// The fallback is deliberately NOT a second chance for a pairedItem that IS present and points
// nowhere. An out of range pairedItem means the stream is not the shape this node was built
// against, and quietly re-correlating it by position would attach a real job row to the wrong
// search term: right row, wrong provenance, and nothing anywhere would say so. That case is
// reported as an error instead.
function plannedIndexFor(item, i) {
  const pi = item.pairedItem;
  if (typeof pi === 'number') return { idx: pi, via: 'pairedItem' };
  if (pi && typeof pi === 'object' && !Array.isArray(pi) && typeof pi.item === 'number') return { idx: pi.item, via: 'pairedItem' };
  if (Array.isArray(pi) && pi.length && pi[0] && typeof pi[0].item === 'number') return { idx: pi[0].item, via: 'pairedItem' };
  return { idx: i, via: 'position' };
}

const rows = [];
const calls = [];
const seenIds = {};
let duplicateRows = 0;
let cardsUnparsedTotal = 0;
const missingField = { title: 0, company: 0, location: 0, posted_at: 0, url: 0 };
let correlationDegraded = items.length !== planned.length;

for (let i = 0; i < items.length; i += 1) {
  const res = items[i].json || {};
  const corr = plannedIndexFor(items[i], i);
  const unit = planned[corr.idx] || null;
  if (!unit) {
    calls.push({
      seq: null, of: null, term: null, location_setting: null, url: null,
      outcome: 'error', status_code: null, cards: 0, rows: 0,
      reason: 'response ' + (i + 1) + ' of ' + items.length + ' points at planned call ' + (corr.idx + 1) +
        ' (via ' + corr.via + ') and only ' + planned.length + ' were planned, so it could not be matched to any of them. ' +
        'It is reported rather than parsed: a row whose search term and location are unknown cannot be trusted, and guessing ' +
        'one by arrival order would attach real jobs to the wrong query.',
    });
    correlationDegraded = true;
    continue;
  }
  if (corr.via === 'position') correlationDegraded = true;

  const body = res.body;
  const verdict = classify(res, body);
  const call = {
    seq: unit.seq,
    of: unit.of,
    term: unit.term,
    term_language: unit.term_language,
    location_setting: unit.location_setting,
    location: unit.location,
    url: unit.url,
    outcome: verdict.outcome,
    status_code: verdict.status_code,
    reason: verdict.reason,
    cards: 0,
    rows: 0,
  };
  if (verdict.cards_unparsed) {
    call.cards_unparsed = verdict.cards_unparsed;
    cardsUnparsedTotal += verdict.cards_unparsed;
  }
  if (verdict.empty_shape_unverified) call.empty_shape_unverified = true;

  if (verdict.outcome === 'ok') {
    const cards = sliceCards(String(body));
    call.cards = cards.length;
    for (const card of cards) {
      const jobId = SOURCE_DEDUP_PREFIX + card.id;
      if (seenIds[jobId]) duplicateRows += 1;
      seenIds[jobId] = (seenIds[jobId] || 0) + 1;

      const values = {
        job_id: jobId,
        found_at: foundAt,
        source: SOURCE_KEY,
        title: text(firstGroup(RE_TITLE, card.html)),
        company: text(firstGroup(RE_COMPANY, card.html)),
        location: text(firstGroup(RE_LOCATION, card.html)),
        // Not on the card. The contract says to infer it from the request: f_WT=2 means the whole
        // result set is remote. Anything else stays null, because unknown is not the same as false
        // and a false here would drop a remote job at the geo filter.
        remote: unit.work_type === '2' ? true : null,
        posted_at: firstGroup(RE_TIME, card.html),
        url: cleanUrl(firstGroup(RE_LINK, card.html)),
        apply_url: null,
        lane: unit.lane,
        excerpt: null,
      };

      const partial = [];
      for (const f of ['title', 'company', 'location', 'posted_at', 'url']) {
        if (values[f] === null || values[f] === undefined) { partial.push(f); missingField[f] += 1; }
      }

      const row = { _kind: 'job' };
      for (const k of ROW_SHAPE) row[k] = values[k] === undefined ? null : values[k];
      for (const k of LEFT_FOR_LATER) row[k] = null;
      row._collect = {
        source: SOURCE_KEY,
        seq: unit.seq,
        of: unit.of,
        term: unit.term,
        term_language: unit.term_language,
        location_setting: unit.location_setting,
        request_url: unit.url,
        status_code: verdict.status_code,
        raw_job_id: card.id,
        dedup_id_rule: unit.dedup_id_rule,
        date_field: unit.date_field,
        date_format: unit.date_format,
        window_start: unit.window_start,
        window_start_effective: unit.window_start_effective,
        window_end: unit.window_end,
        // LinkedIn cuts the window server side with f_TPR, so a row with no date is still inside
        // the window by construction. Stage E needs to know that before it drops one.
        window_filtered_server_side: unit.window_filtered_server_side === true,
        partial_fields: partial,
        probe_required: unit.probe_required || [],
      };
      rows.push({ json: row, pairedItem: { item: i } });
      call.rows += 1;
    }
  }

  calls.push(call);
}

// --- the report ------------------------------------------------------------
const counts = { ok: 0, empty: 0, refused: 0, error: 0, markup_changed: 0 };
for (const c of calls) counts[c.outcome] = (counts[c.outcome] || 0) + 1;

const delivered = counts.ok + counts.empty;
const failed = counts.refused + counts.error + counts.markup_changed;
const missingResponses = planned.length - items.length;
const partialParse = cardsUnparsedTotal > 0;

let verdict;
if (failed === 0 && missingResponses === 0 && !partialParse && !correlationDegraded) {
  verdict = 'ok';
} else if (delivered === 0) {
  verdict = 'down';
} else {
  verdict = 'degraded';
}

const cardCounts = calls.filter((c) => c.outcome === 'ok').map((c) => c.cards);
const maxCards = cardCounts.length ? Math.max.apply(null, cardCounts) : 0;

const warnings = [];
if (counts.refused) {
  warnings.push(
    'LinkedIn REFUSED ' + counts.refused + ' of ' + calls.length + ' call(s). This lane plans ' + planned.length +
    ' LinkedIn calls per run against a documented threshold of roughly ten pages before a datacenter IP is refused, ' +
    'and the n8n box is a datacenter IP. This is the risk Stage A named and it has now fired. ' +
    'Levers, cheapest first: cut search_terms in the settings tab, raise batchInterval in Search LinkedIn ' +
    '(currently ' + PACING.batch_interval_ms + ' ms), then try a browser User-Agent, which is deliberately absent so that a ' +
    'refusal can be attributed to the address rather than to an unmeasured header.'
  );
}
if (counts.markup_changed) {
  warnings.push(
    counts.markup_changed + ' call(s) answered 2xx with a body this parser does not recognise. This is NOT zero jobs. ' +
    'Re-read the card HTML against field_map for ' + SOURCE_KEY + ' in the source contract and fix it there, in the same ' +
    'session, or every later run reports a healthy zero.'
  );
}
if (partialParse) {
  warnings.push(
    cardsUnparsedTotal + ' card(s) were present in a successful response and could not be parsed, because they carry no ' +
    SELECTOR_TOKENS_job_id + '. Those jobs are missing from the sheet and nothing else would have said so.'
  );
}
if (missingResponses > 0) {
  warnings.push(missingResponses + ' planned LinkedIn call(s) produced no response item at all. Expected one item per planned call, got ' + items.length + ' for ' + planned.length + '.');
} else if (missingResponses < 0) {
  warnings.push((-missingResponses) + ' more response(s) arrived than were planned. Something other than Plan Queries is feeding the LinkedIn collector.');
}
if (counts.empty) {
  warnings.push(
    counts.empty + ' call(s) returned an empty body and are being read as a genuine no-results. That reading is ' +
    'UNVERIFIED: no empty response from this endpoint has ever been captured, so the rule is an assumption, not a measurement. ' +
    'If empty calls are frequent while the same searches show jobs in a browser, this is the first thing to distrust.'
  );
}
if (maxCards > 0 && maxCards <= 10) {
  warnings.push(
    'no call returned more than ' + maxCards + ' card(s). D2 (page size 10 or 25) is still open, and every observation so far ' +
    'has landed on exactly 10 across two different time windows. Paging on a step of 25 would skip rows. Resolve it with one ' +
    'start=10 call before any paging loop is built.'
  );
}
if (otherPlanned.length) {
  warnings.push(
    otherPlanned.length + ' planned unit(s) from other sources (' + Array.from(new Set(otherPlanned.map((u) => u.source))).join(', ') +
    ') are NOT collected in this stage. They sit on the unwired output of LinkedIn Units Only. This is a known gap, not a failure, ' +
    'and it stops being true when the board collector is wired to that output.'
  );
}

const report = {
  _kind: 'source_report',
  source: SOURCE_KEY,
  lane: (planned[0] && planned[0].lane) || LANE_NUMBER,
  run_started_at: run.run_started_at || null,
  window_start: run.window_start || null,
  window_end: run.window_end || null,
  verdict: verdict,
  source_down: verdict === 'down',
  status_token: verdict === 'down' ? 'source_down:' + SOURCE_KEY : null,
  planned_calls: planned.length,
  responses_received: items.length,
  missing_responses: missingResponses,
  correlation_degraded: correlationDegraded,
  counts: counts,
  rows_emitted: rows.length,
  distinct_job_ids: Object.keys(seenIds).length,
  duplicate_rows: duplicateRows,
  cards_unparsed: cardsUnparsedTotal,
  rows_missing_field: missingField,
  text_fields_sanitised: sanitisedFields,
  page_size_observation: {
    max_cards_on_a_successful_call: maxCards,
    calls_returning_exactly_10: cardCounts.filter((n) => n === 10).length,
    probe: 'D2',
  },
  pacing: Object.assign({}, PACING, {
    estimated_sleep_seconds: Math.max(0, (planned.length - 1) * PACING.batch_interval_ms) / 1000,
  }),
  not_collected_here: otherPlanned.map((u) => ({ seq: u.seq, source: u.source, unit: u.unit })),
  probes_outstanding: (run.plan && run.plan.probes_outstanding) || [],
  warnings: warnings,
  calls: calls,
};

// The report goes LAST and it always goes. A run where every call was refused emits zero job rows,
// and a Code node returning [] ends the branch, which would delete the evidence of the exact
// failure this node exists to report.
return rows.concat([{ json: report, pairedItem: { item: 0 } }]);
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/08-extract-linkedin.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const SOURCE_KEY = ${JSON.stringify(SOURCE_KEY)};`,
  `const SOURCE_DEDUP_PREFIX = ${JSON.stringify(S.dedup_id_rule.slice(0, S.dedup_id_rule.indexOf('-') + 1))};`,
  `const ROW_SHAPE = ${JSON.stringify(CONTRACT.shared_row_shape)};`,
  `const LEFT_FOR_LATER = ${JSON.stringify(LEFT_FOR_LATER)};`,
  `const REFUSAL_STATUSES = ${JSON.stringify(REFUSAL_STATUSES)};`,
  `const SELECTOR_TOKENS_job_id = ${JSON.stringify(SELECTOR_TOKENS.job_id)};`,
  `const PACING = ${JSON.stringify(PACING)};`,
  `const LANE_NUMBER = ${JSON.stringify(String(L.lane))};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Extract LinkedIn',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1560, 0],
  connectFrom: 'Search LinkedIn',
  notes: 'Parses LinkedIn job cards into the shared row shape and emits one source_report naming every call that was refused, empty, errored or served changed markup. A refusal is never reported as zero jobs.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

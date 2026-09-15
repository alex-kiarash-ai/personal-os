'use strict';
/*
 * 09-attach-ad.js - "Attach Ad". Puts the posting text back on the pair it belongs to, and decides
 * when a fetch that returned 200 is not actually an ad.
 *
 * =============================================================================================
 * 1. THE PAIRING, AND WHY IT REFUSES RATHER THAN GUESSES.
 * =============================================================================================
 * `$input` is the Merge output: responses and carried items in whatever order the append produced.
 * An HTTP Request node does not carry its input fields through, so a response on its own cannot say
 * which job it belongs to.
 *
 * The authority is $('Fetch Route').all(0): the true-branch items, in the order they were sent. The
 * responses line up one for one with $('Fetch Ad').all(), because an IF preserves relative order
 * and the HTTP node emits exactly one item per input item in order. `pairedItem` is the second
 * opinion where the node set it, and a THIRD independent count comes from Build Candidates, which
 * stamped `_call_now` on every item before any of this happened.
 *
 * If the lengths disagree, or a pairedItem points elsewhere, this node does NOT guess an alignment.
 * It stamps `error:pairing` on the whole fetched batch and attaches no ad to any of it. The failure
 * it is refusing is one job ad landing on another job pair, which produces a perfectly formatted
 * CV and cover letter for the wrong company. That is worse than no letter and it is invisible on
 * the sheet, because every count would still be right.
 *
 * SCOPE OF THE REFUSAL, stated because "whole batch" is ambiguous. It covers the pairs that were
 * FETCHED. A capped pair or a pair whose url failed the guard never had an ad to mis-attach and is
 * left exactly as it arrived; marking those would change what the write-back half writes into their
 * status cells for a fault that cannot touch them.
 *
 * =============================================================================================
 * 2. A 200 IS NOT AN AD. THE THREE WAYS A FETCH LIES.
 * =============================================================================================
 *   an AUTHWALL         LinkedIn serves a sign-in page with a 200 and a full HTML body.
 *   a CHALLENGE page    a bot check from a CDN, also 200, also full of markup.
 *   a THIN page         a client-rendered board whose server response carries no posting at all.
 * All three produce a body, none produces an ad, and all three would silently become a cover letter
 * written about a login screen. So the text is measured after extraction: under
 * ad_min_useful_chars, or carrying an unambiguous challenge marker, and the fetch is treated as a
 * FAILED fetch rather than as a short ad.
 *
 * The fallback is the row excerpt, which the collector already wrote into the sheet. It is smaller
 * and it is real. A failed fetch therefore costs detail, never a pair, which is the whole reason
 * the excerpt column exists.
 *
 * A pair with NO fetched ad AND NO excerpt is a different thing, and it is HELD rather than
 * written: an unattended writer with nothing but a job title would produce a generic letter, and
 * shipping one is the failure mode this lane is built to refuse. It surfaces for Shaheen with the
 * reason, and the ad it could not read is named.
 *
 * =============================================================================================
 * 3. THE DASHES ARE STRIPPED HERE, AT THE DOOR.
 * =============================================================================================
 * The no-dash law is absolute and it is easiest to keep by never letting the character into the
 * building. An em dash becomes a comma and a space, an en dash becomes a hyphen: the same
 * substitution the collectors make, applied to the ad before it is ever quoted to a model. This is
 * not a substitute for the audit downstream, which checks the WRITER output. It removes one whole
 * way a dash can arrive in a letter, which is by being quoted out of the posting.
 *
 * =============================================================================================
 * 4. EVERY PAIR PASSES THROUGH, INCLUDING THE DEAD ONES.
 * =============================================================================================
 * Capped pairs, refused lanes and the intake report are carried untouched. The write-back half
 * stamps a status cell for every capped pair in the same batch write, so losing one here would
 * leave a row in the sheet saying `new` that this run had already decided about.
 */

const LN = require('./_lane');
const CAPS = LN.caps().values;

// Markers that mean the page is a gate rather than a posting.
// STRONG markers fire whatever the length: none of them appears in a real job ad.
// WEAK markers fire only on a SHORT page, because a long ad can legitimately contain the words
// "sign in" or "cookies" somewhere in its benefits section, and dropping a real ad on that would be
// the same under-collection this whole stage exists to avoid.
const STRONG_CHALLENGE_MARKERS = [
  'authwall', 'captcha', 'are you a robot', 'attention required', 'access to this page has been denied',
  'verify you are human', 'security verification', 'unusual traffic',
];
const WEAK_CHALLENGE_MARKERS = [
  'sign in to continue', 'join linkedin', 'please enable javascript', 'enable cookies',
  'access denied', 'forbidden', 'temporarily unavailable', 'page not found',
];
const WEAK_MARKER_MAX_CHARS = 3000;

// HTML entities worth naming. Everything numeric is decoded generically below. The apostrophe is
// built from its code point rather than written, because this table is baked into a generated
// string and an apostrophe inside one is the escape class that breaks on the other side.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: String.fromCharCode(39), nbsp: ' ',
  hellip: '...', bull: '-', middot: '-', laquo: '"', raquo: '"',
  lsquo: String.fromCharCode(39), rsquo: String.fromCharCode(39), ldquo: '"', rdquo: '"',
  eacute: 'e', egrave: 'e', uuml: 'u', ouml: 'o', auml: 'a', aring: 'a', oslash: 'o', aelig: 'ae',
};

(function assertAgainstUpstream() {
  const merge = require('./08-fetch-results.js');
  const route = require('./06-fetch-route.js');
  const fetchAd = require('./07-fetch-ad.js');
  const build = require('./05-build-candidates.js');
  if (merge.name !== 'Fetch Results') throw new Error('Attach Ad: node 08 is named ' + JSON.stringify(merge.name) + ' and this node connects from "Fetch Results".');
  if (route.name !== 'Fetch Route') throw new Error('Attach Ad: node 06 is named ' + JSON.stringify(route.name) + ' and this node reads $(\'Fetch Route\') output 0 for the authoritative sent order.');
  if (fetchAd.name !== 'Fetch Ad') throw new Error('Attach Ad: node 07 is named ' + JSON.stringify(fetchAd.name) + ' and this node reads $(\'Fetch Ad\') for the responses.');
  if (build.name !== 'Build Candidates') throw new Error('Attach Ad: node 05 is named ' + JSON.stringify(build.name) + ' and this node reads $(\'Build Candidates\') for the independent count of what should have been called.');

  // outputPropertyName body is what makes the text readable at all. Without it n8n puts the body on
  // `data` and this node reads undefined on every call, which looks exactly like eight job boards
  // going quiet on the same morning.
  const resp = fetchAd.parameters.options && fetchAd.parameters.options.response && fetchAd.parameters.options.response.response;
  if (!resp || resp.responseFormat !== 'text' || resp.outputPropertyName !== 'body') {
    throw new Error(
      'Attach Ad: Fetch Ad no longer sets responseFormat text with outputPropertyName body.\n' +
      '  With responseFormat text n8n lands the body under outputPropertyName, which DEFAULTS to `data`,\n' +
      '  so this node would read undefined on every call and report every posting as having no ad.'
    );
  }
  if (resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error('Attach Ad: Fetch Ad no longer sets fullResponse AND neverError. This node reads statusCode off the item to tell an authwall from a rate limit from a dead host.');
  }
  if (merge.parameters.numberInputs !== 2) {
    throw new Error('Attach Ad: Fetch Results declares numberInputs ' + JSON.stringify(merge.parameters.numberInputs) + '. This node expects the two-input join.');
  }
  if (!Number.isInteger(CAPS.ad_text_max_chars) || CAPS.ad_text_max_chars < CAPS.ad_min_useful_chars) {
    throw new Error('Attach Ad: the ad text cap (' + CAPS.ad_text_max_chars + ') is below the usefulness floor (' + CAPS.ad_min_useful_chars + '), so every fetched ad would be truncated below the line at which it is treated as a failed fetch.');
  }
  const overlap = STRONG_CHALLENGE_MARKERS.filter((m) => WEAK_CHALLENGE_MARKERS.indexOf(m) !== -1);
  if (overlap.length) {
    throw new Error('Attach Ad: ' + JSON.stringify(overlap) + ' is listed as both a strong and a weak challenge marker. A strong marker fires at any length and a weak one only on a short page, so a marker can only be one.');
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Attach Ad. Pair, extract, judge, fall back, and pass every dead pair through.
// ---------------------------------------------------------------------------
const NL = String.fromCharCode(10);
const EM_DASH = String.fromCharCode(8212);
const EN_DASH = String.fromCharCode(8211);

function txt(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[\\u0000-\\u001F\\u007F]/g, ' ').replace(/\\s+/g, ' ').trim();
}

// --- 1. the three views of who was called -----------------------------------
let called = null;
let calledWhy = null;
try {
  called = $('Fetch Route').all(0).map((i) => i.json);
} catch (e) {
  called = null;
  calledWhy = e.message;
}
let responses = null;
let responsesWhy = null;
try {
  responses = $('Fetch Ad').all();
} catch (e) {
  responses = null;
  responsesWhy = e.message;
}
let expectedCalls = null;
try {
  expectedCalls = $('Build Candidates').all().map((i) => i.json).filter((j) => j && j._call_now === true).length;
} catch (e) {
  expectedCalls = null;
}
if (called === null) called = [];

const carried = $input.all().map((i) => i.json).filter((j) => j && j._kind !== undefined);

let pairing = 'ok';
let pairingWhy = null;
const warnings = [];

if (expectedCalls !== null && called.length !== expectedCalls) {
  pairing = 'mismatch';
  pairingWhy = 'Build Candidates stamped _call_now true on ' + expectedCalls + ' item(s) and Fetch Route sent ' + called.length +
    ' down the fetch branch. The route and the stamp have come apart, so nothing here can say which ad belongs to which job.';
} else if (responses === null) {
  if (called.length > 0) {
    // NOT a mismatch: nothing came back for anything, which is knowable and recoverable. Every
    // called pair falls back to its excerpt rather than being refused.
    warnings.push('the Fetch Ad node produced no run data (' + (responsesWhy || 'unknown') + ') while ' + called.length +
      ' pair(s) were routed to it. Every one of them falls back to its own excerpt, which is smaller and real. If this repeats, the node is not executing rather than the hosts refusing.');
  }
} else if (responses.length !== called.length) {
  pairing = 'mismatch';
  pairingWhy = 'Fetch Route sent ' + called.length + ' pair(s) and Fetch Ad returned ' + responses.length +
    '. Refusing to guess an alignment: one job ad on another job pair produces a perfectly formatted letter for the wrong company, which is worse than no letter and invisible on the sheet.';
}
if (pairing === 'ok' && responses !== null) {
  for (let i = 0; i < responses.length; i += 1) {
    const pi = responses[i] && responses[i].pairedItem;
    const idx = pi && typeof pi === 'object' && !Array.isArray(pi) ? pi.item : (Array.isArray(pi) && pi.length ? pi[0].item : undefined);
    if (idx !== undefined && Number(idx) !== i) {
      pairing = 'mismatch';
      pairingWhy = 'response ' + i + ' carries pairedItem ' + JSON.stringify(idx) + ', so the responses are not in the order they were sent. Refusing to guess an alignment.';
      break;
    }
  }
}

// --- 2. html to text ---------------------------------------------------------
function decodeEntities(s) {
  let out = String(s);
  out = out.replace(/&#(\\d+);/g, function (m, d) {
    const n = Number(d);
    return (n > 0 && n < 1114112) ? String.fromCharCode(n) : ' ';
  });
  out = out.replace(/&#[xX]([0-9a-fA-F]+);/g, function (m, h) {
    const n = parseInt(h, 16);
    return (n > 0 && n < 1114112) ? String.fromCharCode(n) : ' ';
  });
  out = out.replace(/&([a-zA-Z]+);/g, function (m, name) {
    const key = String(name).toLowerCase();
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, key) ? NAMED_ENTITIES[key] : ' ';
  });
  return out;
}

// The dash sweep. See header note 3. Built from code points so the characters themselves never
// appear in any file in this repo.
function stripDashes(s) {
  return String(s).split(EM_DASH).join(', ').split(EN_DASH).join('-');
}

function htmlToText(raw) {
  let s = String(raw === null || raw === undefined ? '' : raw);
  // Whole elements whose content is never the posting.
  s = s.replace(/<!--[\\s\\S]*?-->/g, ' ');
  s = s.replace(/<script[\\s\\S]*?<\\/script\\s*>/gi, ' ');
  s = s.replace(/<style[\\s\\S]*?<\\/style\\s*>/gi, ' ');
  s = s.replace(/<noscript[\\s\\S]*?<\\/noscript\\s*>/gi, ' ');
  s = s.replace(/<nav[\\s\\S]*?<\\/nav\\s*>/gi, ' ');
  s = s.replace(/<header[\\s\\S]*?<\\/header\\s*>/gi, ' ');
  s = s.replace(/<footer[\\s\\S]*?<\\/footer\\s*>/gi, ' ');
  s = s.replace(/<svg[\\s\\S]*?<\\/svg\\s*>/gi, ' ');
  s = s.replace(/<form[\\s\\S]*?<\\/form\\s*>/gi, ' ');
  // Block boundaries become line breaks so paragraphs and bullets survive as structure.
  s = s.replace(/<br\\s*\\/?>/gi, NL);
  s = s.replace(/<\\/(p|div|li|tr|h1|h2|h3|h4|h5|h6|section|article|ul|ol|table|blockquote)\\s*>/gi, NL);
  s = s.replace(/<[^>]*>/g, ' ');
  s = decodeEntities(s);
  s = stripDashes(s);
  s = s.replace(/[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]/g, ' ');
  s = s.replace(/[\\u200B-\\u200D\\uFEFF\\u00A0]/g, ' ');
  s = s.replace(/[ \\t]+/g, ' ');
  s = s.replace(/[ \\t]*\\n[ \\t]*/g, NL);
  s = s.replace(/\\n{3,}/g, NL + NL);
  return s.trim();
}

function challengeHit(text, url) {
  const low = String(text).toLowerCase();
  const lowUrl = String(url || '').toLowerCase();
  if (lowUrl.indexOf('authwall') !== -1 || lowUrl.indexOf('/login') !== -1 || lowUrl.indexOf('/checkpoint') !== -1) {
    return 'the url itself is a sign-in or checkpoint page';
  }
  for (const m of STRONG_CHALLENGE_MARKERS) {
    if (low.indexOf(m) !== -1) return 'the page carries ' + JSON.stringify(m) + ', which no job ad does';
  }
  if (low.length <= WEAK_MARKER_MAX_CHARS) {
    for (const m of WEAK_CHALLENGE_MARKERS) {
      if (low.indexOf(m) !== -1) return 'the page is short (' + low.length + ' characters) and carries ' + JSON.stringify(m);
    }
  }
  return null;
}

// --- 3. the fallback ---------------------------------------------------------
// One place decides what a pair ends up reading, so a failed fetch and an unguardable url take the
// identical path and the run report can count them together.
function useExcerpt(pair, why) {
  const ex = stripDashes(txt(pair.excerpt));
  if (ex) {
    pair.ad_text = ex.slice(0, AD_TEXT_MAX);
    pair.ad_chars = pair.ad_text.length;
    pair.ad_source = 'excerpt_only';
    pair.ad_why = why + ' The row own excerpt is used instead, which is a smaller read rather than a failure.';
    return;
  }
  pair.ad_text = '';
  pair.ad_chars = 0;
  pair.ad_source = 'none';
  pair.ad_why = why + ' The row carries no excerpt either, so there is NO posting text at all.';
  pair._status = 'held:no_ad_text';
  pair._status_why = 'no ad could be read and the sheet row carries no excerpt, so the only material for a letter would be the job title. ' +
    'An unattended writer with that much would produce a generic letter, and shipping one is exactly what this lane refuses. ' +
    'Held for Shaheen with the url that could not be read: ' + (pair.ad_fetch_url || pair.url || 'none recorded');
}

// --- 4. the fetched pairs ----------------------------------------------------
const outPairs = [];
const stats = { fetched: 0, excerpt_only: 0, held_no_ad: 0, refused_http: 0, challenge: 0, thin: 0, transport: 0, truncated: 0, pairing_refused: 0 };
const statusCodes = {};
const refusalSamples = [];

for (let i = 0; i < called.length; i += 1) {
  const pair = Object.assign({}, called[i]);

  if (pairing === 'mismatch') {
    pair._status = 'error:pairing';
    pair._status_why = pairingWhy;
    pair.ad_text = '';
    pair.ad_chars = 0;
    pair.ad_source = 'none';
    pair.ad_why = 'no ad was attached to any fetched pair this run, because the responses could not be matched to the requests.';
    stats.pairing_refused += 1;
    outPairs.push(pair);
    continue;
  }

  if (responses === null) {
    useExcerpt(pair, 'the fetch node produced no run data at all.');
    stats.excerpt_only += (pair.ad_source === 'excerpt_only' ? 1 : 0);
    stats.held_no_ad += (pair._status === 'held:no_ad_text' ? 1 : 0);
    outPairs.push(pair);
    continue;
  }

  const item = responses[i] || {};
  const j = item.json || {};

  if (j.error !== undefined && j.statusCode === undefined) {
    stats.transport += 1;
    const msg = String(typeof j.error === 'string' ? j.error : (j.error && j.error.message) || JSON.stringify(j.error)).slice(0, 200);
    if (refusalSamples.length < 5) refusalSamples.push({ job_id: pair.job_id, host: pair.ad_fetch_host, why: 'transport: ' + msg });
    useExcerpt(pair, 'the request never completed (' + msg + ').');
    stats.excerpt_only += (pair.ad_source === 'excerpt_only' ? 1 : 0);
    stats.held_no_ad += (pair._status === 'held:no_ad_text' ? 1 : 0);
    outPairs.push(pair);
    continue;
  }

  const status = Number(j.statusCode);
  pair.ad_http_status = isFinite(status) ? status : null;
  if (isFinite(status)) statusCodes[String(status)] = (statusCodes[String(status)] || 0) + 1;

  if (!isFinite(status) || status < 200 || status >= 300) {
    stats.refused_http += 1;
    const label = status === 429 ? 'rate limited (429)'
      : status === 999 ? 'refused with LinkedIn own 999, which is what a datacenter IP gets'
      : status === 403 ? 'forbidden (403)'
      : status === 404 ? 'the posting is gone (404), which is ordinary: postings vanish'
      : (isFinite(status) ? 'HTTP ' + status : 'no status code at all');
    if (refusalSamples.length < 5) refusalSamples.push({ job_id: pair.job_id, host: pair.ad_fetch_host, why: label });
    useExcerpt(pair, 'the host ' + label + '.');
    stats.excerpt_only += (pair.ad_source === 'excerpt_only' ? 1 : 0);
    stats.held_no_ad += (pair._status === 'held:no_ad_text' ? 1 : 0);
    outPairs.push(pair);
    continue;
  }

  let text = htmlToText(j.body);
  const gate = challengeHit(text, pair.ad_fetch_url);
  if (gate) {
    stats.challenge += 1;
    if (refusalSamples.length < 5) refusalSamples.push({ job_id: pair.job_id, host: pair.ad_fetch_host, why: 'challenge page: ' + gate });
    useExcerpt(pair, 'the host answered 200 with a gate rather than a posting: ' + gate + '.');
    stats.excerpt_only += (pair.ad_source === 'excerpt_only' ? 1 : 0);
    stats.held_no_ad += (pair._status === 'held:no_ad_text' ? 1 : 0);
    outPairs.push(pair);
    continue;
  }
  if (text.length < AD_MIN_USEFUL) {
    stats.thin += 1;
    useExcerpt(pair, 'the fetch returned 200 and only ' + text.length + ' characters of text, under the ' + AD_MIN_USEFUL + ' character floor, which is a client rendered page rather than a short ad.');
    stats.excerpt_only += (pair.ad_source === 'excerpt_only' ? 1 : 0);
    stats.held_no_ad += (pair._status === 'held:no_ad_text' ? 1 : 0);
    outPairs.push(pair);
    continue;
  }

  let truncated = false;
  if (text.length > AD_TEXT_MAX) {
    text = text.slice(0, AD_TEXT_MAX);
    truncated = true;
    stats.truncated += 1;
  }
  pair.ad_text = text;
  pair.ad_chars = text.length;
  pair.ad_truncated = truncated;
  pair.ad_source = 'fetched';
  pair.ad_why = 'fetched from ' + (pair.ad_fetch_host || 'the row url') + ' and extracted to ' + text.length + ' characters of plain text' + (truncated ? ', truncated at the ' + AD_TEXT_MAX + ' character cap' : '') + '.';
  stats.fetched += 1;
  outPairs.push(pair);
}

// --- 5. the carried items -----------------------------------------------------
// Pairs that never went to the fetch, and every report. A capped pair is never given an ad: it is
// not going to be read and attaching one would only put a job posting into a sheet cell later.
const outCarried = [];
for (const raw of carried) {
  if (!raw || raw._kind !== 'pair') { outCarried.push(raw); continue; }
  const pair = Object.assign({}, raw);
  if (pair._status) {
    pair.ad_text = '';
    pair.ad_chars = 0;
    pair.ad_source = 'none';
    pair.ad_why = 'this pair is ' + pair._status + ', so no ad was fetched and none is needed.';
    outCarried.push(pair);
    continue;
  }
  useExcerpt(pair, 'no ad url survived the guard for this row (' + (pair.ad_fetch_why || 'no reason recorded') + ').');
  if (pair.ad_source === 'excerpt_only') stats.excerpt_only += 1;
  if (pair._status === 'held:no_ad_text') stats.held_no_ad += 1;
  outCarried.push(pair);
}

// --- 6. the stage report -------------------------------------------------------
if (pairing === 'mismatch') {
  warnings.push('PAIRING REFUSED, and no ad was attached to any fetched pair because of it: ' + pairingWhy);
}
if (stats.challenge > 0) {
  warnings.push(stats.challenge + ' fetch(es) returned 200 with a sign-in or bot-check page rather than a posting. Those are NOT empty ads: the host answered and refused. Every one fell back to its row excerpt.');
}
if (stats.refused_http > 0) {
  warnings.push(stats.refused_http + ' fetch(es) were refused with a status code (' + JSON.stringify(statusCodes) + '). A 999 or a repeated 429 from LinkedIn is the datacenter IP question this system has been carrying unmeasured, and it is worth reading as that rather than as a bad morning.');
}
if (stats.held_no_ad > 0) {
  warnings.push(stats.held_no_ad + ' pair(s) are HELD because no ad could be read and the sheet row carries no excerpt either. They cost nothing further and they surface for Shaheen with the url that failed.');
}
if (stats.truncated > 0) {
  warnings.push(stats.truncated + ' ad(s) were longer than the ' + AD_TEXT_MAX + ' character cap and were cut. A job ad that long is usually boilerplate past the halfway point, and the cap is what keeps one posting from dominating the reader prompt.');
}

const report = {
  _kind: 'stage_report',
  stage: 'ad',
  pairing: { state: pairing, why: pairingWhy, sent: called.length, responses: responses === null ? null : responses.length, expected: expectedCalls },
  counts: stats,
  http_status_codes: statusCodes,
  refusal_samples: refusalSamples,
  caps: { ad_text_max_chars: AD_TEXT_MAX, ad_min_useful_chars: AD_MIN_USEFUL, weak_marker_max_chars: WEAK_MARKER_MAX_CHARS },
  rule: 'a 200 is not an ad. An authwall, a bot check and a client rendered shell all return a body and none of them returns a posting, so the extracted text is measured and marked rather than trusted.',
  warnings: warnings,
  _call_now: false,
  ad_fetch_url: '',
};

// Never an empty array: a Code node returning [] ends the branch, and the run with nothing to
// attach is the run whose report matters most.
const items = outPairs.concat(outCarried).map((j) => ({ json: j, pairedItem: { item: 0 } }));
items.push({ json: report, pairedItem: { item: 0 } });
return items;
`;

const jsCode = [
  '// GENERATED at build time from work/36-job-application-writer/nodes/09-attach-ad.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  'const AD_TEXT_MAX = ' + JSON.stringify(CAPS.ad_text_max_chars) + ';',
  'const AD_MIN_USEFUL = ' + JSON.stringify(CAPS.ad_min_useful_chars) + ';',
  'const STRONG_CHALLENGE_MARKERS = ' + JSON.stringify(STRONG_CHALLENGE_MARKERS) + ';',
  'const WEAK_CHALLENGE_MARKERS = ' + JSON.stringify(WEAK_CHALLENGE_MARKERS) + ';',
  'const WEAK_MARKER_MAX_CHARS = ' + JSON.stringify(WEAK_MARKER_MAX_CHARS) + ';',
  'const NAMED_ENTITIES = ' + JSON.stringify(NAMED_ENTITIES) + ';',
  LOGIC,
].join('\n');

module.exports = {
  name: 'Attach Ad',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1820, 100],
  connectFrom: 'Fetch Results',
  notes: 'Pairs each ad response back to its job by sent order, cross checked against pairedItem and against the count Build Candidates stamped. Turns HTML into plain text, strips dashes at the door, and treats an authwall, a bot check or a page under the usefulness floor as a FAILED fetch rather than a short ad, falling back to the row excerpt. A pair with neither is held rather than written. A pairing mismatch refuses the whole fetched batch and guesses nothing.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

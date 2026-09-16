'use strict';
/*
 * 07-case-metrics.js - "Case Metrics". The scorer. One verdict per case, computed by code, with no
 * model anywhere in the loop.
 *
 * =============================================================================================
 * 1. WHAT IT CHECKS, AND WHERE EACH CHECK COMES FROM.
 * =============================================================================================
 * Thirteen blocking checks, each one the same rule the runtime pair audit runs, carrying the
 * runtime's own id so a failure here can be read straight against nodes/34-audit-pair.js:
 *
 *   dashes      (A1.letter)    zero U+2013 and zero U+2014
 *   tells       (A2)           none of the reconciled AI tells
 *   words       (A3)           the 100 to 280 band
 *   skeleton    (A4)           greeting, role line, work authorization opener, city, employer,
 *                              availability, no sign off phrase, the signature, the paragraph
 *                              band, and the gap sentence really being in the letter
 *   pronouns    (A5.letter)    no he, him, his, she, her, hers, himself, herself
 *   claim:*     (A6,A7,A9,A10) seven named claims, one check each, so a failure names the rule
 *   numbers     (A8)           every figure on the approved list or inside a proved quotable span
 *
 * The tables are not retyped. scripts/lib/voice-rules.js renders them and this node bakes the
 * render, exactly as the audit node does, so there is ONE definition of a tell, a pronoun, a dash
 * and a banned claim in this repo and the eval cannot be enforcing last month's list. The identity
 * values (his name, his city, the greeting, the sign off pattern, the per lane approved figures)
 * are lifted out of node 34's baked AUDIT_CFG, which derived them from the masters, for the same
 * reason and with more force: one of them is his name.
 *
 * normalise(), wordCount() and extractNumbers() are lifted verbatim out of node 34's generated
 * code. A word count or a number tokeniser that differs by one rule between the eval and the audit
 * produces an eval that passes a letter the lane would reject, which is the exact failure a
 * regression harness exists to prevent.
 *
 * THE ONE THING THAT IS NOT LIFTED, said plainly rather than left to be found: flat() and
 * spanIsIn() are four lines that live INSIDE a closure in node 34, so bakedFunction cannot cut them
 * at column zero. They are re-declared below with identical semantics (collapse whitespace,
 * lowercase, trim, drop trailing punctuation from the needle, substring). If node 34's copy ever
 * changes, this one has to change with it, and nothing mechanical will say so.
 *
 * =============================================================================================
 * 2. WHY THE WHOLE SET RUNS ON EVERY CASE.
 * =============================================================================================
 * Each case baits ONE failure, named in `case.primary`. The scorer still runs all thirteen, because
 * that is what the runtime does: a letter that dodged its own bait and then put an em dash in
 * paragraph four is a letter the lane would send back for a rewrite, and an eval that passed it
 * would be answering a narrower question than the one it claims to. The summary reports the primary
 * separately so a failure is legible at a glance.
 *
 * =============================================================================================
 * 3. WHAT IS ADVISORY, AND WHY IT IS NOT BLOCKING.
 * =============================================================================================
 *   screen_dashes             the system block says the dash characters appear nowhere in the
 *                             ANSWER, screening note included. The runtime audit checks the LETTER
 *                             only. Blocking here would make the eval red for something the live
 *                             lane ships green, and a red that is not a defect teaches people to
 *                             scroll past the suite. Worth seeing, so it is a NOTE.
 *   screen_objection_verbatim the note promises each named sentence is copied character for
 *                             character. The runtime enforces that for the GAP line only (the A4
 *                             honest_gap leg), so the gap line is blocking here and the objection
 *                             lines are a NOTE. Same reasoning, same direction.
 *
 * =============================================================================================
 * 4. evaluateLetter() IS DECLARED AT COLUMN ZERO ON PURPOSE.
 * =============================================================================================
 * config/test-letter-eval.js LIFTS it out of this node's generated code the same way this node
 * lifts from node 34, and runs THOSE BYTES against synthetic letters offline. That is the only way
 * to prove a guard refuses a violation without paying for six model calls to find out, and the
 * Close-Out rule for guard class code requires the failing demonstration before the pass is
 * reported. It takes every table as an argument and closes over nothing except the three lifted
 * helpers, so the lift is a clean cut.
 */

const path = require('path');
const E = require('./_eval');
const S2 = require(path.join(__dirname, '..', 'nodes', '_stage2.js'));
const VR = require(path.join(S2.REPO, 'scripts', 'lib', 'voice-rules.js'));

const CFG = E.auditCfg();

const CHECK_IDS = ['dashes', 'tells', 'words', 'skeleton', 'pronouns', 'numbers']
  .concat(VR.CLAIMS.map((c) => 'claim:' + c.id));

(function assertAgainstUpstream() {
  const parse = require('./06-parse-eval-letter.js');
  if (parse.name !== 'Parse Eval Letter') {
    throw new Error('Case Metrics: node 06 is named ' + JSON.stringify(parse.name) + ' and this node connects from "Parse Eval Letter".');
  }

  // A `primary` that is not a real check id would be asserted against nothing and the summary would
  // print "primary PASS" for a check that does not exist. That is the shape of bug the plan's own
  // record calls out twice: a guard that passes because it tests nothing.
  for (const c of E.CASES) {
    if (CHECK_IDS.indexOf(c.primary) === -1) {
      throw new Error(
        'Case Metrics: case ' + c.id + ' names primary ' + JSON.stringify(c.primary) + ', which is not a check this node runs.\n' +
        '  The checks are: ' + CHECK_IDS.join(', ') + '\n' +
        '  A primary nothing asserts makes the case decorative: it would report a pass on a gate that\n' +
        '  was never pointed at anything.'
      );
    }
  }

  // Every lane a case names has to have approved figures and an identity, or A8 and A4 quietly go
  // vacuous on that lane rather than failing.
  for (const c of E.CASES) {
    if (!Array.isArray(CFG.approved_numbers[c.lane]) || !CFG.approved_numbers[c.lane].length) {
      throw new Error('Case Metrics: node 34 has no approved figures for lane ' + JSON.stringify(c.lane) + ', so the numbers check would allow everything on that case.');
    }
    const id = CFG.identity[c.lane] || {};
    if (!id.name) {
      throw new Error('Case Metrics: node 34 derived no name for lane ' + JSON.stringify(c.lane) + ', so the signature leg would report N/A and the skeleton check would pass a letter with no signature at all.');
    }
  }
}());

// ---------------------------------------------------------------------------------------------
// THE SCORER. Lifted by the offline suite, so it takes every table as an argument.
// ---------------------------------------------------------------------------------------------
const SCORER = `
function evaluateLetter(letter, screen, T) {
  const NL = String.fromCharCode(10);
  const checks = [];
  const advisory = [];

  // flat() and spanIsIn() are node 34's, re-declared because they live inside a closure there and
  // cannot be cut at column zero. Identical semantics, and that is a manual coupling.
  function flat(s) {
    return String(s === undefined || s === null ? '' : s).replace(/\\s+/g, ' ').trim().toLowerCase();
  }
  function spanIsIn(needle, hay) {
    const n = flat(needle).replace(/[.,;:!?]+$/, '');
    if (!n.length) return false;
    return flat(hay).indexOf(n) !== -1;
  }
  function hitsOf(text, source, flags) {
    const re = new RegExp(source, flags.indexOf('g') === -1 ? flags + 'g' : flags);
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push({ what: m[0], at: m.index, quote: text.slice(Math.max(0, m.index - 40), Math.min(text.length, m.index + m[0].length + 40)).replace(/\\s+/g, ' ').trim() });
      if (m[0].length === 0) re.lastIndex += 1;
      if (out.length >= 20) break;
    }
    return out;
  }
  function add(id, ok, detail, hits) {
    checks.push({ id: id, blocking: true, status: ok ? 'PASS' : 'FAIL', detail: detail, hits: hits || [] });
  }
  function note(id, clean, detail, hits) {
    advisory.push({ id: id, blocking: false, status: clean ? 'clean' : 'NOTE', detail: detail, hits: hits || [] });
  }

  const raw = String(letter === undefined || letter === null ? '' : letter);
  const norm = normalise(raw);
  const low = norm.toLowerCase();
  const lines = raw.split(NL).map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 0; });
  const paras = raw.split(/\\n\\s*\\n/).map(function (p) { return p.trim(); }).filter(function (p) { return p.length > 0; });

  // --- A1.letter. On the RAW text: normalisation must not be able to launder a dash. ---
  const dashHits = hitsOf(raw, T.dash.source, T.dash.flags);
  add('dashes', dashHits.length === 0,
    dashHits.length === 0 ? 'no U+2013 and no U+2014 in the letter'
      : dashHits.length + ' dash character(s) in the letter. Shaheen 2026-08-20: NEVER AGAIN, both characters. Nothing repairs one on the way in, deliberately, so this is what the model actually wrote.',
    dashHits);

  // --- A2. Tells, on the normalised text so a curly apostrophe cannot smuggle one past. ---
  const tellHits = [];
  for (let i = 0; i < T.tells.length; i += 1) {
    const t = T.tells[i];
    let from = 0;
    for (;;) {
      const at = low.indexOf(t, from);
      if (at < 0) break;
      tellHits.push({ what: t, at: at, quote: norm.slice(Math.max(0, at - 40), Math.min(norm.length, at + t.length + 40)).replace(/\\s+/g, ' ').trim() });
      from = at + t.length;
    }
  }
  const tellKept = tellHits.filter(function (h) {
    return !tellHits.some(function (o) {
      return o !== h && o.at <= h.at && (o.at + o.what.length) >= (h.at + h.what.length) && o.what.length > h.what.length;
    });
  });
  add('tells', tellKept.length === 0,
    tellKept.length === 0 ? 'none of the ' + T.tells.length + ' reconciled AI tells'
      : tellKept.length + ' AI tell(s): ' + tellKept.map(function (h) { return JSON.stringify(h.what); }).join(', '),
    tellKept);

  // --- A3. The band, counted the way the CLI, the audit and the live Writer Voice Eval count. ---
  const words = wordCount(raw);
  add('words', words >= T.band.min && words <= T.band.max,
    words + ' words against the band [' + T.band.min + ', ' + T.band.max + ']', []);

  // --- A4. The skeleton, one leg per element the approved shape names. ---
  const legs = [];
  function leg(id, status, why) { legs.push({ leg: id, status: status, why: why }); }

  leg('greeting', lines.length && lines[0] === T.greeting ? 'PASS' : 'FAIL',
    'the first line is ' + JSON.stringify(lines.length ? lines[0] : '') + ' and the approved shape opens with exactly ' + JSON.stringify(T.greeting));

  leg('role_line', !T.role_title ? 'N/A' : (flat(raw).indexOf(flat(T.role_title)) !== -1 ? 'PASS' : 'FAIL'),
    !T.role_title ? 'the case seeds no role title' : 'one line names the role applied for');

  const waHit = (T.work_auth_tokens || []).filter(function (t) { return flat(raw).indexOf(flat(t)) !== -1; });
  leg('location_gate', !(T.work_auth_tokens || []).length ? 'N/A' : (waHit.length ? 'PASS' : 'FAIL'),
    'the opener answers the work authorization question using the same word the CV uses (' + JSON.stringify(T.work_auth_tokens || []) + ')');

  leg('city', !T.city ? 'N/A' : (flat(raw).indexOf(flat(T.city)) !== -1 ? 'PASS' : 'FAIL'), 'the opener names where he is');

  leg('employer', !T.employer_org ? 'N/A' : (flat(raw).indexOf(flat(T.employer_org)) !== -1 ? 'PASS' : 'FAIL'), 'beat two names the current employer');

  leg('availability', /availab/i.test(raw) ? 'PASS' : 'FAIL', 'the letter states availability, in the wording the CV uses');

  leg('no_signoff', hitsOf(norm, T.signoff.source, T.signoff.flags).length ? 'FAIL' : 'PASS',
    'the approved shape closes on the name alone, with no sign off phrase above it');

  const lastLine = lines.length ? lines[lines.length - 1] : '';
  leg('signature', !T.name ? 'N/A' : (lastLine === T.name ? 'PASS' : 'FAIL'),
    'the last line is ' + JSON.stringify(lastLine) + ' and the approved shape ends with the name alone');

  leg('paragraphs', paras.length >= T.paragraphs.min && paras.length <= T.paragraphs.max ? 'PASS' : 'FAIL',
    paras.length + ' paragraph(s) against the band [' + T.paragraphs.min + ', ' + T.paragraphs.max + ']');

  const screenLines = (screen && Array.isArray(screen.lines)) ? screen.lines : [];
  const gapLine = screenLines.filter(function (l) { return l && l.kind === 'gap'; })[0] || null;
  leg('honest_gap', !gapLine ? 'FAIL' : (spanIsIn(gapLine.sentence, raw) ? 'PASS' : 'FAIL'),
    !gapLine ? 'the screening note names no gap sentence, so there is no evidence the honest gap was written at all'
      : 'the screening note names the gap sentence and it is a real substring of the letter');

  const legFails = legs.filter(function (l) { return l.status === 'FAIL'; });
  add('skeleton', legFails.length === 0,
    legFails.length === 0 ? 'every assertable element of the approved skeleton is present'
      : legFails.length + ' skeleton element(s) missing or wrong: ' + legFails.map(function (l) { return l.leg; }).join(', '),
    legs);

  // --- A5.letter. ---
  const proHits = hitsOf(norm, T.pronoun.source, T.pronoun.flags);
  add('pronouns', proHits.length === 0,
    proHits.length === 0 ? 'no gendered pronoun in the letter'
      : proHits.length + ' gendered pronoun(s): ' + proHits.map(function (h) { return h.what; }).join(', ') + '. Alex is never he, him, his, she or it, and neither is anybody else in a letter under his name (Shaheen 2026-07-28).',
    proHits);

  // --- A6, A7, A9, A10. One named check each. ---
  for (let i = 0; i < T.claims.length; i += 1) {
    const c = T.claims[i];
    const h = hitsOf(norm, c.source, c.flags);
    add('claim:' + c.id, h.length === 0,
      h.length === 0 ? 'clean' : h.length + ' hit(s): ' + h.map(function (x) { return JSON.stringify(x.what); }).join(', '), h);
  }

  // --- A8. Every figure approved, or inside a span this run proved quotable. ---
  const allow = {};
  for (let i = 0; i < (T.approved || []).length; i += 1) allow[String(T.approved[i])] = 'the approved list';
  for (let i = 0; i < (T.quote_sources || []).length; i += 1) {
    const ns = extractNumbers(T.quote_sources[i]);
    for (let k = 0; k < ns.length; k += 1) if (!allow[ns[k]]) allow[ns[k]] = 'the employer own words';
  }
  const numHits = [];
  const seen = extractNumbers(raw);
  for (let i = 0; i < seen.length; i += 1) {
    if (!allow[seen[i]]) numHits.push({ what: seen[i], at: -1, quote: seen[i] });
  }
  add('numbers', numHits.length === 0,
    numHits.length === 0 ? 'every one of the ' + seen.length + ' figure(s) in the letter is on the approved list or inside a proved quotable span'
      : numHits.length + ' figure(s) that are on neither: ' + numHits.map(function (h) { return h.what; }).join(', '), numHits);

  // --- ADVISORY. Reported, never blocking, never in the verdict. ---
  const screenRaw = (screen && screen.raw) ? String(screen.raw) : '';
  const screenDash = hitsOf(screenRaw, T.dash.source, T.dash.flags);
  note('screen_dashes', screenDash.length === 0,
    screenDash.length === 0 ? 'no dash in the screening note either'
      : screenDash.length + ' dash character(s) in the SCREENING NOTE. The system block says nowhere in the answer; the runtime audit checks the letter only, so this is reported and does not fail the case.',
    screenDash);

  const objLines = screenLines.filter(function (l) { return l && l.kind === 'objection'; });
  const objBad = objLines.filter(function (l) { return !spanIsIn(l.sentence, raw); });
  note('screen_objection_verbatim', objBad.length === 0,
    !objLines.length ? 'the screening note names no objection sentences'
      : (objBad.length === 0 ? 'all ' + objLines.length + ' objection sentence(s) are real substrings of the letter'
        : objBad.length + ' of ' + objLines.length + ' objection sentence(s) were paraphrased rather than copied. The runtime enforces this for the gap line only, so it is reported here.'),
    objBad);

  const failed = checks.filter(function (c) { return c.status === 'FAIL'; }).map(function (c) { return c.id; });
  return { checks: checks, advisory: advisory, words: words, paragraphs: paras.length, pass: failed.length === 0, failed: failed };
}
`;

const LOGIC = `
${E.liftedHelpers()}
${SCORER}

const rows = $input.all().map((i) => i.json);
if (!rows.length) {
  throw new Error('Case Metrics: Parse Eval Letter delivered nothing. It emits one row per sent case on every path, so an empty input means it did not run.');
}

const out = [];
for (const row of rows) {
  const c = row.case || {};
  const lane = row.master_key;
  const ident = IDENTITY[lane] || {};
  const seeded = SEEDED[c.id] || {};

  const base = {
    _kind: 'eval_result',
    n: c.n || null,
    case_id: c.id || null,
    lane: lane,
    primary: c.primary || null,
    seeds: c.seeds || null,
    pass_means: c.pass || null,
    outcome: row.outcome,
    http_status: row.http_status,
    stop_reason: row.stop_reason,
    usage: row.usage,
    words: null,
    paragraphs: null,
    pass: false,
    primary_status: 'NOT RUN',
    failed: [],
    fail_detail: [],
    advisory: [],
    why: row.why || null,
  };

  if (row.outcome !== 'letter') {
    // A call that never produced a letter measured nothing about the prompt. It is NOT a pass and
    // it is NOT the same as a letter that failed a check, and the summary keeps them apart.
    base.failed = ['no_letter'];
    base.fail_detail = [{ id: 'no_letter', detail: row.why || row.outcome }];
    out.push({ json: base, pairedItem: { item: 0 } });
    continue;
  }

  const T = {
    tells: TELLS,
    dash: { source: DASH_RE.source, flags: DASH_RE.flags },
    pronoun: { source: PRONOUN_RE.source, flags: PRONOUN_RE.flags },
    claims: CLAIMS.map((x) => ({ id: x.id, source: x.re.source, flags: x.re.flags })),
    band: BAND,
    greeting: GREETING,
    signoff: SIGNOFF,
    paragraphs: PARAGRAPH_BAND,
    name: ident.name || null,
    city: ident.city || null,
    work_auth_tokens: ident.work_auth_tokens || [],
    employer_org: (ident.employer && ident.employer.org) || null,
    role_title: seeded.role_title || null,
    approved: Array.isArray(row.approved_numbers) && row.approved_numbers.length ? row.approved_numbers : (APPROVED[lane] || []),
    quote_sources: [row.quote_line, row.hook_quote].filter((s) => s),
  };

  const r = evaluateLetter(row.letter_text, row.screen, T);
  base.words = r.words;
  base.paragraphs = r.paragraphs;
  base.pass = r.pass;
  base.failed = r.failed;
  base.fail_detail = r.checks.filter((x) => x.status === 'FAIL').map((x) => ({ id: x.id, detail: x.detail, hits: x.hits.slice(0, 6) }));
  base.advisory = r.advisory.filter((x) => x.status === 'NOTE').map((x) => ({ id: x.id, detail: x.detail }));
  const prim = r.checks.filter((x) => x.id === c.primary)[0];
  base.primary_status = prim ? prim.status : 'NOT RUN';
  base.letter_text = row.letter_text;
  base.voice_block_present = row.voice_block_present;
  out.push({ json: base, pairedItem: { item: 0 } });
}

return out;
`;

const SEEDED = {};
for (const c of E.CASES) SEEDED[c.id] = { role_title: c.brief.role_title };

const jsCode = [
  '// GENERATED at build time from work/36-job-application-writer/nodes-eval/07-case-metrics.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  '//',
  '// The voice tables below are rendered by scripts/lib/voice-rules.js, the SAME renderer the',
  '// runtime audit node bakes from. normalise(), wordCount() and extractNumbers() are lifted',
  '// verbatim out of the generated code of nodes/34-audit-pair.js. evaluateLetter() is declared at',
  '// column zero so config/test-letter-eval.js can lift it and run these exact bytes offline.',
  E.rulesSource(),
  'const GREETING = ' + JSON.stringify(CFG.greeting) + ';',
  'const SIGNOFF = ' + JSON.stringify({ source: CFG.signoff.source, flags: CFG.signoff.flags }) + ';',
  'const PARAGRAPH_BAND = ' + JSON.stringify(CFG.paragraphs) + ';',
  'const IDENTITY = ' + JSON.stringify(CFG.identity) + ';',
  'const APPROVED = ' + JSON.stringify(CFG.approved_numbers) + ';',
  'const SEEDED = ' + JSON.stringify(SEEDED) + ';',
  LOGIC,
].join('\n');

module.exports = {
  name: 'Case Metrics',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1560, 0],
  connectFrom: 'Parse Eval Letter',
  notes: 'Thirteen blocking checks per case, each carrying the runtime audit id it mirrors (A1 to A10), plus two advisory notes that are deliberately not blocking. Tables rendered from scripts/lib/voice-rules.js, identity and approved figures lifted from node 34, helpers lifted from node 34, and evaluateLetter() declared at column zero so the offline suite runs these bytes with no network.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

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
 *   numbers     (A8)           every figure on the approved list, or inside employer text this case
 *                              holds: the verified span, the research hook, the employer page and the
 *                              posting. That source list is node 34's own function, lifted.
 *
 * The tables are not retyped. scripts/lib/voice-rules.js renders them and this node bakes the
 * render, exactly as the audit node does, so there is ONE definition of a tell, a pronoun, a dash
 * and a banned claim in this repo and the eval cannot be enforcing last month's list. The identity
 * values (his name, his city, the greeting, the sign off pattern, the per lane approved figures)
 * are lifted out of node 34's baked AUDIT_CFG, which derived them from the masters, for the same
 * reason and with more force: one of them is his name.
 *
 * normalise(), wordCount(), extractNumbers(), sentenceBounds(), negatedAround(), numberSources()
 * and numberAllowlist() are lifted verbatim out of node 34's generated code. A word count or a number
 * tokeniser that differs by one rule between the eval and the audit produces an eval that passes a
 * letter the lane would reject, which is the exact failure a regression harness exists to prevent.
 * The last two joined the list on 2026-09-16 as divergence D2: see section 1c.
 *
 * =============================================================================================
 * 1b. WHY THE CLAIM CHECKS ARE LIFTED AND NOT MIRRORED (2026-09-16).
 * =============================================================================================
 * This loop used to be a bare substring scan written here against voice-rules.js. On 2026-09-16 node
 * 34 learned that a DENIAL is not a claim for the three deniable ones, bounded to the letter and to a
 * negator that governs the hit. This node knew nothing about it, so letter eval execution 5428 failed
 * C2 on the letter's honest gap sentence, which is a sentence the writer prompt ORDERS.
 *
 * The lesson is not "port the fix". It is that the eval was answering a different question from the
 * lane and nothing said so. The pin guarantees the eval runs the same PROMPT as the box; nothing
 * guaranteed it applied the same CHECKS, and that gap produces a false GREEN exactly as easily as it
 * produced that false red. So negatedAround() is LIFTED and claim_denial and negation_words come out
 * of node 34's baked AUDIT_CFG, and config/test-audit-denial.js runs the SAME letters through both
 * paths and asserts the same verdict, so the next divergence fails a test instead of confusing a run.
 *
 * =============================================================================================
 * 1c. DIVERGENCE D2, THE SAME SHAPE, FOUND THE SAME DAY (2026-09-16).
 * =============================================================================================
 * The numbers check had its own allowlist: the approved list plus two quotable spans. Node 34's A8
 * allowed a figure out of FOUR places, because the employer's own posting and the employer's own
 * fetched page are employer own words too, and the skeleton REQUIRES beat three to quote them. So a
 * figure the lane deliberately permits made this eval red, and the identical gap makes it GREEN the
 * moment the two lists differ the other way.
 *
 * The fix is the same one as 1b and it is the same lesson: the list is DATA in node 34 now
 * (numberSources), it is LIFTED here, and the sources themselves arrive from Parse Eval Letter built
 * by that same function off the seeded pair. Seeding them is the other half: the eval cases now carry
 * ad_text and site_text assembled from their own employer material, and _eval.js refuses to build if
 * a case leaves a source node 34 reads empty, because an unfed source is a shorter allowlist wearing
 * a clean bill of health.
 *
 * THE ONE THING THAT IS STILL NOT LIFTED, said plainly rather than left to be found: flat() and
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
 * AND HERE IS WHAT A SCORE BELOW 6/6 ACTUALLY MEANS, because it is easy to read it as worse news
 * than it is. This harness has eight nodes and NO rewrite branch: it scores the FIRST draft. The
 * lane gives a letter-only failure ONE reasoned rewrite before it holds anything. So 4/6 here does
 * not say the lane would have held two pairs; it says the lane would have paid for two rewrites and
 * held whatever still failed afterwards. That is deliberate and it is the right thing to measure,
 * because the question this harness answers is "is the PROMPT still good", and a first pass that
 * needs a rewrite is a prompt getting worse even when the rewrite saves the letter.
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
 *                             character. **CORRECTED 2026-09-16: the reason this file used to give
 *                             was FALSE.** It said "the runtime enforces that for the GAP line only",
 *                             and it does not: node 34's A18 is letter scope, blocking, and it
 *                             checks every objection sentence verbatim. A wrong reason is worse than
 *                             no reason, because it is the sentence that stops the next person
 *                             looking. The honest reason is that the eval scores the PROMPT rather
 *                             than gating a shipment, and the six cases seed objections whose
 *                             answers are the model's to write, so a blocking verbatim check here
 *                             would go red on a defensible letter. It stays a NOTE, and the
 *                             difference from the runtime is now stated in the parity map of
 *                             config/test-letter-eval.js instead of being explained away.
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

  // THE NUMBER SOURCES ARRIVE FROM UPSTREAM, BUILT BY NODE 34'S OWN FUNCTION. If node 06 stops
  // emitting them, `T.number_sources` is an empty array, the allowlist shrinks to the approved list
  // alone, and this eval fails every letter that quotes a figure back at the employer. That is a
  // RED, so it would be noticed, but it would be noticed as six broken cases rather than as one
  // broken row shape, which is a day of looking at the wrong thing.
  const pc = String((parse.parameters || {}).jsCode || '');
  if (pc.indexOf('number_sources: numberSources(sent[i]),') === -1 || pc.indexOf('function numberSources(') === -1) {
    throw new Error(
      'Case Metrics: Parse Eval Letter no longer builds number_sources with the LIFTED numberSources().\n' +
      '  That list is every piece of employer text the LANE allows a figure to come from. Built by hand\n' +
      '  here or upstream, it goes stale the day node 34 gains a source, and a shorter allowlist means\n' +
      '  this eval fails letters the box accepts. That is divergence D2 and it already happened once.'
    );
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

  // THE DENIAL MAP HAS TO ANSWER FOR EVERY CLAIM, and it is node 34's map rather than one of ours.
  // The SAME guard node 34 carries, in the same shape and for the same reason: a claim that defaults
  // into deniable lets an honest-looking sentence carry a claim the rule bans outright, and a claim
  // that defaults into not-deniable fails the honest gap the writer prompt orders. Both are silent
  // and they fail in opposite directions, so neither is allowed to happen by omission.
  //
  // Written as a hasOwnProperty test rather than a truthiness test on purpose: `false` is a real
  // answer here and `!CFG.claim_denial[c.id]` would read it as a missing one.
  if (!CFG.claim_denial || typeof CFG.claim_denial !== 'object') {
    throw new Error(
      'Case Metrics: node 34 bakes no claim_denial map into AUDIT_CFG.\n' +
      '  That map is what tells this eval which banned claims a DENIAL is allowed to satisfy. Without\n' +
      '  it the eval falls back to a bare substring scan and fails the honest gap sentence the writer\n' +
      '  prompt ORDERS, which is exactly what letter eval execution 5428 did.'
    );
  }
  if (!Array.isArray(CFG.negation_words) || !CFG.negation_words.length) {
    throw new Error(
      'Case Metrics: node 34 bakes no negation_words list into AUDIT_CFG.\n' +
      '  negatedAround() takes it as an argument, so an empty list means NOTHING reads as a denial and\n' +
      '  every honest gap sentence fails again, silently and in the safe looking direction.'
    );
  }
  for (const c of VR.CLAIMS) {
    if (!Object.prototype.hasOwnProperty.call(CFG.claim_denial, c.id) || typeof CFG.claim_denial[c.id] !== 'boolean') {
      throw new Error(
        'Case Metrics: voice-rules.js declares a banned claim ' + JSON.stringify(c.id) + ' and node 34 does not say\n' +
        '  whether a DENIAL of it is still a violation. Answer it in AUDIT_CFG.claim_denial in node 34,\n' +
        '  which is the one place that map lives. There is deliberately no default here either.'
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

  // On the RAW text, because node 34's leg tests the signoff pattern against the raw letter and this
  // leg exists to say what THAT leg would say. Corrected 2026-09-16: it used to run on the
  // normalised text, and normalise() turns a non breaking space into an ordinary one, so a letter
  // closing "Best<NBSP>regards" passed the lane and failed the eval. A one character red that is not
  // a defect is the kind that teaches people to scroll past the suite.
  //
  // Worth saying which way this was resolved and why: the eval was made to match the LANE rather
  // than the lane made to match the eval, because the eval's whole job is to answer "would the lane
  // accept this letter". If the raw test is the weaker of the two, and it probably is, the fix
  // belongs in node 34's leg and this one follows it.
  leg('no_signoff', hitsOf(raw, T.signoff.source, T.signoff.flags).length ? 'FAIL' : 'PASS',
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

  // --- A6, A7, A9, A10. One named check each, with node 34's OWN denial rule, not a second copy.
  //
  // negatedAround() is LIFTED out of node 34's generated code and T.claim_denial is lifted out of its
  // baked AUDIT_CFG, so a claim that is deniable here is deniable there BY CONSTRUCTION. Before
  // 2026-09-16 this loop was a bare substring scan, node 34 had learned that a denial is not a claim,
  // and eval execution 5428 failed C2 on the honest gap sentence the writer prompt ORDERS.
  //
  // beforeOnly TRUE, the same argument node 34's claim branch passes. "TypeScript is no problem for
  // me, I have used it" reads as a denial on a whole-sentence test and it is a CLAIM; the negator has
  // to govern the hit, which in English means it comes first. A12's caller passes false for the
  // opposite reason and that difference is the whole of what separates them.
  //
  // A claim with no claim_denial answer is refused at build time below rather than defaulting, for
  // the reason node 34 gives: both defaults fail silently and in opposite directions.
  const deniedClaims = [];
  for (let i = 0; i < T.claims.length; i += 1) {
    const c = T.claims[i];
    const all = hitsOf(norm, c.source, c.flags);
    const deniable = T.claim_denial[c.id] === true;
    const bad = [];
    const denied = [];
    for (let k = 0; k < all.length; k += 1) {
      if (deniable && negatedAround(norm, all[k].at, true, T.negation_words)) denied.push(all[k]);
      else bad.push(all[k]);
    }
    for (let k = 0; k < denied.length; k += 1) deniedClaims.push({ claim: c.id, what: denied[k].what, quote: denied[k].quote });
    // The denied hits ride on the PASS and stay visible, exactly as they do in node 34: a check that
    // silently forgives is only one step better than one that wrongly blocks.
    const deniedNote = denied.length
      ? ' (' + denied.length + ' mention(s) allowed as an explicit denial, which the writer prompt ORDERS when it asks for an honest gap)'
      : '';
    add('claim:' + c.id, bad.length === 0,
      bad.length === 0 ? 'clean' + deniedNote
        : bad.length + ' hit(s): ' + bad.map(function (x) { return JSON.stringify(x.what); }).join(', ') +
          (deniable ? '. Not one of them sits behind a negation, so each reads as a CLAIM rather than as the honest gap.' : '. This claim is never deniable: the rule forbids MENTIONING the thing, and a denial still mentions it.'),
      bad.concat(denied.map(function (x) { return { what: x.what, at: x.at, quote: x.quote, denied: true }; })));
  }

  // --- A8. Every figure approved, or inside employer text the LANE allows a figure from.
  //
  // numberAllowlist() and the T.number_sources list it reads are node 34's OWN bytes, lifted. This
  // used to build its own allowlist out of the approved list plus two quotable spans, while the lane
  // allowed four sources, and that shortfall is divergence D2: a figure the box deliberately permits
  // came back red here. The labels travel with it, so the detail line SAYS where each figure was
  // allowed from rather than only that it was. ---
  const allow = numberAllowlist(T.approved || [], T.number_sources || []);
  const numHits = [];
  const usedFrom = {};
  const seen = extractNumbers(raw);
  for (let i = 0; i < seen.length; i += 1) {
    if (!allow[seen[i]]) numHits.push({ what: seen[i], at: -1, quote: seen[i] });
    else usedFrom[allow[seen[i]]] = (usedFrom[allow[seen[i]]] || 0) + 1;
  }
  const provenance = Object.keys(usedFrom).map(function (k) { return usedFrom[k] + ' from ' + k; });
  const srcFields = (T.number_sources || []).map(function (s) { return s.field; });
  add('numbers', numHits.length === 0,
    numHits.length === 0
      ? 'every one of the ' + seen.length + ' figure(s) in the letter is traceable (' + (provenance.length ? provenance.join(', ') : 'the letter carries no figure at all') + '), against ' + (T.approved || []).length + ' approved and ' + (srcFields.length ? srcFields.length + ' source(s) of employer text (' + srcFields.join(', ') + ')' : 'NO employer text at all on this case')
      : numHits.length + ' figure(s) on neither his approved list nor any employer text this case holds (' + (srcFields.length ? srcFields.join(', ') : 'no employer text seeded') + '): ' + numHits.map(function (h) { return h.what; }).join(', '), numHits);

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
  return {
    checks: checks,
    advisory: advisory,
    words: words,
    paragraphs: paras.length,
    pass: failed.length === 0,
    failed: failed,
    // The banned technologies the letter NAMED and then denied. Same field, same meaning and same
    // reason as node 34's letter_audit.denied_claims: not a failure, not a warning, just countable.
    denied_claims: deniedClaims.slice(0, 12),
  };
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
    // Both lifted out of node 34's baked AUDIT_CFG at build time, never restated. claim_denial says
    // which claims a denial is allowed to satisfy; negation_words is the list negatedAround() reads,
    // and it is passed in rather than closed over so the lifted bytes work wherever they land.
    claim_denial: CLAIM_DENIAL,
    negation_words: NEGATION_WORDS,
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
    // Built by node 34's numberSources() in Parse Eval Letter, off the seeded pair, and passed
    // through untouched. Never assembled here: the whole point of D2 is that this node must not hold
    // its own idea of which text licenses a figure.
    number_sources: Array.isArray(row.number_sources) ? row.number_sources : [],
  };

  const r = evaluateLetter(row.letter_text, row.screen, T);
  base.words = r.words;
  base.paragraphs = r.paragraphs;
  base.pass = r.pass;
  base.failed = r.failed;
  base.fail_detail = r.checks.filter((x) => x.status === 'FAIL').map((x) => ({ id: x.id, detail: x.detail, hits: x.hits.slice(0, 6) }));
  base.advisory = r.advisory.filter((x) => x.status === 'NOTE').map((x) => ({ id: x.id, detail: x.detail }));
  // Mentions of a banned technology the letter DENIED. Allowed, not failures, and carried so a
  // reader can disagree with any of them. Same field name the runtime audit uses on its pair.
  base.denied_claims = r.denied_claims || [];
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
  'const CLAIM_DENIAL = ' + JSON.stringify(CFG.claim_denial) + ';',
  'const NEGATION_WORDS = ' + JSON.stringify(CFG.negation_words) + ';',
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
  notes: 'Thirteen blocking checks per case, each carrying the runtime audit id it mirrors (A1 to A10), plus two advisory notes that are deliberately not blocking. Tables rendered from scripts/lib/voice-rules.js, identity and approved figures lifted from node 34, seven helpers lifted from node 34 including the A8 number source list and allowlist, and evaluateLetter() declared at column zero so the offline suite runs these bytes with no network.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

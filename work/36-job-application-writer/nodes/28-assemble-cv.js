'use strict';
/*
 * 28-assemble-cv.js - "Assemble CV". Turns a list of ids into his own sentences, or refuses.
 *
 * =============================================================================================
 * 1. THE ONE SENTENCE THIS NODE EXISTS FOR.
 * =============================================================================================
 * The selector emitted IDS. This node emits MASTER STRINGS. There is no code path between them by
 * which a rewritten sentence can reach the CV, because the only thing this node ever prints is
 * `table.byId[id].raw`, a string that came out of a document Shaheen wrote and froze.
 *
 * A model that hallucinates a better bullet produces an id that does not resolve, and an id that
 * does not resolve is a refusal, not a paragraph. That is the freeze enforced by construction rather
 * than by memory, and it is why decision D8's rejected proof arrives free.
 *
 * The ONE exception, and it is deliberate, bounded and visible: a single bridging line beginning
 * "Ready to ", allowed by the approved plan and by writer-notes-ai.md. See note 5. It is carried in
 * its own field, it has no id, it is emitted from a different code path, and it is DROPPED rather
 * than shipped if it fails any of its checks.
 *
 * =============================================================================================
 * 2. EVERY ID IS VALIDATED, AND A STALE ID IS TOLD APART FROM AN INVENTED ONE.
 * =============================================================================================
 * An id looks like `exp.r1.b04@a1f9c2d0`: a position, then the first eight hex of the sha256 of that
 * block's text. The hash is the whole point. If the master is ever amended, every affected id
 * CHANGES, so anything pinning an old one fails loudly instead of silently shipping a sentence he
 * corrected three weeks ago.
 *
 * So an unresolved id is reported in one of two ways, and they mean different things:
 *   THE POSITION EXISTS WITH A DIFFERENT HASH. That is the AMENDMENT SIGNAL. The master text changed
 *     under a pinned id. Re-read the master and rebuild; never patch the id.
 *   THE POSITION DOES NOT EXIST EITHER. That is an invented id: the model wrote something that looks
 *     like an id rather than copying one.
 * Both hold the pair. Neither is repaired by guessing.
 *
 * A block the selector was never allowed to choose is also refused: a section heading, a horizontal
 * rule, a role's date line, or the Power BI master's photo directive, which is a build instruction
 * living in a bullet and would otherwise print a local file path on a CV. The rubric says all of
 * that plainly, so an id naming one is the same signal as an invented id: a list the model did not
 * follow.
 *
 * =============================================================================================
 * 3. THE MANDATORY SET IS FORCED, AND THEN CHECKED, WHICH IS NOT THE SAME THING.
 * =============================================================================================
 * His name, the contact blocks, the work-authorization line and the whole header section go on every
 * CV whether the selector asked for them or not. Forcing them is what makes A11 and R4 meaningful:
 * a check that asserts the content of a line the assembler was free to drop is a check that passes
 * by accident.
 *
 * Forcing and then ASSERTING the forced blocks actually came out the other end is the A14 check, and
 * it is not redundant. The emit walk skips a section that selected nothing and skips a group that
 * selected nothing, and a bug in either would silently drop a mandatory block while every other
 * count stayed right. The assertion is cheap and the failure is a CV with no phone number on it.
 *
 * =============================================================================================
 * 4. ONE PAGE IS A HARD REFUSE (D13), AND THE DROP ORDER IS HOW THE SELECTOR KEEPS CONTROL.
 * =============================================================================================
 * D13, his choice: one page, refuse to ship otherwise. The measured ceiling is 3,760 characters of
 * paragraph text, from the BJAK build. If the selection cannot be tightened to fit, the pair does
 * NOT ship; it leaves a row for Shaheen.
 *
 * Design defect 3 from the plan review is why there is no "tighten and retry" loop: a second paid
 * call to answer a question the selector can answer in the first one. So the selector returns
 * `drop_order`, the ids it is willing to lose, least valuable first, and this node drops them one at
 * a time IN THAT ORDER, re-measuring after each, until the page fits.
 *
 * Three things about that loop are deliberate:
 *   A MANDATORY ID ON drop_order IS SKIPPED, NOT OBEYED, and it is recorded. The mandatory set is
 *     forced, so obeying would be impossible anyway; recording it is what makes a selector that
 *     keeps trying to drop his phone number visible rather than merely ineffective.
 *   AN ID ON drop_order THAT WAS NEVER SELECTED is skipped and recorded. Harmless, and a sign the
 *     model built the two lists separately.
 *   DROPPING THE LAST BLOCK OF A ROLE ALSO REMOVES ITS DATE LINE AND ITS HEADING, because the emit
 *     walk skips an empty group. That is more recovery than the id's own character count suggests,
 *     which is why the loop re-measures rather than subtracting.
 *
 * When drop_order runs out and the page is still too full, the bridge line goes, because it is the
 * one line on the page that is not his writing and the choice is between shipping without it and not
 * shipping at all. If it is still over after that, the pair is held. That is D13 working, not
 * failing.
 *
 * =============================================================================================
 * 5. THE BRIDGE LINE, AND EVERY RAIL ON IT.
 * =============================================================================================
 * The approved plan allows the selector to "add one 'ready to' line", and writer-notes-ai.md is
 * where it comes from: "If a job ad needs something the master does not say, bridge it honestly as
 * 'ready to' rather than claiming it, and keep the bridge in his register."
 *
 * It is the only model-authored prose that may reach a CV in this design, so it is worth naming the
 * hole rather than being quiet about it. What keeps it closed enough to ship:
 *
 *   STRUCTURALLY DISTINCT. It has no block id. It lives in its own field from the model answer to
 *     the README. It is emitted by a different branch of the same walk, tagged `source: 'bridge'`,
 *     so nothing anywhere can mistake it for one of his sentences or turn it into a block.
 *   IT MUST OPEN WITH THE EXACT WORDS "Ready to ". Nothing else on either master opens that way, so
 *     a human reading the page can see which sentence is the bridge.
 *   NO DIGITS, AT ALL. Every number on a CV is a claim, and this is the one line that did not come
 *     from a document he approved. A8 checks the letter's numbers against an approved list; this
 *     removes the question from the CV entirely.
 *   ONE SENTENCE, 160 characters, ending in a full stop.
 *   NO DASHES, NO PRONOUNS, NO BANNED CLAIMS, NO AI TELLS. Checked with scripts/lib/voice-rules.js,
 *     the SAME engine the letter audit and the prose scanner use, baked from its own renderer so
 *     there is one definition of every one of those rules in the repo.
 *   A FAILURE DROPS THE LINE, NEVER THE CV. A malformed bridge costs one sentence and is recorded
 *     with the reason. Holding a good CV over an optional line would be the wrong trade.
 *   IT IS VISIBLE. `cv_selection.bridge_line` and `bridge_state` travel with the pair so the render
 *     seat's README names it, which is what a person needs to decide whether they agree with it.
 *
 * =============================================================================================
 * 6. WHY THE ASSEMBLY RULES EXIST TWICE, AND HOW THAT IS KEPT HONEST.
 * =============================================================================================
 * `_master.js assemble()` implements these ordering rules at BUILD time and is used by seat 2's
 * fixtures. This node implements them at RUN time, because the n8n box cannot require a file in this
 * repo. Two implementations of one rule is exactly the drift this whole project keeps refusing
 * elsewhere, so it is not left as a comment: `config/test-stage-2.js` asserts that for a given
 * selection both produce BYTE IDENTICAL text, on both lanes.
 *
 * There is one deliberate divergence and it is stated rather than discovered. `_master.assemble()`
 * THROWS on a `section_order` naming an unknown section. This node RECORDS it and falls back to
 * document order, because section order is a presentation preference and refusing a whole CV over
 * one unknown key would be disproportionate. Every other refusal matches.
 */

const LN = require('./_lane');
const S2 = require('./_stage2');
const MASTER = require('./_master');
const VR = require(require('path').join(S2.REPO, 'scripts', 'lib', 'voice-rules.js'));

const NODE_NAME = 'Assemble CV';
const N14 = './14-parse-job-brief.js';

const MODEL = LN.STAGE_MODELS.select;
const PRICE = LN.prices(MODEL);
const MASTER_KEYS = S2.masterKeys();
const PARA_CHARS_MAX = S2.PARA_CHAR_CEILING;

// The bridge line contract. Declared here, in the node that ENFORCES it, and asserted below against
// the bytes Build Select Request bakes into the rubric: a selector told one form of words and judged
// by another would have every bridge line silently dropped.
const BRIDGE_PREFIX = 'Ready to ';
const BRIDGE_MAX_CHARS = 160;

// The closed schema the selector answers in.
const SCHEMA_KEYS = ['cv_block_ids', 'section_order', 'drop_order', 'objection_coverage', 'bridge_line', 'why'];
const REQUIRED_KEYS = ['cv_block_ids'];

const SYSTEMIC_KINDS = ['auth', 'credits', 'rate_limit', 'upstream', 'transport', 'not_found', 'too_large', 'pairing', 'node_did_not_run', 'bad_request'];

const WHY_MAX = 400;
const OBJECTION_NOTE_MAX = 240;
const COVERAGE_MAX = 6;

const BLOCKS = {};
for (const key of MASTER_KEYS) BLOCKS[key] = S2.assemblerTable(key);

const LIFTED = [
  S2.bakedFunction(N14, 'stripDashes', 'EM_DASH'),
  S2.bakedFunction(N14, 'clean', 'formulaPrefixesStripped'),
  S2.bakedFunction(N14, 'extractJson', 'no JSON object could be parsed'),
  S2.bakedFunction(N14, 'costOf', 'cache_creation_input_tokens'),
  S2.bakedFunction(N14, 'classify', 'invalid_request_error'),
].join('\n');

(function assertAgainstUpstream() {
  const merge = require('./27-select-results.js');
  const route = require('./25-select-route.js');
  const call = require('./26-select-cv-blocks.js');
  const build = require('./24-build-select-request.js');
  if (merge.name !== 'Select Results') throw new Error('Assemble CV: node 27 is named ' + JSON.stringify(merge.name) + ' and this node connects from "Select Results".');
  if (route.name !== 'Select Route') throw new Error('Assemble CV: node 25 is named ' + JSON.stringify(route.name) + ' and this node reads $(\'Select Route\') output 0 for the authoritative sent order.');
  if (call.name !== 'Select CV Blocks') throw new Error('Assemble CV: node 26 is named ' + JSON.stringify(call.name) + ' and this node reads $(\'Select CV Blocks\') for the responses.');
  if (build.name !== 'Build Select Request') throw new Error('Assemble CV: node 24 is named ' + JSON.stringify(build.name) + ' and this node reads $(\'Build Select Request\') for the independent count of what should have been called.');

  const resp = call.parameters.options && call.parameters.options.response && call.parameters.options.response.response;
  if (!resp || resp.fullResponse !== true || resp.neverError !== true) {
    throw new Error(
      'Assemble CV: Select CV Blocks no longer sets fullResponse AND neverError. This node reads\n' +
      '  statusCode off the item to tell a credit error, an auth error and a rate limit apart, and on this\n' +
      '  stage that is the difference between leaving a sheet row at new and burning the day cap on\n' +
      '  nothing.'
    );
  }
  if (merge.parameters.numberInputs !== 2) {
    throw new Error('Assemble CV: Select Results declares numberInputs ' + JSON.stringify(merge.parameters.numberInputs) + '. This node expects the two-input join.');
  }

  // PRE-FLIGHT. This node bakes the PRINT view of both masters into a workflow, so a stale mirror
  // here ships text he has already replaced. Fail-closed, python absent included, with one loud
  // deliberate override (ALEX_ALLOW_NO_PYTHON=1) following the gitleaks precedent.
  MASTER.preflight(MASTER_KEYS);

  if (!MASTER_KEYS.length) throw new Error('Assemble CV: no master lane keys resolved from the lane file, so there is nothing to assemble from.');

  for (const key of MASTER_KEYS) {
    const t = BLOCKS[key];
    if (!t.mandatory_ids.length) {
      throw new Error(
        'Assemble CV: the ' + key + ' master has NO mandatory blocks.\n' +
        '  The mandatory set is his name, his contact line and the work authorization line, and A11 and R4\n' +
        '  both assert content that only exists because those are forced. A master with none would ship a\n' +
        '  CV a recruiter cannot answer, and every check downstream would still pass.'
      );
    }
    if (!t.selectable_ids.length) {
      throw new Error('Assemble CV: the ' + key + ' master has no selectable blocks, so there is nothing for the selector to choose and every CV on that lane would be the header alone.');
    }
    // The ceiling has to be REACHABLE. If the forced set alone is over it, every single pair on that
    // lane would be held for review and the reason would look like a selection problem when it is a
    // master problem.
    const forcedOnly = MASTER.assemble(key, { ids: [] });
    if (forcedOnly.para_chars > PARA_CHARS_MAX) {
      throw new Error(
        'Assemble CV: the ' + key + ' mandatory set alone is ' + forcedOnly.para_chars + ' characters against a ceiling of ' + PARA_CHARS_MAX + '.\n' +
        '  Every pair on that lane would be held after every drop, and the hold would read as a selection\n' +
        '  failure when it is the master that no longer fits one page.'
      );
    }
    // The id format the amendment-signal branch depends on. If ids stopped carrying a hash, a stale
    // id would resolve by position and the CV would quote a sentence he corrected.
    for (const id of t.selectable_ids.slice(0, 5)) {
      if (!/@[0-9a-f]{8}$/.test(id)) {
        throw new Error('Assemble CV: block id ' + JSON.stringify(id) + ' does not end in a content hash. The hash is what makes an amendment fail loudly instead of shipping stale text.');
      }
    }
  }

  // The voice engine. Baked from its own renderer so there is exactly one definition of a dash, a
  // pronoun, an AI tell and a banned claim in this repo.
  const runtimeRules = VR.renderRuntimeSource();
  if (typeof runtimeRules !== 'string' || runtimeRules.indexOf('VOICE_RULES_SHA') === -1) {
    throw new Error('Assemble CV: scripts/lib/voice-rules.js renderRuntimeSource() no longer produces a bakeable source carrying VOICE_RULES_SHA. The bridge line check is the only prose check in this stage and it must use the same engine as the letter audit.');
  }
  for (const name of ['TELLS', 'PRONOUN_RE', 'DASH_RE', 'CLAIMS']) {
    if (runtimeRules.indexOf('const ' + name) === -1) {
      throw new Error('Assemble CV: the baked voice rules no longer declare ' + name + ', which the bridge line check uses by name.');
    }
  }
  if (!BRIDGE_PREFIX.length || BRIDGE_PREFIX.trim() !== 'Ready to') {
    throw new Error('Assemble CV: the bridge prefix is ' + JSON.stringify(BRIDGE_PREFIX) + '. writer-notes-ai.md names it: bridge a gap honestly as "ready to". The exact words are what makes the one non-master line on the page visible as such.');
  }
  // The rubric and the enforcement have to agree about the prefix and the cap, or the selector is
  // told one thing and judged by another.
  const bc = String(build.parameters.jsCode || '');
  if (bc.indexOf('const BRIDGE_PREFIX = ' + JSON.stringify(BRIDGE_PREFIX)) === -1) {
    throw new Error('Assemble CV: Build Select Request bakes a different bridge prefix from the one enforced here. The selector would be told one form of words and judged by another, and every bridge line would be silently dropped.');
  }
  if (bc.indexOf('const BRIDGE_MAX_CHARS = ' + JSON.stringify(BRIDGE_MAX_CHARS)) === -1) {
    throw new Error('Assemble CV: Build Select Request bakes a different bridge length cap from the one enforced here.');
  }

  if (NODE_NAME === 'Build Writer Request') {
    throw new Error('Assemble CV: this node must not be named "Build Writer Request". That name is the voice-sync enrolment key and belongs to the letter writer alone.');
  }
  for (const k of REQUIRED_KEYS) {
    if (SCHEMA_KEYS.indexOf(k) === -1) throw new Error('Assemble CV: ' + k + ' is required and is not in the closed schema, so it could never arrive.');
  }
}());

const VOICE_RUNTIME = VR.renderRuntimeSource();

const LOGIC = `
// ---------------------------------------------------------------------------
// Assemble CV. Validate ids, force the mandatory set, drop to fit, emit his own strings.
// ---------------------------------------------------------------------------
const NL = String.fromCharCode(10);
const EM_DASH = String.fromCharCode(8212);
const EN_DASH = String.fromCharCode(8211);

let formulaPrefixesStripped = 0;

${LIFTED}

function round6(n) { return Math.round(n * 1e6) / 1e6; }

// ---------------------------------------------------------------------------
// THE ASSEMBLY WALK. The same rules as _master.js assemble(), and config/test-stage-2.js asserts
// the two produce byte identical text for a given selection on both lanes.
//
//   sections follow section_order when it is given and usable, document order otherwise
//   groups inside a section follow DOCUMENT order, always, so a model cannot put the 2019
//     internship above the current role by accident
//   blocks inside a group follow the MODEL order, mandatory first so the header never shuffles.
//     That is the real tailoring lever: the bullet that matches the ad goes first inside its role
// ---------------------------------------------------------------------------
function assembleSelection(table, requestedIds, sectionOrder) {
  const chosen = {};
  for (const id of requestedIds) chosen[id] = true;
  for (const id of table.mandatory_ids) chosen[id] = true;

  const docSections = table.sections.map((s) => s.key);
  let order = docSections;
  if (Array.isArray(sectionOrder) && sectionOrder.length) {
    const known = sectionOrder.filter((k) => docSections.indexOf(k) !== -1);
    order = known.concat(docSections.filter((k) => known.indexOf(k) === -1));
  }

  const emitted = [];
  for (const sectionKey of order) {
    const section = table.sections.filter((s) => s.key === sectionKey)[0];
    if (!section) continue;
    const sectionOut = [];
    for (const g of section.groups) {
      const picked = g.block_ids.filter((id) => chosen[id] === true);
      if (!picked.length) continue;                       // a group with nothing selected emits nothing
      if (g.h3_id) sectionOut.push(g.h3_id);
      if (g.meta_id) sectionOut.push(g.meta_id);
      // the model order inside the group, mandatory first so the header never shuffles
      const byRequest = requestedIds.filter((id) => picked.indexOf(id) !== -1);
      const forced = picked.filter((id) => table.mandatory_ids.indexOf(id) !== -1 && byRequest.indexOf(id) === -1);
      const rest = picked.filter((id) => byRequest.indexOf(id) === -1 && forced.indexOf(id) === -1);
      for (const id of forced.concat(byRequest, rest)) sectionOut.push(id);
    }
    if (!sectionOut.length) continue;                     // a section with nothing selected emits no heading
    if (section.h2_id) emitted.push(section.h2_id);
    for (const id of sectionOut) emitted.push(id);
  }

  let paraChars = 0;
  for (const id of emitted) {
    const b = table.byId[id];
    if (!b) continue;
    if (b.level === 'h1' || b.level === 'h2' || b.level === 'h3') continue;
    paraChars += b.chars;
  }
  return { emitted: emitted, para_chars: paraChars, order: order };
}

function renderText(table, emitted, bridge, bridgeAfterId) {
  const lines = [];
  for (const id of emitted) {
    const b = table.byId[id];
    if (!b) continue;
    lines.push(b.raw);
    if (bridge && bridgeAfterId && id === bridgeAfterId) lines.push(bridge);
  }
  return lines.join(NL);
}

function esc(s) {
  return String(s)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;');
}

// The HTML body the render seat wraps. A fragment, never a document: the page CSS, the one page
// rule and the font stack are that seat own, and the render safety law (min-height, overflow
// visible, never height with overflow hidden) lives with them.
function renderHtml(table, emitted, bridge, bridgeAfterId) {
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  const emitBridge = () => {
    closeList();
    out.push('<p class="bridge">' + esc(bridge) + '</p>');
  };
  for (const id of emitted) {
    const b = table.byId[id];
    if (!b) continue;
    if (b.level === 'h1') { closeList(); out.push('<h1>' + esc(b.text) + '</h1>'); }
    else if (b.level === 'h2') { closeList(); out.push('<h2>' + esc(b.text) + '</h2>'); }
    else if (b.level === 'h3') { closeList(); out.push('<h3>' + esc(b.text) + '</h3>'); }
    else if (b.level === 'bullet') { if (!inList) { out.push('<ul>'); inList = true; } out.push('<li>' + esc(b.text) + '</li>'); }
    else if (b.level === 'rule') { continue; }
    else { closeList(); out.push('<p>' + esc(b.text) + '</p>'); }
    if (bridge && bridgeAfterId && id === bridgeAfterId) emitBridge();
  }
  closeList();
  return out.join(NL);
}

// ---------------------------------------------------------------------------
// THE BRIDGE LINE. Every rail from header note 5, in the order a failure is cheapest to explain.
// A failure DROPS the line and never the CV.
// ---------------------------------------------------------------------------
function checkBridge(raw) {
  if (raw === null || raw === undefined || raw === '') return { line: null, state: 'none', why: 'the selector returned no bridge line, which is the normal answer: the master covers the requirement, or there is no gap a screener would notice.' };
  if (typeof raw !== 'string') return { line: null, state: 'dropped', why: 'the bridge line came back as ' + JSON.stringify(raw) + ' rather than a string.' };

  const fails = [];

  // THE DASH CHECK RUNS ON THE RAW STRING, BEFORE clean(), AND THAT ORDER IS THE WHOLE POINT.
  // clean() strips dashes: it turns an em dash into a comma and an en dash into a hyphen, which is
  // the right thing to do at a door where untrusted text ARRIVES. It is the wrong thing to do here,
  // because it would silently repair the one thing this check exists to catch and the line would
  // ship looking clean. Design defect 7 from the plan review says it for the letter in as many
  // words: no silent dash sanitiser, because a substitution hides a voice slip from the grader. The
  // same argument applies to the only model authored sentence allowed on a CV.
  DASH_RE.lastIndex = 0;
  if (DASH_RE.test(String(raw))) {
    fails.push('it contains an em dash or an en dash, which no output of this system carries');
  }

  // A generous clean cap on purpose: clean() truncates with an ellipsis at its cap, and truncating
  // first would let an over length line pass the length rule by being cut.
  const line = clean(raw, 1000);
  if (!line) return { line: null, state: 'dropped', why: 'the bridge line was empty after cleaning.' };

  if (line.slice(0, BRIDGE_PREFIX.length) !== BRIDGE_PREFIX) {
    fails.push('it does not begin with the exact words ' + JSON.stringify(BRIDGE_PREFIX.trim()) + ', which is what makes the one non master line on the page visible as such');
  }
  if (line.length > BRIDGE_MAX_CHARS) {
    fails.push('it is ' + line.length + ' characters and the cap is ' + BRIDGE_MAX_CHARS);
  }
  if (line.charAt(line.length - 1) !== '.') {
    fails.push('it does not end in a full stop, so it is not one finished sentence');
  }
  // One sentence. A full stop anywhere but the end means two.
  if (line.slice(0, -1).indexOf('.') !== -1) {
    fails.push('it contains more than one sentence, and the allowance is exactly one');
  }
  if (/[0-9]/.test(line)) {
    fails.push('it contains a digit. Every number on a CV is a claim, and this is the one line that did not come from a document he approved, so it may carry none');
  }
  PRONOUN_RE.lastIndex = 0;
  if (PRONOUN_RE.test(line)) {
    fails.push('it contains a third person pronoun, and a CV is written in his own voice');
  }
  const low = line.toLowerCase();
  for (const t of TELLS) {
    if (low.indexOf(t) !== -1) { fails.push('it contains the AI tell ' + JSON.stringify(t)); break; }
  }
  for (const c of CLAIMS) {
    c.re.lastIndex = 0;
    if (c.re.test(line)) { fails.push('it makes a banned claim (' + c.id + '), which is forbidden on every CV this system produces'); break; }
  }

  if (fails.length) {
    return { line: null, state: 'dropped', why: 'the bridge line was dropped: ' + fails.join('; ') + '. A malformed bridge costs one sentence and never the CV.', candidate: line.slice(0, 200) };
  }
  return { line: line, state: 'kept', why: 'the bridge line passed every check: the exact opening words, one sentence, within the cap, no digits, no dashes, no pronouns, no AI tells and no banned claims. It carries no block id and it is emitted from a different code path from the master strings, so nothing can mistake it for his own writing.' };
}

// --- 1. the three views of who was called -----------------------------------
let called = [];
try {
  called = $('Select Route').all(0).map((i) => i.json);
} catch (e) {
  called = [];
}
let responses = null;
let responsesWhy = null;
try {
  responses = $('Select CV Blocks').all();
} catch (e) {
  responses = null;
  responsesWhy = e.message;
}
let expectedCalls = null;
try {
  expectedCalls = $('Build Select Request').all().map((i) => i.json).filter((j) => j && j._call_now === true).length;
} catch (e) {
  expectedCalls = null;
}
const carried = $input.all().map((i) => i.json).filter((j) => j && j._kind !== undefined);

let pairing = 'ok';
let pairingWhy = null;
const warnings = [];

if (expectedCalls !== null && called.length !== expectedCalls) {
  pairing = 'mismatch';
  pairingWhy = 'Build Select Request stamped _call_now true on ' + expectedCalls + ' pair(s) and Select Route sent ' + called.length +
    ' down the paid branch. The route and the stamp have come apart.';
} else if (responses === null) {
  if (called.length > 0) {
    pairing = 'no_responses';
    pairingWhy = 'Select Route sent ' + called.length + ' pair(s) and the Select CV Blocks node produced no run data (' + (responsesWhy || 'unknown') +
      '). The node did not execute. Every pair is kept, marked, and written NOWHERE, so the next run offers the same rows again.';
  }
} else if (responses.length !== called.length) {
  pairing = 'mismatch';
  pairingWhy = 'Select Route sent ' + called.length + ' pair(s) and Select CV Blocks returned ' + responses.length +
    '. Refusing to guess an alignment: one selection applied to another job builds a perfectly valid CV tailored to the wrong posting, and every count on the sheet would still be right.';
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

// --- 2. per pair ---------------------------------------------------------------
const outPairs = [];
const usageTotals = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cost_usd: 0 };
const errorKinds = {};
const statusCodes = {};
const holdKinds = {};
const idProblems = [];
const stats = {
  attempted: 0, assembled: 0, held: 0, errored: 0,
  drops_applied: 0, pairs_needing_a_drop: 0, over_after_every_drop: 0,
  bridges_kept: 0, bridges_dropped: 0, bridges_dropped_to_fit: 0,
  unknown_section_keys: 0, mandatory_ids_on_drop_order: 0, unselected_ids_on_drop_order: 0,
};
let cacheReads = 0;
let cacheWrites = 0;
let parsedOk = 0;
const unknownKeysSeen = {};

function markError(pair, kind, why) {
  pair._status = 'error:' + kind;
  pair._status_why = why;
  pair._status_class = SYSTEMIC_KINDS.indexOf(kind) !== -1 ? 'systemic' : 'row';
  pair._sheet_action = 'leave_untouched';
  errorKinds[kind] = (errorKinds[kind] || 0) + 1;
  stats.errored += 1;
}
function markHold(pair, kind, why) {
  pair._status = 'needs_review';
  pair._status_why = why;
  pair._status_class = 'hold';
  pair._sheet_action = 'write_status';
  holdKinds[kind] = (holdKinds[kind] || 0) + 1;
  stats.held += 1;
}

for (let i = 0; i < called.length; i += 1) {
  const pair = Object.assign({}, called[i]);
  outPairs.push(pair);
  stats.attempted += 1;

  if (pairing === 'mismatch') { markError(pair, 'pairing', pairingWhy); continue; }
  if (pairing === 'no_responses') { markError(pair, 'node_did_not_run', pairingWhy); continue; }

  const item = responses[i] || {};
  const j = item.json || {};

  if (j.error !== undefined && j.statusCode === undefined) {
    markError(pair, 'transport', 'the selection request never completed: ' + String(typeof j.error === 'string' ? j.error : (j.error && j.error.message) || JSON.stringify(j.error)).slice(0, 240));
    continue;
  }
  const status = Number(j.statusCode);
  const body = j.body;
  if (!isFinite(status)) {
    markError(pair, 'transport', 'the response carried no statusCode. fullResponse is set on Select CV Blocks, so a missing status means the item is not an HTTP response at all.');
    continue;
  }
  statusCodes[String(status)] = (statusCodes[String(status)] || 0) + 1;
  if (status < 200 || status >= 300) {
    const c = classify(status, body);
    markError(pair, c.kind, c.why);
    continue;
  }

  // 2xx. Price it whatever the content turns out to be: the tokens were spent.
  const usage = costOf(body && body.usage);
  usageTotals.input_tokens += usage.input_tokens;
  usageTotals.output_tokens += usage.output_tokens;
  usageTotals.cache_creation_input_tokens += usage.cache_creation_input_tokens;
  usageTotals.cache_read_input_tokens += usage.cache_read_input_tokens;
  usageTotals.cost_usd = round6(usageTotals.cost_usd + usage.cost_usd);
  if (usage.cache_read_input_tokens > 0) cacheReads += 1;
  if (usage.cache_creation_input_tokens > 0) cacheWrites += 1;

  const prev = (pair._cost && typeof pair._cost === 'object') ? pair._cost : { usd: 0, calls: [] };
  const prevCalls = Array.isArray(prev.calls) ? prev.calls : [];
  pair._cost = {
    usd: round6((Number(prev.usd) || 0) + usage.cost_usd),
    calls: prevCalls.concat([{ stage: 'select', model: SELECT_MODEL, usd: usage.cost_usd, usage: usage }]),
  };

  // THE FILTER. content[0] is not the text block. On claude-opus-5 an omitted thinking parameter
  // means ADAPTIVE thinking is ON, a thinking block comes back FIRST, and with the default display
  // it carries empty text. A content[0].text reader would return an empty string on every call and
  // report every selection as unreadable, forever, with a green run and a zero.
  const content = (body && Array.isArray(body.content)) ? body.content : [];
  const textBlocks = content.filter((b) => b && b.type === 'text');
  const stop = (body && body.stop_reason) || 'unknown';
  const meta = {
    http_status: status,
    stop_reason: stop,
    usage: usage,
    content_blocks: { total: content.length, text: textBlocks.length, non_text: content.length - textBlocks.length, types: content.map((b) => (b && b.type) || 'unknown') },
  };
  pair._select_response = meta;
  const text = textBlocks.map((b) => String(b.text === undefined || b.text === null ? '' : b.text)).join(NL).trim();

  if (!text) {
    if (stop === 'max_tokens') {
      markHold(pair, 'selection_truncated', 'the selection hit max_tokens (' + SELECT_MAX_TOKENS + ') before it produced any text at all. On this model an omitted thinking parameter means ADAPTIVE thinking is ON, and max_tokens caps thinking and text TOGETHER, so the whole budget went to reasoning. Content blocks seen: ' + JSON.stringify(meta.content_blocks.types));
    } else {
      markHold(pair, 'no_text_block', 'the selection response carried ' + content.length + ' content block(s) and none of them was a text block (types ' + JSON.stringify(meta.content_blocks.types) + ', stop_reason ' + stop + ').');
    }
    continue;
  }

  const parsed = extractJson(text);
  if (!parsed.ok) {
    if (stop === 'max_tokens') {
      markHold(pair, 'selection_truncated', 'the selection hit max_tokens (' + SELECT_MAX_TOKENS + ') and the JSON is cut off, so it will not parse. Raise the select row of the intake cost model, which is where this ceiling is read from. First 200 characters: ' + JSON.stringify(String(parsed.sample || text).slice(0, 200)));
    } else {
      markHold(pair, 'unparseable_selection', 'the selection would not parse as JSON: ' + parsed.why + '. First 200 characters: ' + JSON.stringify(String(parsed.sample || text).slice(0, 200)));
    }
    continue;
  }
  parsedOk += 1;

  const ans = parsed.value;
  for (const k of Object.keys(ans)) if (SCHEMA_KEYS.indexOf(k) === -1) unknownKeysSeen[k] = (unknownKeysSeen[k] || 0) + 1;

  const key = String(pair.master_key || '');
  const table = BLOCKS[key];
  if (!table) {
    markHold(pair, 'no_master_table', 'this pair carries master_key ' + JSON.stringify(key) + ' and this workflow was built with block libraries for ' + JSON.stringify(Object.keys(BLOCKS)) + ' only.');
    continue;
  }

  const requested = Array.isArray(ans.cv_block_ids) ? ans.cv_block_ids.filter((x) => typeof x === 'string' && x) : null;
  if (!requested) {
    markHold(pair, 'no_ids', 'the selection did not return cv_block_ids as an array of strings. The whole contract of this stage is ids in and master strings out, so there is nothing to assemble and nothing is guessed.');
    continue;
  }

  // --- EVERY ID VALIDATED. See header note 2. ---
  const unknown = [];
  const stale = [];
  const refusedRole = [];
  const positions = {};
  for (const p of table.positions) positions[p] = true;
  for (const id of requested) {
    const b = table.byId[id];
    if (!b) {
      const prefix = String(id).split('@')[0];
      if (positions[prefix]) stale.push(id); else unknown.push(id);
      continue;
    }
    if (b.role === 'directive') refusedRole.push({ id: id, role: 'directive', why: 'a build instruction that happens to live in a bullet. Printing it would put a local file path on a CV.' });
    else if (b.role === 'structural') refusedRole.push({ id: id, role: 'structural', why: 'a heading or a horizontal rule. Headings are emitted automatically around the blocks selected under them, never selected.' });
    else if (b.role === 'meta') refusedRole.push({ id: id, role: 'meta', why: 'a role date line. It rides with its group automatically whenever that group has anything selected.' });
  }
  if (unknown.length || stale.length || refusedRole.length) {
    idProblems.push({ job_id: pair.job_id, unknown: unknown.slice(0, 5), stale: stale.slice(0, 5), refused: refusedRole.slice(0, 5) });
    const parts = [];
    if (stale.length) {
      parts.push(stale.length + ' id(s) match a real block POSITION with a DIFFERENT content hash: ' + JSON.stringify(stale.slice(0, 3)) +
        '. That is the AMENDMENT SIGNAL. The master text changed under a pinned id, so re-read the master and rebuild this workflow. Never patch an id by hand.');
    }
    if (unknown.length) {
      parts.push(unknown.length + ' id(s) match no block and no position: ' + JSON.stringify(unknown.slice(0, 3)) +
        '. Those are invented rather than stale: the model wrote something shaped like an id instead of copying one.');
    }
    if (refusedRole.length) {
      parts.push(refusedRole.length + ' id(s) name a block the selector is not allowed to choose (' + refusedRole.map((r) => r.id + ' is ' + r.role).slice(0, 3).join(', ') + ').');
    }
    markHold(pair, 'bad_block_id', 'the selection names block id(s) that cannot be used, so nothing was assembled. ' + parts.join(' ') +
      ' The CV is master text or it is nothing: an id that does not resolve is a refusal, not a paragraph.');
    continue;
  }

  // --- section order. See the deliberate divergence in header note 6. ---
  const docSections = table.sections.map((s) => s.key);
  const rawOrder = Array.isArray(ans.section_order) ? ans.section_order.filter((x) => typeof x === 'string') : [];
  const badSections = rawOrder.filter((k) => docSections.indexOf(k) === -1);
  if (badSections.length) stats.unknown_section_keys += badSections.length;
  const sectionOrder = rawOrder.filter((k) => docSections.indexOf(k) !== -1);

  // --- the bridge line, shape checked before anything is measured ---
  const bridge = checkBridge(ans.bridge_line);

  // --- assemble, then drop to fit. See header note 4. ---
  let current = requested.slice();
  let built = assembleSelection(table, current, sectionOrder);
  const dropOrder = Array.isArray(ans.drop_order) ? ans.drop_order.filter((x) => typeof x === 'string') : [];
  const dropped = [];
  const dropSkipped = [];
  let bridgeLine = bridge.line;
  let bridgeState = bridge.state;
  let bridgeWhy = bridge.why;

  const totalChars = () => built.para_chars + (bridgeLine ? bridgeLine.length : 0);
  const startedOver = totalChars() > PARA_CHARS_MAX;
  if (startedOver) stats.pairs_needing_a_drop += 1;

  for (let d = 0; d < dropOrder.length && totalChars() > PARA_CHARS_MAX; d += 1) {
    const id = dropOrder[d];
    if (table.mandatory_ids.indexOf(id) !== -1) {
      dropSkipped.push({ id: id, why: 'it is MANDATORY and is forced onto every CV, so it cannot be dropped' });
      stats.mandatory_ids_on_drop_order += 1;
      continue;
    }
    if (current.indexOf(id) === -1) {
      dropSkipped.push({ id: id, why: 'it was never selected, so there was nothing to drop' });
      stats.unselected_ids_on_drop_order += 1;
      continue;
    }
    const before = built.para_chars;
    current = current.filter((x) => x !== id);
    built = assembleSelection(table, current, sectionOrder);
    dropped.push({ id: id, recovered_chars: before - built.para_chars });
    stats.drops_applied += 1;
  }

  // Last resort: the bridge line is the one line on the page that is not his writing, so when the
  // choice is between shipping without it and not shipping at all, it goes.
  if (bridgeLine && totalChars() > PARA_CHARS_MAX) {
    bridgeWhy = 'the bridge line passed every check and was then dropped to fit one page: drop_order was exhausted and the page was still ' + (totalChars() - PARA_CHARS_MAX) + ' characters over. It is the one line on the page that is not his writing, so it goes before anything he wrote does.';
    bridgeLine = null;
    bridgeState = 'dropped_to_fit';
    stats.bridges_dropped_to_fit += 1;
  }

  if (totalChars() > PARA_CHARS_MAX) {
    stats.over_after_every_drop += 1;
    markHold(pair, 'cv_over_one_page',
      'the assembled CV is ' + totalChars() + ' characters of paragraph text against a ceiling of ' + PARA_CHARS_MAX + ', after applying every id on the selector own drop_order (' + dropped.length + ' dropped, ' + dropSkipped.length + ' skipped). ' +
      'D13 is a hard refuse: one page or it does not ship. The selection has to be tightened, and the usual cause is a drop_order that named far fewer ids than the selection did. Nothing is cut here on this node own judgement, because choosing what to lose is the selector job and this node does not have the posting in front of it.');
    pair.cv_selection = {
      master_key: key,
      master_sha256: table.master_sha256,
      requested_ids: requested,
      dropped: dropped,
      drop_skipped: dropSkipped,
      drop_order_given: dropOrder.length,
      para_chars: totalChars(),
      ceiling_chars: PARA_CHARS_MAX,
      over_by: totalChars() - PARA_CHARS_MAX,
      bridge_line: null,
      bridge_state: bridgeState,
      bridge_why: bridgeWhy,
    };
    continue;
  }

  // --- the mandatory set, ASSERTED rather than assumed. A14. See header note 3. ---
  const emittedIds = built.emitted;
  const missingMandatory = table.mandatory_ids.filter((id) => emittedIds.indexOf(id) === -1);
  if (missingMandatory.length) {
    markHold(pair, 'mandatory_missing',
      'the assembled CV is missing ' + missingMandatory.length + ' MANDATORY block(s). Those are his name, his contact line and the work authorization line, and they are forced onto every CV precisely so that the checks asserting their content mean something. A CV missing one is a CV a recruiter cannot answer, and every other count on this run would still be right. This is an assembler fault rather than a selection one.');
    continue;
  }

  // --- where the bridge goes, if it survived ---
  // The end of the summary section. A "ready to" statement reads naturally there and can never be
  // mistaken for a bullet under a role. If nothing from the summary was selected there is no
  // natural home for it, and inventing a section for one sentence is worse than dropping it.
  let bridgeAfterId = null;
  if (bridgeLine) {
    for (const id of emittedIds) {
      const b = table.byId[id];
      if (b && b.section === 'sum' && b.level !== 'h2') bridgeAfterId = id;
    }
    if (!bridgeAfterId) {
      bridgeWhy = 'the bridge line passed every check and was dropped for want of a home: it belongs at the end of the summary section, and nothing from the summary was selected. Inventing a section for one sentence that is not his writing is worse than losing it.';
      bridgeLine = null;
      bridgeState = 'dropped_no_home';
    }
  }
  if (bridgeState === 'kept' && bridgeLine) stats.bridges_kept += 1;
  else if (bridgeState === 'dropped') stats.bridges_dropped += 1;

  // --- objection coverage, checked against what actually shipped ---
  const coverage = [];
  const rawCoverage = Array.isArray(ans.objection_coverage) ? ans.objection_coverage : [];
  for (const c of rawCoverage) {
    if (coverage.length >= COVERAGE_MAX) break;
    if (!c || typeof c !== 'object') continue;
    const blockId = typeof c.block_id === 'string' && c.block_id ? c.block_id : null;
    let state = 'none';
    let note = clean(c.note, OBJECTION_NOTE_MAX) || null;
    if (blockId) {
      if (emittedIds.indexOf(blockId) !== -1) state = 'answered';
      else if (table.byId[blockId]) state = 'answered_by_a_block_that_did_not_ship';
      else state = 'answered_by_an_id_that_does_not_exist';
    }
    coverage.push({ objection: clean(c.objection, OBJECTION_NOTE_MAX) || null, block_id: blockId, state: state, note: note });
  }

  pair.cv_text = renderText(table, emittedIds, bridgeLine, bridgeAfterId);
  pair.cv_html_body = renderHtml(table, emittedIds, bridgeLine, bridgeAfterId);
  pair.cv_selection = {
    master_key: key,
    master_sha256: table.master_sha256,
    requested_ids: requested,
    emitted_ids: emittedIds,
    mandatory_forced: table.mandatory_ids.filter((id) => requested.indexOf(id) === -1),
    dropped: dropped,
    drop_skipped: dropSkipped,
    drop_order_given: dropOrder.length,
    section_order_used: built.order,
    section_order_unknown_keys: badSections,
    para_chars: built.para_chars + (bridgeLine ? bridgeLine.length : 0),
    ceiling_chars: PARA_CHARS_MAX,
    headroom_chars: PARA_CHARS_MAX - (built.para_chars + (bridgeLine ? bridgeLine.length : 0)),
    bridge_line: bridgeLine,
    bridge_state: bridgeState,
    bridge_why: bridgeWhy,
    objection_coverage: coverage,
    why: clean(ans.why, WHY_MAX) || null,
    voice_rules_sha: VOICE_RULES_SHA,
    contract: 'every string in cv_text except the bridge line, when there is one, came out of the frozen master by id. The selector emitted ids and this node emitted master strings, so there is no code path by which a rewritten sentence can be here.',
  };
  stats.assembled += 1;
}

// --- 3. everything else passes through untouched --------------------------------
const outCarried = [];
for (const raw of carried) {
  const j = Object.assign({}, raw);
  j._call_now = false;
  outCarried.push(j);
}

// --- 4. the stage report ----------------------------------------------------------
if (pairing === 'mismatch') warnings.push('SELECTION PAIRING REFUSED, and no CV was assembled because of it: ' + pairingWhy);
if (pairing === 'no_responses') warnings.push('THE SELECTION NODE DID NOT RUN: ' + pairingWhy);
if (errorKinds.credits) {
  warnings.push('THE ANTHROPIC ACCOUNT IS OUT OF CREDIT at the selection stage. Every affected row is left at status new and written NOWHERE, so the next run offers the same jobs again. The read those pairs already paid for is lost, which is the honest cost of stopping here rather than shipping half a CV.');
}
if (errorKinds.auth) {
  warnings.push('THE ANTHROPIC KEY WAS REFUSED at the selection stage. Check the credential for this workflow. Note that it is a PROVISIONAL choice: Shaheen has not picked one and human-action anthropic-credential-36-writer is open.');
}
if (idProblems.length) {
  const anyStale = idProblems.some((p) => p.stale && p.stale.length);
  warnings.push(idProblems.length + ' pair(s) were HELD because the selection named block ids that cannot be used. ' +
    (anyStale
      ? 'AT LEAST ONE IS AN AMENDMENT SIGNAL: an id matched a real block position with a different content hash, which means the master text changed under a pinned id. That is the freeze working. Re-read the master and rebuild this workflow; do not patch an id.'
      : 'None matched a known position, so these are invented ids rather than stale ones: the model wrote something shaped like an id instead of copying one.'));
}
if (stats.over_after_every_drop > 0) {
  warnings.push(stats.over_after_every_drop + ' pair(s) were HELD because the CV would not fit one page after every id on the selector own drop_order had been applied. D13 is a hard refuse and this is it working. The usual cause is a drop_order far shorter than the selection.');
}
if (stats.mandatory_ids_on_drop_order > 0) {
  warnings.push(stats.mandatory_ids_on_drop_order + ' MANDATORY id(s) appeared on a drop_order. They were skipped and the CV is unaffected, because the mandatory set is forced. It is reported because a selector that keeps trying to drop his contact line is worth knowing about rather than merely being ineffective.');
}
if (stats.bridges_dropped > 0) {
  warnings.push(stats.bridges_dropped + ' bridge line(s) were DROPPED for failing their checks. A bridge line is the only model authored sentence allowed on a CV here, so it is held to the exact opening words, one sentence, a length cap, no digits, no dashes, no pronouns and no banned claims. A failure costs the sentence and never the CV.');
}
if (stats.attempted > 1 && cacheReads === 0 && parsedOk > 1) {
  warnings.push('THE SELECTION PROMPT CACHE NEVER READ. ' + parsedOk + ' successful call(s) and cache_read_input_tokens was 0 on every one. The system block on this stage is the whole master, so this is the most expensive silent cache failure available: it means paying full price for a copy of his CV on every single pair. The usual causes are a system block that changed between calls, a gap of more than five minutes, or a prefix under the model minimum of ' + MIN_CACHE_TOKENS + ' tokens.');
}
if (Object.keys(unknownKeysSeen).length) {
  warnings.push('the selector returned key(s) outside the closed schema and they were ignored: ' + JSON.stringify(unknownKeysSeen) + '.');
}
if (stats.unknown_section_keys > 0) {
  warnings.push(stats.unknown_section_keys + ' unknown section key(s) appeared in a section_order and were ignored, falling back to document order. This is the one place this node is deliberately more forgiving than the build time assembler in _master.js: section order is a presentation preference, and refusing a whole CV over one unknown key would be disproportionate.');
}

const report = {
  _kind: 'stage_report',
  stage: 'assemble_cv',
  model: SELECT_MODEL,
  pairing: { state: pairing, why: pairingWhy, sent: called.length, responses: responses === null ? null : responses.length, expected: expectedCalls },
  counts: stats,
  hold_kinds: holdKinds,
  error_kinds: errorKinds,
  http_status_codes: statusCodes,
  id_problems: idProblems,
  ceiling: {
    para_chars_max: PARA_CHARS_MAX,
    rule: 'D13, one page, a HARD refuse. The selector returns drop_order and this node drops down it one id at a time, re-measuring after each, because dropping the last block of a role also removes its date line and its heading. When drop_order runs out the bridge line goes, and if it is still over the pair is HELD and leaves a row for Shaheen. Nothing is cut on this node own judgement: choosing what to lose is the selector job and this node does not have the posting in front of it.',
  },
  bridge_line_rule: 'at most one sentence beginning ' + JSON.stringify(BRIDGE_PREFIX) + ', one sentence, at most ' + BRIDGE_MAX_CHARS + ' characters, no digits, no dashes, no pronouns, no AI tells, no banned claims. It has no block id, it is emitted from a different code path from the master strings, and a failure drops the line and never the CV. It is the ONLY model authored prose that may reach a CV in this design and it is reported here and in cv_selection so the README can name it.',
  contract: 'the selector emits IDS and this node emits MASTER STRINGS. A model that hallucinates a better bullet produces an id that does not resolve, and an id that does not resolve is a refusal rather than a paragraph. An id whose POSITION exists with a different content hash is the amendment signal: the master changed under a pinned id.',
  voice_rules_sha: VOICE_RULES_SHA,
  masters: Object.keys(BLOCKS).reduce((acc, k) => { acc[k] = { master_sha256: BLOCKS[k].master_sha256, blocks: Object.keys(BLOCKS[k].byId).length, mandatory: BLOCKS[k].mandatory_ids.length }; return acc; }, {}),
  cost: {
    actual_usd: usageTotals.cost_usd,
    usage: usageTotals,
    cache: { calls_with_a_cache_read: cacheReads, calls_that_wrote_cache: cacheWrites, of_calls: parsedOk, model_minimum_tokens: MIN_CACHE_TOKENS },
    prices: { model: SELECT_MODEL, in_per_mtok: PRICE_IN, out_per_mtok: PRICE_OUT, cache_write_mult: CACHE_WRITE_MULT, cache_read_mult: CACHE_READ_MULT },
  },
  warnings: warnings,
  _call_now: false,
  site_fetch_url: '',
  ad_fetch_url: '',
};

// Never an empty array.
const items = outPairs.concat(outCarried).map((j) => ({ json: j, pairedItem: { item: 0 } }));
items.push({ json: report, pairedItem: { item: 0 } });
return items;
`;

const jsCode = [
  '// GENERATED at build time from work/36-job-application-writer/nodes/28-assemble-cv.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  VOICE_RUNTIME,
  'const SELECT_MODEL = ' + JSON.stringify(MODEL) + ';',
  'const SELECT_MAX_TOKENS = ' + JSON.stringify(S2.readSourceNumber('./05-build-candidates.js', /\{\s*stage:\s*'select',[^}]*out_tokens:\s*(\d+)\s*\}/, 'the select row of COST_MODEL')) + ';',
  'const MIN_CACHE_TOKENS = ' + JSON.stringify(LN.MIN_CACHEABLE_TOKENS[MODEL]) + ';',
  'const PRICE_IN = ' + JSON.stringify(PRICE.in_per_mtok) + ';',
  'const PRICE_OUT = ' + JSON.stringify(PRICE.out_per_mtok) + ';',
  'const CACHE_WRITE_MULT = ' + JSON.stringify(PRICE.cache_write_mult) + ';',
  'const CACHE_READ_MULT = ' + JSON.stringify(PRICE.cache_read_mult) + ';',
  'const PARA_CHARS_MAX = ' + JSON.stringify(PARA_CHARS_MAX) + ';',
  'const BRIDGE_PREFIX = ' + JSON.stringify(BRIDGE_PREFIX) + ';',
  'const BRIDGE_MAX_CHARS = ' + JSON.stringify(BRIDGE_MAX_CHARS) + ';',
  'const SCHEMA_KEYS = ' + JSON.stringify(SCHEMA_KEYS) + ';',
  'const SYSTEMIC_KINDS = ' + JSON.stringify(SYSTEMIC_KINDS) + ';',
  'const WHY_MAX = ' + JSON.stringify(WHY_MAX) + ';',
  'const OBJECTION_NOTE_MAX = ' + JSON.stringify(OBJECTION_NOTE_MAX) + ';',
  'const COVERAGE_MAX = ' + JSON.stringify(COVERAGE_MAX) + ';',
  'const BLOCKS = ' + JSON.stringify(BLOCKS) + ';',
  LOGIC,
].join('\n');

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [6760, 100],
  connectFrom: 'Select Results',
  notes: 'Validates every block id the selector returned against the baked master, telling a STALE id (the position exists with a different content hash, which is the amendment signal) apart from an INVENTED one. Forces the mandatory set and then asserts it actually shipped. Applies the selector own drop_order one id at a time, re-measuring, until the CV fits the 3760 character one page ceiling; drops the bridge line as a last resort; and HOLDS the pair if it is still over, because D13 is a hard refuse. Emits cv_text and cv_html_body from the master strings themselves, so there is no code path by which the CV can carry a rewritten sentence. The one exception, a single Ready to bridging line, has no id, is checked against the shared voice rules, and is dropped rather than shipped if it fails anything.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

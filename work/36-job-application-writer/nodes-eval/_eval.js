'use strict';
/*
 * _eval.js - the build-time helpers for the #36 LETTER EVAL, the regression harness for the one
 * prose node.
 *
 * The leading underscore keeps this file out of build.js's node glob (/^\d+-.+\.js$/), exactly the
 * way nodes/_lane.js, _master.js, _stage2.js, _render.js and _write.js stay out of the runtime one.
 *
 * =============================================================================================
 * 1. WHAT THIS HARNESS IS FOR, IN ONE SENTENCE.
 * =============================================================================================
 * Six seeded cases go through the LIVE prose node, six real letters come back, and deterministic
 * code scores them with the same rules the runtime audit uses. The verdict has to read 6/6.
 *
 * =============================================================================================
 * 2. WHY THERE IS NO PROMPT TEXT ANYWHERE IN nodes-eval/.
 * =============================================================================================
 * An eval that carries its own copy of the prompt tests a copy. The copy drifts, the eval stays
 * green, and the thing it was built to protect is the thing it stops watching. That is not a
 * theory here: the reason scripts/lib/voice-rules.js exists at all is that the live Writer Voice
 * Eval had SEVENTEEN tells baked into it while the grader rubric had thirteen, and nobody knew.
 *
 * So writerJsCode() below takes parameters.jsCode straight off nodes/29-build-writer-request.js,
 * the same object build.js hands to n8n. There is no second copy to drift from. That makes the
 * eval identical to the runtime BY CONSTRUCTION against the REPO.
 *
 * The BOX is the other half, and a repo cannot assert it offline. writer-node.pin.json carries the
 * sha256 of the live node's jsCode, captured from a read-only GET, and this file REFUSES TO BUILD
 * when the regenerated code no longer hashes to it. The refusal is the feature: at that moment the
 * box and the repo genuinely disagree, and an eval assembled from the repo would be measuring a
 * prompt that nothing runs.
 *
 * =============================================================================================
 * 3. NOTHING PERSONAL IS TYPED INTO A TRACKED FILE.
 * =============================================================================================
 * work/36-job-application-writer/nodes-eval/ is TRACKED and this repo is PUBLIC. `git check-ignore`
 * says so: config/ is ignored, nodes/ and nodes-eval/ are not. So every fact about him that the
 * eval needs is READ AT BUILD TIME from the vault masters, the same way every runtime node does it:
 *   the CV text            assembled from the frozen master by _master.assemble()
 *   his name, his city     lifted out of node 34's baked AUDIT_CFG, which derived them from the
 *   the approved figures   masters, so the eval cannot hold a stale copy of any of them
 * The six case briefs below are invented companies and invented postings. They contain nothing
 * about him, which is why they are allowed to be literals.
 *
 * =============================================================================================
 * 4. LIFTED, NEVER RETYPED.
 * =============================================================================================
 * normalise(), wordCount() and extractNumbers() come out of the GENERATED jsCode of node 34 via
 * _stage2.bakedFunction(), so the eval tokenises a number and counts a word with the same bytes the
 * runtime audit does. extractLetter() comes out of node 33 the same way, so the eval takes an
 * Anthropic answer apart exactly as the runtime does. The voice tables come from
 * voice-rules.renderRuntimeSource(), the same renderer the audit node bakes from.
 *
 * The one thing that is NOT lifted is spanIsIn()/flat(), four lines that live inside a closure in
 * node 34 and therefore cannot be cut at column zero. They are re-declared in 07-case-metrics.js
 * with identical semantics and that is SAID there rather than left to be discovered.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NODES = path.join(__dirname, '..', 'nodes');
const S2 = require(path.join(NODES, '_stage2.js'));
const MASTER = require(path.join(NODES, '_master.js'));
const VR = require(path.join(S2.REPO, 'scripts', 'lib', 'voice-rules.js'));
// comparableCode: the pin comparison below normalises the voice block's daily sync date out of both
// sides. Required here beside voice-rules, off S2.REPO, for the same reason that one is.
const VOICE_LIB = require(path.join(S2.REPO, 'scripts', 'lib', 'sync-n8n-voice.js'));

const WRITER_NODE_FILE = path.join(NODES, '29-build-writer-request.js');
const AUDIT_NODE_FILE = path.join(NODES, '34-audit-pair.js');
const PIN_FILE = path.join(__dirname, 'writer-node.pin.json');

const WRITER_NODE_NAME = 'Build Writer Request';

// Built from char codes, never written. The standing order forbids putting either character into a
// file, and a harness whose whole job is catching them cannot be the thing that commits one.
const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);

function sha256(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------------------------
// THE PROSE NODE, AND THE GUARD THAT REFUSES A DRIFTED ONE.
// ---------------------------------------------------------------------------------------------
function readPin() {
  if (!fs.existsSync(PIN_FILE)) {
    throw new Error(
      '#36 letter eval: writer-node.pin.json is missing.\n' +
      '  It is the only thing that ties this harness to the node RUNNING ON THE BOX rather than to\n' +
      '  the one in the repo. Without it the eval would build happily against a prompt nothing runs.\n' +
      '  Recreate it with: node work/36-job-application-writer/config/check-writer-pin.js --write-pin'
    );
  }
  const pin = JSON.parse(fs.readFileSync(PIN_FILE, 'utf8'));
  if (typeof pin.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(pin.sha256)) {
    throw new Error('#36 letter eval: writer-node.pin.json carries no usable sha256.');
  }
  return pin;
}

function writerDef() {
  delete require.cache[require.resolve(WRITER_NODE_FILE)];
  return require(WRITER_NODE_FILE);
}

/*
 * The whole point of seat 8, mechanically. Returns the bytes of the live prose node, or throws.
 */
function writerJsCode() {
  const def = writerDef();
  if (def.name !== WRITER_NODE_NAME) {
    throw new Error(
      '#36 letter eval: nodes/29-build-writer-request.js is named ' + JSON.stringify(def.name) + '.\n' +
      '  That name is the voice-sync enrolment key AND the thing this harness copies. If it moved,\n' +
      '  decide where the prose node lives now and change both ends in the same edit.'
    );
  }
  const code = String((def.parameters || {}).jsCode || '');
  if (!code) throw new Error('#36 letter eval: the prose node has no jsCode to copy.');

  const pin = readPin();
  // THE SYNC DATE IS NORMALISED OUT BEFORE HASHING (2026-09-17). The voice block inside this node
  // is built at require time and its header is stamped with TODAY, so these bytes change at
  // midnight whether or not a word of soul.md moved, and this guard went red every calendar day
  // after the day it was pinned. Measured: on 2026-09-17 it refused against a 09-16 pin, both
  // 29841 characters, and putting the one date string back reproduced the pinned sha exactly.
  //
  // A daily false red is not a strict check, it is a check nobody reads. `comparableCode` lives in
  // scripts/lib/sync-n8n-voice.js next to the sync that writes the stamp, and it neutralises the
  // TEN CHARACTERS of the date and nothing else, so every real change to the prompt still refuses.
  const got = sha256(VOICE_LIB.comparableCode(code));
  if (got !== pin.sha256_comparable) {
    throw new Error(
      '#36 letter eval: REFUSING TO BUILD. The prose node has drifted from the pin.\n' +
      '    (the voice-block sync DATE is normalised out of both sides, so this is a real change to\n' +
      '     the prompt and not the daily re-stamp.)\n' +
      '    pinned (live box, ' + pin.captured_at + '): ' + pin.sha256_comparable + '  (' + pin.chars + ' chars)\n' +
      '    regenerated from the repo now  : ' + got + '  (' + code.length + ' chars)\n' +
      '  An eval assembled from the repo while the box runs something else measures nothing, and it\n' +
      '  would report 6/6 while doing it, which is worse than no eval.\n' +
      '  TWO legitimate causes, and the fix is the same for both:\n' +
      '    (a) soul.md changed, so the voice block baked into node 29 changed. The repo is ahead of\n' +
      '        the box. Rebuild the runtime workflow, or run the voice sync, THEN re-pin.\n' +
      '    (b) somebody edited the node in the n8n editor. That edit loses on the next rebuild\n' +
      '        anyway. Rebuild the runtime workflow, THEN re-pin.\n' +
      '  Re-pin with: node work/36-job-application-writer/config/check-writer-pin.js --write-pin\n' +
      '  It reads the LIVE node and refuses to move the pin unless the box and the repo already\n' +
      '  agree, so the pin can never be talked into blessing a hand edit.\n' +
      '  Do NOT edit writer-node.pin.json by hand and do NOT paste the prompt into nodes-eval/.'
    );
  }
  return code;
}

function writerFingerprint() {
  const code = writerJsCode();
  return { sha256: sha256(code), chars: code.length, node: WRITER_NODE_NAME };
}

// ---------------------------------------------------------------------------------------------
// THE SEED SHAPE CONTRACT, as a function rather than as a block inside one node.
//
// It lives here and not inline in 02-build-eval-cases.js for one reason: a guard that can only be
// reached by requiring the node it guards can only ever be seen PASSING. The Close-Out rule for
// guard class code says demonstrate the failure before reporting the pass, and config/
// test-letter-eval.js drives both of these with doctored input to do exactly that.
// ---------------------------------------------------------------------------------------------
const PROSE_NODE_READS = [
  ["j._kind !== 'pair'", 'the routing kind. A seed without it is carried past the prompt untouched and the case silently never runs.'],
  ['txt(j.master_key)', 'the lane key, which selects the approved figures and the work authorization line.'],
  ['txt(j.cv_text)', 'the CV the letter argues from. Without it the pair is held before any call.'],
  ['j.brief || {}', 'the recruiter brief: role, employer, must haves, ATS terms, objections, the verified quote.'],
  ['j.research || {}', 'the research result: the company line, the banned facts and the hook span.'],
  ['j.uc_context_required === true', 'whether beat two introduces the current employer in one line or two.'],
  ['brief.objections', 'the three objections, which the system block calls the job.'],
  ['brief.quote_verified === true', 'the gate on the posting span. A span that was not proved is not quotable.'],
  ['brief.right_to_work_country', 'the honest right to work paragraph.'],
  ['research.banned_facts', 'the negative list the letter may not use.'],
  ['research.hook', 'the second quotable span, from the employer own site.'],
];

function assertProseNodeReads(code) {
  const src = String(code || '');
  for (const [needle, why] of PROSE_NODE_READS) {
    if (src.indexOf(needle) === -1) {
      throw new Error(
        '#36 letter eval: the prose node no longer contains ' + JSON.stringify(needle) + '.\n' +
        '  That is ' + why + '\n' +
        '  Either the seeds in _eval.js are now feeding a field nothing reads, or the prose node grew an\n' +
        '  input this harness does not supply. Both make the eval measure a prompt the runtime never\n' +
        '  sees. Fix the seed shape, do not delete this assertion.'
      );
    }
  }
  return true;
}

function assertCasesWellFormed(seeds, expected) {
  const want = expected === undefined ? 6 : expected;
  if (!Array.isArray(seeds) || seeds.length !== want) {
    throw new Error('#36 letter eval: ' + (Array.isArray(seeds) ? seeds.length : 'no') + ' cases. The plan says ' + want + ', the Eval Summary asserts ' + want + '/' + want + ', and a harness that quietly runs fewer is a harness reporting a full pass on a smaller question.');
  }
  const ids = seeds.map((s) => s._case.id);
  const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dupe) throw new Error('#36 letter eval: two cases share the id ' + JSON.stringify(dupe) + '.');
  const primaries = seeds.map((s) => s._case.primary);
  const dupeP = primaries.find((p, i) => primaries.indexOf(p) !== i);
  if (dupeP) {
    throw new Error('#36 letter eval: two cases both name ' + JSON.stringify(dupeP) + ' as their primary check. Six cases exist to cover six different failures; two aimed at one leaves a gate with nothing pointed at it.');
  }
  for (const s of seeds) {
    if (!s.cv_text || s.cv_text.length < 400) throw new Error('#36 letter eval: case ' + s._case.id + ' carries no real CV text.');
    if (!Array.isArray(s.brief.objections) || !s.brief.objections.length) throw new Error('#36 letter eval: case ' + s._case.id + ' carries no objections, and the objections are what the letter is built to answer.');
  }

  // A seed that already contains the thing its case tests for makes the case vacuous in the one
  // direction that matters. Checked for the two that are pure characters; the rest are covered by
  // the offline suite, which runs the real scorer over the real seeds.
  const bad = seeds.filter((s) => {
    const spans = [s.brief.quote_line, s.research && s.research.hook && s.research.hook.quote].filter(Boolean).join(' ');
    return spans.indexOf(EN_DASH) !== -1 || spans.indexOf(EM_DASH) !== -1;
  });
  if (bad.length) {
    throw new Error(
      '#36 letter eval: ' + bad.map((s) => s._case.id).join(', ') + ' put a dash character inside a span the model is TOLD to quote verbatim.\n' +
      '  That is a genuine contradiction, not a bait: quote it and fail A1, drop it and disobey the\n' +
      '  skeleton. The eval would then go red for a defensible answer, and a red that is not a defect\n' +
      '  teaches people to scroll past the suite. Put the dashes in material the model is not asked to\n' +
      '  reproduce. (The collision itself is real and is a finding against the runtime, not a case.)'
    );
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// EVERY SOURCE THE LANE ALLOWS A FIGURE FROM IS ACTUALLY FED BY THE SEEDS.
//
// Lifting numberSources() closes half of divergence D2: the eval now asks the same question the lane
// asks. This closes the other half. numberSources() reads fields OFF THE PAIR, so an eval whose seeds
// leave one of those fields empty gets a shorter allowlist and goes red on a letter the lane accepts,
// which is D2 again wearing different clothes and with nothing pointed at it.
//
// So the field list is not restated here either: it is READ OUT of node 34's own function source,
// by finding every `pair.x`, `brief.x` and `research.x.y` path it mentions, and each one is then
// resolved against every seed. Add a source to node 34 and this refuses by name until the seeds
// carry it. That is the failure worth having: a build that stops rather than a harness that quietly
// measures a stricter rule than the lane runs.
// ---------------------------------------------------------------------------------------------
function numberSourcePaths() {
  // Comments are stripped FIRST. This guard reads code, and a sentence in a header explaining the
  // convention ("every field is spelled out as pair.x") is prose, not a field. Reading it as one
  // produced a build refusal naming a path called "x", which is a guard failing for a reason that
  // teaches the next person nothing.
  const src = lift('numberSources')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => { const at = l.indexOf('//'); return at === -1 ? l : l.slice(0, at); }).join('\n');
  const re = /\b(pair|brief|research)\.([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)/g;
  const seen = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    // `brief` and `research` inside that function are locals lifted off the pair, so their paths are
    // rooted at the pair for resolution purposes. `pair.brief` and `pair.research` fall out of the
    // same regex and resolve to the objects themselves, which is a real requirement: a seed with no
    // brief at all feeds nothing.
    const p = (m[1] === 'pair' ? '' : m[1] + '.') + m[2];
    const full = m[1] === 'pair' ? m[2] : p;
    if (seen.indexOf(full) === -1) seen.push(full);
  }
  if (!seen.length) {
    throw new Error(
      '#36 letter eval: node 34 numberSources() mentions no pair field at all, so this guard would\n' +
      '  accept any seed set. Read the function rather than deleting the check.'
    );
  }
  return seen;
}

function resolvePath(obj, dotted) {
  let cur = obj;
  for (const part of dotted.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
}

function assertSeedsFeedEveryNumberSource(seeds) {
  const paths = numberSourcePaths();
  for (const s of seeds || []) {
    for (const p of paths) {
      const v = resolvePath(s, p);
      const empty = v === undefined || v === null || v === false || v === '' ||
        (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
      if (empty) {
        throw new Error(
          '#36 letter eval: case ' + ((s._case && s._case.id) || '?') + ' leaves ' + JSON.stringify(p) + ' empty, and node 34\n' +
          '  numberSources() reads it as a place a figure in the letter may legitimately come from.\n' +
          '  An unfed source is a SHORTER allowlist here than on the box, so this eval would fail a\n' +
          '  letter the lane accepts. That is divergence D2, which is the reason this guard exists.\n' +
          '  Seed the field, do not delete the check and do not narrow numberSources() to suit a seed.'
        );
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// LIFTS. Bytes, not descriptions of bytes.
// ---------------------------------------------------------------------------------------------
function auditCfg() {
  delete require.cache[require.resolve(AUDIT_NODE_FILE)];
  const def = require(AUDIT_NODE_FILE);
  const code = String((def.parameters || {}).jsCode || '');
  const m = /\nconst AUDIT_CFG = (\{[\s\S]*?\});\n/.exec(code);
  if (!m) {
    throw new Error(
      '#36 letter eval: node 34 no longer bakes a top-level `const AUDIT_CFG = {...};`.\n' +
      '  The eval reads his name, his city, the greeting and the per-lane approved figures out of\n' +
      '  that object rather than holding its own copy, because a second copy of any of them is a\n' +
      '  second thing to keep in step and one of them is his name.'
    );
  }
  const cfg = JSON.parse(m[1]);
  for (const k of ['identity', 'approved_numbers', 'greeting', 'signoff']) {
    if (cfg[k] === undefined) throw new Error('#36 letter eval: AUDIT_CFG has no ' + k + '.');
  }
  return cfg;
}

/*
 * THE HELPERS THE SCORER RUNS ON. All five are node 34's own bytes.
 *
 * The first three have been here since seat 8: a word count or a number tokeniser that differs by one
 * rule between the eval and the audit produces an eval that passes a letter the lane would reject.
 *
 * sentenceBounds() and negatedAround() joined them on 2026-09-16, and they are the reason this
 * comment is longer than the function. Node 34 learned that a DENIAL of a deniable claim is not a
 * claim; the eval was scanning for the same claims with a bare substring test and knew nothing about
 * it, so letter eval execution 5428 failed C2 on the honest gap sentence the writer prompt ORDERS the
 * model to write. The two had genuinely diverged and only a case failing made it visible.
 *
 * numberSources() and numberAllowlist() joined them on 2026-09-16 (later the same day) for the same
 * reason, and that one is divergence D2. Node 34 allows a figure out of FOUR places: the approved
 * list, the verified quote line, the research hook and, since that morning, the fetched employer page
 * and the posting itself. This eval built its allowlist out of TWO. So a figure the lane deliberately
 * allows made the eval red, and the identical gap makes the eval GREEN the moment the two lists
 * differ the other way. The source list is node 34's bytes now, and the seed guard below is the other
 * half: a source the lane reads that the SEEDS do not carry would quietly narrow the eval instead.
 *
 * The pin already guarantees the eval runs the same PROMPT as the box. Nothing guaranteed it applied
 * the same CHECKS, and that gap produces a false GREEN exactly as easily as it produced that false
 * red. So the rules are LIFTED now rather than mirrored, and 07-case-metrics.js passes node 34's own
 * claim_denial map into it. The remaining manual coupling is flat()/spanIsIn(), which still live
 * inside node 34's closure and cannot be cut at column zero; that one is SAID in 07-case-metrics.js
 * rather than left to be found.
 */
const LIFT_NEEDLES = {
  normalise: '\\u2018',
  wordCount: 'split(/\\s+/).length',
  extractNumbers: 'is a product name',
  sentenceBounds: 'declared locally rather than read off',
  negatedAround: 'ONE implementation, two behaviours',
  numberSources: 'THE SINGLE DEFINITION of which text',
  numberAllowlist: 'One token to one PROVENANCE LABEL',
};
function lift(name) {
  return S2.bakedFunction('./34-audit-pair.js', name, LIFT_NEEDLES[name]);
}
function liftedHelpers() {
  return Object.keys(LIFT_NEEDLES).map(lift).join('\n');
}
// Node 06 needs ONE of them and none of the rest: it turns each sent case back into the labelled
// source list the scorer allows figures from. Lifting the whole set there would bake a claim scanner
// into a node that never scans a claim.
function liftedNumberSources() {
  return lift('numberSources');
}

function liftedExtractLetter() {
  return S2.bakedFunction('./33-parse-letter.js', 'extractLetter', 'the answer does not carry a letter boundary');
}

function rulesSource() {
  return VR.renderRuntimeSource();
}

// ---------------------------------------------------------------------------------------------
// THE CV EACH CASE ARGUES FROM.
//
// Derived, never pinned. A pinned id list would break the moment a master is amended, and this
// harness is not the place to discover that: the masters already have their own fixtures and their
// own amendment signal. So the selection is "every selectable block in document order until the
// one-page character ceiling would be crossed", which is deterministic, survives an amendment, and
// produces a CV of a realistic size (about 600 words on each lane as of 2026-09-16).
// ---------------------------------------------------------------------------------------------
const CV_CACHE = {};
function cvFor(masterKey) {
  if (CV_CACHE[masterKey]) return CV_CACHE[masterKey];
  const table = S2.assemblerTable(masterKey);
  const ids = Object.keys(table.byId).filter((id) => table.byId[id].role === 'selectable');
  let chosen = [];
  for (const id of ids) {
    const trial = chosen.concat([id]);
    let r;
    try { r = MASTER.assemble(masterKey, { ids: trial }); } catch (e) { break; }
    if (r.over_ceiling) break;
    chosen = trial;
  }
  const built = MASTER.assemble(masterKey, { ids: chosen });
  if (!built.text || built.text.length < 400) {
    throw new Error('#36 letter eval: the ' + masterKey + ' master assembled to ' + (built.text || '').length + ' characters, which is not a CV. Refusing to seed a case with it.');
  }
  CV_CACHE[masterKey] = { text: built.text, para_chars: built.para_chars, block_count: built.block_count };
  return CV_CACHE[masterKey];
}

// ---------------------------------------------------------------------------------------------
// THE RAW POSTING AND THE EMPLOYER PAGE, ASSEMBLED FROM THE CASE'S OWN MATERIAL.
//
// WHY THEY EXIST AT ALL (2026-09-16, divergence D2). Node 34 allows a figure in the letter out of
// four places, and two of them are `pair.ad_text` and `pair.site_text`: the posting as fetched and
// the employer page as fetched. The eval had neither field, so its allowlist was narrower than the
// lane's and a figure the lane deliberately permits came back red. Porting the SOURCE list without
// porting the SOURCE TEXT would have fixed nothing, because an empty field contributes nothing.
//
// WHY THEY ARE ASSEMBLED RATHER THAN WRITTEN. Every line below is composed from fields the case
// already seeds: the must haves, the nice to haves, the ATS terms, the objections with their
// evidence, and the two quotable spans. That is a deliberate constraint, not laziness. A hand
// written posting could carry a figure the case author never seeded, and then a case would pass or
// fail on a number nobody can find by reading the case. Assembling it means the ad can only ever
// contain what the case already put in front of the model, plus the employer's own framing of it.
//
// WHAT IS DELIBERATELY LEFT OUT. `research.banned_facts` never reaches either field. Those are the
// things the letter may NOT use, several of them are about a named person, and putting them in
// site_text would license their figures through A8 while the rest of the audit still forbids the
// fact. Left out with the reason stated rather than left out quietly.
//
// THE PROMPT IS UNTOUCHED BY THIS. Node 29 builds the writer request out of brief and research and
// never reads ad_text or site_text, so seeding them changes the AUDIT inputs and not one byte of
// what the model is shown. That is exactly the runtime shape: the lane allows a figure out of a
// posting the model was never handed.
// ---------------------------------------------------------------------------------------------
function adTextFor(c) {
  const b = c.brief;
  const NL = String.fromCharCode(10);
  const lines = [];
  lines.push(b.role_title + ' at ' + b.employer);
  lines.push(b.employer_country + '. ' + b.work_type + '. ' + b.employment_type + '. ' + b.seniority + ' level.');
  lines.push('');
  lines.push('What you will need');
  for (const m of b.must_have || []) lines.push('- ' + m);
  lines.push('');
  lines.push('Nice to have');
  for (const m of b.nice_to_have || []) lines.push('- ' + m);
  lines.push('');
  lines.push('What the hiring team will be asking');
  for (const o of b.objections || []) {
    lines.push('- ' + o.objection);
    if (o.evidence) lines.push('  ' + o.evidence);
  }
  lines.push('');
  // The verified span goes in VERBATIM, because A15 re-proves it as a substring of the posting. A
  // posting that did not contain its own quote line would fail the lane on a span the brief told the
  // letter it may quote, which is a check arguing with the brief.
  if (b.quote_verified === true && b.quote_line) {
    lines.push('From the team: ' + b.quote_line);
    lines.push('');
  }
  lines.push('Keywords: ' + (b.ats_terms || []).join(', '));
  return lines.join(NL);
}

function siteTextFor(c) {
  // Only material that stands in for the EMPLOYER'S OWN PAGE: the company line, which is the research
  // stage's one sentence about what the company is, and the hook span, which is verbatim page text by
  // definition. `hook.why` is deliberately NOT here: that is the research model's argument for why the
  // span is useful, it is OUR reasoning rather than the employer's prose, and site_text licenses
  // figures through A8. A number that entered the allowlist from our own commentary would be an
  // invented figure wearing the employer's label.
  const r = c.research || {};
  const NL = String.fromCharCode(10);
  const lines = [];
  if (r.company_line) lines.push(r.company_line);
  if (r.hook && r.hook.quote) {
    lines.push('');
    lines.push(r.hook.quote);
  }
  return lines.join(NL);
}

// ---------------------------------------------------------------------------------------------
// THE SIX CASES.
//
// Every one of them BAITS a specific failure that the runtime gates on and that a human reading the
// letter would not reliably catch. None of them is a trick: in every case there is a correct answer
// that satisfies every instruction the prose node gives, so a FAIL is a real defect and never an
// argument about which rule wins. That constraint is load bearing and it cost two designs.
//
// THE ONE PLACE IT BIT. The obvious dash bait is to put a dash inside the span the model is TOLD to
// quote verbatim. That is a genuine contradiction (quote it and fail A1, drop it and disobey the
// skeleton) and it would make this eval red for a defensible answer, which the plan's own
// carry-over 5 names as worse than having no test. So every quotable span below is clean, and the
// bait sits in the material the model is NOT told to reproduce. The collision is real and it is
// reported as a finding against the RUNTIME, not smuggled in here as a red.
//
// `primary` names the check the case exists for. The metrics node runs the WHOLE set on every case
// anyway, exactly as the runtime audit does, so a letter that dodges its own bait and then trips
// something else still fails. Reporting the primary separately is what makes a failure legible.
// ---------------------------------------------------------------------------------------------
const CASES = [
  {
    id: 'C1-dash-bait',
    lane: 'ai',
    primary: 'dashes',
    seeds: 'a posting whose every free text field is punctuated with en dashes and em dashes, so the model is pulled into mirroring the register it was handed. Both quotable spans are deliberately dash free, so nothing here asks the model to reproduce a dash.',
    pass: 'zero U+2013 and zero U+2014 in the letter. A1.letter, and Shaheen 2026-08-20: NEVER AGAIN, both characters.',
    brief: {
      role_title: 'Automation Engineer, Internal Tooling',
      employer: 'Kalmar Freight Systems',
      employer_country: 'Sweden',
      seniority: 'senior',
      employment_type: 'permanent',
      work_type: 'hybrid',
      must_have: [
        'workflow automation ' + EM_DASH + ' n8n, Zapier or similar',
        'API integration work ' + EN_DASH + ' REST, webhooks, OAuth',
        'SQL ' + EM_DASH + ' comfortable writing it daily',
      ],
      nice_to_have: ['Python', 'Docker ' + EN_DASH + ' basic', 'BI reporting ' + EM_DASH + ' any tool'],
      ats_terms: ['n8n', 'automation', 'API', 'SQL', 'integration ' + EN_DASH + ' internal systems'],
      objections: [
        { objection: 'no logistics domain experience ' + EM_DASH + ' the whole stack here is freight', evidence: 'We move 40 trucks a day ' + EN_DASH + ' the tooling is built around that.' },
        { objection: 'the title reads BI, not automation ' + EN_DASH + ' is this a career pivot', evidence: 'This role is engineering first ' + EM_DASH + ' reporting is a side effect.' },
        { objection: 'hybrid means two days in Kalmar ' + EM_DASH + ' that is a commute', evidence: 'Tuesdays and Thursdays on site ' + EN_DASH + ' non negotiable.' },
      ],
      quote_verified: true,
      quote_line: 'we would rather ship one workflow that nobody has to babysit than five that need a person watching them',
      right_to_work_country: '',
    },
    research: {
      company_line: 'A Swedish freight operator running its own dispatch and billing stack ' + EN_DASH + ' about 120 staff.',
      banned_facts: [
        'the company was sued by a former supplier in 2024 ' + EM_DASH + ' settled out of court',
        'Glassdoor rates the engineering team 2.9 ' + EN_DASH + ' mostly about on call',
      ],
      hook: {
        quote: 'every integration we own is documented before it goes live, no exceptions',
        url: 'https://example.invalid/kalmar/engineering',
        why: 'it is the only sentence on their engineering page that states a rule rather than a value',
      },
    },
    uc_context_required: false,
  },

  {
    id: 'C2-banned-claim-bait',
    lane: 'ai',
    primary: 'claim:typescript',
    seeds: 'an AI posting that demands TypeScript, JavaScript, a vector database and embeddings in the must haves, repeats them in the ATS terms, and puts all three into the screener objections, so mirroring the ad is the natural move and the overlap rule points straight at it.',
    pass: 'zero hits on claim:typescript, claim:javascript and claim:vector-rag. He writes neither language, both were pruned from the master on his own instruction (JS 2026-07-25, TS 2026-08-19), and retrieval here is full text search plus tool calling. A6 and A10.',
    brief: {
      role_title: 'AI Engineer, Agent Platform',
      employer: 'Vertex Robotics',
      employer_country: 'Germany',
      seniority: 'senior',
      employment_type: 'permanent',
      work_type: 'remote',
      must_have: [
        'strong TypeScript, this is a TypeScript shop end to end',
        'JavaScript fundamentals, we interview on them',
        'a production vector database: Pinecone, Weaviate or pgvector',
        'embeddings and retrieval augmented generation at scale',
      ],
      nice_to_have: ['Python', 'LLM tool calling', 'Node.js'],
      ats_terms: ['TypeScript', 'JavaScript', 'vector database', 'embeddings', 'RAG', 'agents', 'LLM'],
      objections: [
        { objection: 'the CV names no TypeScript anywhere and this team writes TypeScript daily', evidence: 'Our entire agent runtime is TypeScript.' },
        { objection: 'no JavaScript on the CV either, so the front of the stack is unproven', evidence: 'You will be in the same repo as the web team.' },
        { objection: 'no vector database or embedding work shown, and retrieval is the core of the product', evidence: 'Retrieval quality is the product.' },
      ],
      quote_verified: true,
      quote_line: 'we hire for judgement about systems, and we teach the stack',
      right_to_work_country: '',
    },
    research: {
      company_line: 'A German robotics company building an agent layer over its own fleet telemetry.',
      banned_facts: ['a funding round is reportedly closing next month', 'two of the three founders left the previous company after a dispute'],
      hook: {
        quote: 'the hardest part was never the model, it was knowing when to stop trusting it',
        url: 'https://example.invalid/vertex/engineering-blog',
        why: 'it is their own sentence about restraint, which is the argument this candidate can actually make',
      },
    },
    uc_context_required: true,
  },

  {
    id: 'C3-ai-tell-bait',
    lane: 'ai',
    primary: 'tells',
    seeds: 'a posting written entirely in corporate AI slop. The company line, every objection and the nice to haves are stuffed with leverage, seamless, delve, furthermore, underscore, navigate and it is important to note. Register mirroring is the single most reliable way to make a language model produce a tell. Both quotable spans are tell free, so nothing asks the model to reproduce one.',
    pass: 'none of the reconciled AI tells appears in the letter. A2, and the list is the one reconciled from the live eval, the grader rubric PV2 and soul.md Detection-proofing rules 3 and 6.',
    brief: {
      role_title: 'Senior Automation Engineer',
      employer: 'Helios Data Group',
      employer_country: 'Netherlands',
      seniority: 'senior',
      employment_type: 'permanent',
      work_type: 'remote',
      must_have: [
        'ability to leverage modern automation platforms at enterprise scale',
        'a seamless approach to integrating disparate data sources',
        'willingness to delve into legacy systems and navigate ambiguity',
      ],
      nice_to_have: [
        'experience that underscores a commitment to operational excellence',
        'a track record that serves as a testament to cross functional delivery',
      ],
      ats_terms: ['automation', 'integration', 'data pipelines', 'stakeholder management'],
      objections: [
        { objection: 'it is important to note that the CV does not evidence enterprise scale delivery', evidence: 'Furthermore, our estate spans four business units.' },
        { objection: 'arguably the experience is reporting led rather than engineering led', evidence: 'Moreover, the role is hands on from week one.' },
        { objection: 'the candidate would need to navigate a seamless transition into a mature platform team', evidence: 'Additionally, onboarding is self directed.' },
      ],
      quote_verified: true,
      quote_line: 'we would rather someone say I do not know than guess in a stand up',
      right_to_work_country: '',
    },
    research: {
      company_line: 'A Dutch analytics consultancy that runs data platforms for retail clients.',
      banned_facts: ['the automation practice was cut from 30 people to 18 last year'],
      hook: {
        quote: 'our worst outages all started with a change nobody wrote down',
        url: 'https://example.invalid/helios/how-we-work',
        why: 'their own sentence about documentation, which the CV can answer with real evidence',
      },
    },
    uc_context_required: true,
  },

  {
    id: 'C4-word-band-bait',
    lane: 'ai',
    primary: 'words',
    seeds: 'maximum mandatory content in one case. Three long objections that each need a real answer, uc_context_required true so beat two costs two lines instead of one, a right to work country the opener has to address honestly, two quotable spans, and long must have, nice to have and ATS lists. Every one of those adds a sentence the skeleton requires, and the skeleton plus the band is the only place in this prompt where two instructions pull against each other by design.',
    pass: 'the letter is between 100 and 280 words. A3, the same word count the CLI, the runtime audit and the live Writer Voice Eval all use.',
    brief: {
      role_title: 'Staff Engineer, Workflow Automation and Internal AI Tooling',
      employer: 'Ardent Health Analytics',
      employer_country: 'United States',
      seniority: 'staff',
      employment_type: 'permanent',
      work_type: 'remote',
      must_have: [
        'seven or more years building internal tooling',
        'production LLM integration with real guardrails',
        'workflow orchestration at scale',
        'SQL and data modelling',
        'clinical or regulated data handling',
        'stakeholder work with non technical clinical staff',
        'on call ownership of what you ship',
      ],
      nice_to_have: ['Power BI or Tableau', 'Python', 'Docker', 'HL7 or FHIR', 'cost modelling for model spend'],
      ats_terms: ['workflow automation', 'LLM', 'guardrails', 'SQL', 'data modelling', 'HIPAA', 'internal tooling', 'orchestration'],
      objections: [
        { objection: 'no healthcare or regulated data experience at all, and every system here touches patient data under HIPAA', evidence: 'Every service in our estate is in scope for HIPAA and for an annual external audit.' },
        { objection: 'the CV reads as a single employer for most of the last decade, so breadth across engineering cultures is unproven', evidence: 'You would be the fourth engineer on a team that has rebuilt itself twice in three years.' },
        { objection: 'the role is US based and the time zone overlap from Europe is four hours at best', evidence: 'Core hours are 10:00 to 15:00 Eastern and the team ships together.' },
      ],
      quote_verified: true,
      quote_line: 'we do not ship anything a clinician cannot explain to a patient',
      right_to_work_country: 'the United States',
    },
    research: {
      company_line: 'A US healthcare analytics company building internal tooling for hospital operations teams.',
      banned_facts: [
        'a hiring freeze was reported in the local press in March',
        'the CTO joined from a competitor eight weeks ago',
      ],
      hook: {
        quote: 'every automation we run has a named owner and a written reason to exist',
        url: 'https://example.invalid/ardent/engineering-principles',
        why: 'their own principle, and it is the one this candidate can answer with evidence rather than with enthusiasm',
      },
    },
    uc_context_required: true,
  },

  {
    id: 'C5-pronoun-bait',
    lane: 'powerbi',
    primary: 'pronouns',
    seeds: 'a posting that names a hiring manager and a departing postholder and refers to both with he, him, his, she and her all the way through the objections and the company line. Echoing the people in the ad back at them is ordinary, competent letter writing everywhere except here.',
    pass: 'zero gendered pronouns in the letter. soul.md, Shaheen 2026-07-28, verbatim: I do not want to give Alex a gender, I want you to not use HE/HIM at all. Apply that. The rule is written against ALL prose in his name, and A5.letter enforces it with no exception for a third party named in a job ad.',
    brief: {
      role_title: 'Senior Power BI Developer',
      employer: 'Brantwood Retail Group',
      employer_country: 'Sweden',
      seniority: 'senior',
      employment_type: 'permanent',
      work_type: 'hybrid',
      must_have: ['Power BI semantic models', 'DAX', 'row level security', 'workspace governance'],
      nice_to_have: ['Fabric', 'SQL Server', 'retail domain'],
      ats_terms: ['Power BI', 'DAX', 'semantic model', 'row level security', 'governance'],
      objections: [
        { objection: 'Anna Nordin runs this team and she wants someone who can own the semantic model alone from day one', evidence: 'She has said she does not want to review every measure.' },
        { objection: 'the previous developer left in June and he was the only person who understood the RLS setup, so the handover is cold', evidence: 'His documentation is thin and nobody has picked it up since he went.' },
        { objection: 'Anna has been burned before by a consultant who promised governance and delivered dashboards, so she will read this letter looking for the difference', evidence: 'Her brief to us was governance first, visuals second.' },
      ],
      quote_verified: true,
      quote_line: 'we want the model owned, not the reports decorated',
      right_to_work_country: '',
    },
    research: {
      company_line: 'A Swedish retail group running store and e commerce reporting off one Power BI tenant.',
      banned_facts: ['the analytics lead before Anna was let go after a failed migration'],
      hook: {
        quote: 'one model, one definition of a sale, everywhere in the business',
        url: 'https://example.invalid/brantwood/data',
        why: 'it is their own statement of the exact problem this candidate has solved at platform level',
      },
    },
    uc_context_required: false,
  },

  {
    id: 'C6-invented-number-bait',
    lane: 'powerbi',
    primary: 'numbers',
    seeds: 'three objections that each demand a figure about HIM: what share of an estate he has migrated, what he saved his own employer, how many people he has managed. The employer own figures are all present, in the objections and in the assembled posting, and since 2026-09-16 the lane deliberately ALLOWS the letter to quote them back. So they are not the bait any more. The bait is that none of the three answers exists anywhere: not on his approved list, not in the posting, not on the employer page. The only way to answer a demand for his number with a number is to invent one.',
    pass: 'no figure in the letter that is missing from BOTH his approved list and every piece of employer text this run holds. REDESIGNED 2026-09-16 (divergence D2): until that day this case asserted that the employer own figures must NOT appear, and that morning the lane started allowing exactly that, because the skeleton REQUIRES beat three to quote the employer and failing a letter for a number inside a sentence it was told to reproduce is a check arguing with the brief. A case whose assertion outlives the rule it came from is how a suite rots, so the assertion moved to the danger that is still real: a figure attached to HIM that he never approved. STATED LIMIT, because it is a property of the lane rule and not of this case: A8 is token scoped, so a letter that borrows an employer figure and pins it to him passes both paths. That is a real gap in A8 and it is named here rather than papered over with an eval-only rule the box does not run.',
    brief: {
      role_title: 'BI Platform Lead',
      employer: 'Callaghan Industrial',
      employer_country: 'Ireland',
      seniority: 'lead',
      employment_type: 'permanent',
      work_type: 'remote',
      must_have: ['Power BI platform ownership', 'capacity and cost management', 'DAX performance work', 'governance at scale'],
      nice_to_have: ['Fabric capacity', 'Azure', 'manufacturing domain'],
      ats_terms: ['Power BI', 'platform', 'capacity', 'DAX', 'governance', 'cost'],
      // Every employer figure below stays exactly where it was. They are now LICENSED by the lane,
      // through the objections, through the assembled posting and through the verified span, so a
      // letter that quotes them back is a PASS. What each objection adds is a demand for a figure
      // about HIM, and no such figure exists in his master, in this posting or on this employer
      // page. That gap is the bait, and it is the only thing left that can honestly fail A8.
      objections: [
        { objection: 'the CV does not say how many users the platform actually serves, and we need someone who has carried real scale', evidence: 'Our estate is 940 named users across 27 workspaces and it grows 15% a year. Tell us what share of a platform that size he has migrated himself, as a percentage.' },
        { objection: 'no figure anywhere on cost saved or time saved, and the business case for this role is a 35% reduction in reporting spend', evidence: 'We spent 1.4 million euro on reporting last year and the board wants that at 900 thousand. We want the euro figure or the percentage he took out of his own employer spend.' },
        { objection: 'no evidence of leading people, and this role picks up a team of 9 within six months', evidence: 'Three analysts today, nine by Q3. How many people has he managed directly, and for how many months.' },
      ],
      quote_verified: true,
      quote_line: 'we would rather have 20 reports people trust than 200 nobody opens',
      right_to_work_country: '',
    },
    research: {
      company_line: 'An Irish industrial manufacturer consolidating reporting onto one Power BI tenant.',
      banned_facts: ['the finance director is understood to be leaving in the autumn'],
      hook: {
        quote: 'a number on a dashboard is a promise, and we have broken a few',
        url: 'https://example.invalid/callaghan/data-strategy',
        why: 'their own admission, which is the opening for an argument about definitions rather than about visuals',
      },
    },
    uc_context_required: true,
  },
];

/*
 * The seeded items, in the exact shape Build Writer Request reads. This is the contract the harness
 * has to honour and it is asserted rather than assumed in 02-build-eval-cases.js: the node refuses
 * to build if the prose node stops reading one of these fields.
 */
function caseSeeds() {
  const cfg = auditCfg();
  return CASES.map((c, i) => {
    const cv = cvFor(c.lane);
    if (!cfg.approved_numbers[c.lane]) {
      throw new Error('#36 letter eval: case ' + c.id + ' names lane ' + JSON.stringify(c.lane) + ', which node 34 has no approved figures for. The lanes are ' + Object.keys(cfg.approved_numbers).join(', ') + '.');
    }
    return {
      _kind: 'pair',
      _case: {
        n: i + 1,
        id: c.id,
        lane: c.lane,
        primary: c.primary,
        seeds: c.seeds,
        pass: c.pass,
      },
      master_key: c.lane,
      cv_text: cv.text,
      brief: c.brief,
      research: c.research,
      // The two AUDIT-scope fields. Not read by the prompt, read by A8 and A15, assembled from this
      // case's own employer material. See the note above adTextFor().
      ad_text: adTextFor(c),
      site_text: siteTextFor(c),
      uc_context_required: c.uc_context_required === true,
    };
  });
}

module.exports = {
  WRITER_NODE_NAME, PIN_FILE,
  EN_DASH, EM_DASH,
  sha256,
  readPin, writerJsCode, writerFingerprint,
  PROSE_NODE_READS, assertProseNodeReads, assertCasesWellFormed,
  numberSourcePaths, assertSeedsFeedEveryNumberSource,
  auditCfg, liftedHelpers, liftedNumberSources, liftedExtractLetter, rulesSource,
  cvFor, CASES, caseSeeds, adTextFor, siteTextFor,
};

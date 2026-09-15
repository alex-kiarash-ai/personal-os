'use strict';
/*
 * 24-build-select-request.js - "Build Select Request". Shows the selector the master it may choose
 * from, and asks it for IDS.
 *
 * =============================================================================================
 * 1. THIS IS THE NODE WHERE THE FREEZE STOPS BEING A RULE AND BECOMES A SHAPE.
 * =============================================================================================
 * Shaheen's AI CV master is FROZEN. His words, 2026-08-19: "Do not change anything (not a word or a
 * color or a font) Exact as it is." Tailoring means SELECT, REORDER and keyword-mirror his
 * sentences, never rewrite them.
 *
 * The engines this lane replaces enforced that by asking a model nicely and checking the output
 * afterwards. That is a filter, and a filter has a false-negative rate: the check has to be able to
 * recognise a rewrite, and the rewrites that survive are exactly the ones it could not.
 *
 * Here the model is never given the chance. It is shown the master as a list of blocks with ids, and
 * the ONLY thing it can return that has any effect is a list of those ids. Assemble CV looks every
 * id up and emits the master string. A model that hallucinates a better bullet produces an id that
 * does not resolve, and an id that does not resolve is a refusal, not a paragraph.
 *
 * That is out-of-the-box item 1, and it is why decision D8's rejected proof arrives free: D8
 * declined a mechanical sentence-level frozen-CV proof as too much machinery, and this shape gives
 * one as a side effect of how the selection is expressed.
 *
 * =============================================================================================
 * 2. WHAT THE SELECTOR IS AND IS NOT SHOWN.
 * =============================================================================================
 * It is shown `_master.modelView(lane)`: every block, its id, its section and group, and its
 * character count. The character count is there so the selector can budget against the one-page
 * ceiling rather than guess at it, which is the difference between a selection that fits and a
 * selection the assembler has to cut down.
 *
 * It is NOT shown contact details. modelView redacts any block carrying an email, a phone or a
 * LinkedIn url, and it THROWS rather than hands a selector a phone number. The selector has no use
 * for one when it is choosing which bullet to keep, and those blocks are forced onto the CV anyway.
 * The redaction is asserted twice over in _master.js: zero contact hits in the model view, and MORE
 * than zero in the print view, because otherwise the first assertion is vacuously true.
 *
 * =============================================================================================
 * 3. THE FOUR THINGS THE SELECTOR RETURNS, AND WHY EACH ONE EXISTS.
 * =============================================================================================
 *   cv_block_ids        the selection, in the order the blocks should read inside their group.
 *   section_order       optional. Document order otherwise.
 *   drop_order          the ids it is willing to lose, least valuable first. This is design defect
 *                       3 from the plan review: a "tighten and retry" loop would be a second paid
 *                       call to answer a question the selector can answer in the first one. The
 *                       assembler drops down this list deterministically until the page fits.
 *   objection_coverage  one entry per objection the recruiter seat raised, naming the block that
 *                       answers it or admitting that nothing does. This is the counterparty seat
 *                       becoming a runtime stage rather than a paragraph in a plan: the three
 *                       reasons a screener would bin the CV are answered with evidence, or the
 *                       README says plainly that they were not.
 *
 * And one more, which is the single exception in this seat:
 *   bridge_line         at most ONE sentence beginning "Ready to ", for a requirement the master
 *                       genuinely does not cover. See note 5.
 *
 * =============================================================================================
 * 4. THE CACHE BREAKPOINT, AND WHY IT MATTERS MORE HERE THAN ANYWHERE ELSE IN THE WORKFLOW.
 * =============================================================================================
 * The system block for this stage is the whole master, thousands of tokens of it, and it is
 * IDENTICAL for every pair on the same lane in the same run. Ten pairs on one lane is one cache
 * write and nine cache reads at a tenth of the input price, or ten full-price copies of his CV if
 * the breakpoint silently fails.
 *
 * It fails silently below the model minimum: no error, just cache_creation_input_tokens 0 on every
 * call. The minimum on claude-opus-5 is 512 tokens, which this block clears many times over, and the
 * build asserts it per lane anyway, because the assertion costs nothing and the failure is invisible.
 *
 * BYTE IDENTITY IS ASSERTED AT BUILD TIME, not hoped for. Caching is a prefix match, so one byte of
 * drift anywhere in the block invalidates the whole prefix for the rest of the run. The block is a
 * baked constant, which makes it identical by construction; the build additionally renders it twice
 * and compares, because "the same function called twice returns the same string" is the kind of
 * thing that stays true until a map iteration order or a timestamp creeps in.
 *
 * =============================================================================================
 * 5. THE BRIDGE LINE. THE ONE PLACE MODEL PROSE MAY REACH A CV, AND EVERY RAIL ON IT.
 * =============================================================================================
 * The approved plan allows it: the selector "picks and orders blocks of the frozen master BY ID and
 * may add one 'ready to' line". writer-notes-ai.md is where it comes from: "If a job ad needs
 * something the master does not say, bridge it honestly as 'ready to' rather than claiming it, and
 * keep the bridge in his register."
 *
 * It is a real hole in an otherwise airtight design, and it is worth being honest about that rather
 * than quiet. What keeps it from being one:
 *   it is structurally distinct. It has no block id, it is carried in its own field all the way
 *     through, and the assembler emits it from a different code path from the one that emits master
 *     strings. Nothing can mistake it for his text and nothing can turn it into a block.
 *   it must open with "Ready to ", which is not a phrasing anything else on the CV uses, so a reader
 *     can see it for what it is.
 *   it may contain NO DIGITS. Every number on a CV is a claim, and this is the one line that did not
 *     come from a document Shaheen approved.
 *   it is one sentence, capped, dash-free, pronoun-free, and it is scanned against the same banned
 *     claims the letter audit uses (TypeScript, JavaScript, bureau, vector RAG, the job pipelines,
 *     roles-processed counts, the voice project).
 *   Assemble CV enforces every one of those and DROPS the line if any fails, recording why. A
 *     malformed bridge costs a sentence; it never costs the CV.
 *   it is reported in `cv_selection.bridge_line` so the render seat's README names it, which is what
 *     the seat brief asks for: a human reading the folder can see exactly which sentence was not
 *     his.
 *
 * =============================================================================================
 * 6. PRE-FLIGHT RUNS HERE, AND IT IS FAIL-CLOSED.
 * =============================================================================================
 * This node bakes master text into a workflow. If the AI mirror is stale against the frozen docx,
 * every CV this lane ships is built from a version of his text he has already replaced, and looks
 * perfectly healthy doing it. `_master.preflight()` is the only thing that can see that, so it is
 * RUN at build time rather than assumed, and it fails closed when python is absent, with one loud
 * deliberate override (ALEX_ALLOW_NO_PYTHON=1) following the gitleaks precedent in the root
 * constitution. It also re-proves no dash and no TypeScript or JavaScript in either master.
 */

const LN = require('./_lane');
const S2 = require('./_stage2');
const MASTER = require('./_master');

const NODE_NAME = 'Build Select Request';

const MODEL = LN.STAGE_MODELS.select;
const MIN_CACHE_TOKENS = LN.MIN_CACHEABLE_TOKENS[MODEL];
const MASTER_KEYS = S2.masterKeys();
const PARA_CHARS_MAX = S2.PARA_CHAR_CEILING;

// Read from the intake cost model rather than chosen again here, so the guard that refuses an
// unaffordable run and the node that spends the money cannot disagree.
const SELECT_MAX_TOKENS = S2.readSourceNumber(
  './05-build-candidates.js',
  /\{\s*stage:\s*'select',[^}]*out_tokens:\s*(\d+)\s*\}/,
  "the select row of COST_MODEL (its out_tokens is this node's max_tokens)"
);

const BRIDGE_PREFIX = 'Ready to ';
const BRIDGE_MAX_CHARS = 160;

// ---------------------------------------------------------------------------------------------
// THE RUBRIC. Generic English, no master text, no personal data: this file is tracked and the repo
// is public. The block LISTING is appended at build time from the gitignored vault.
// ---------------------------------------------------------------------------------------------
function rubric(laneLabel) {
  return [
    'You are an ATS selection editor with fifteen years of experience preparing senior technical CVs',
    'for screening. You have just been handed one candidate master CV, broken into numbered blocks,',
    'and one job posting that a senior recruiter has already read and objected to. Your job is to',
    'choose which blocks of that master go on the one page this candidate gets, and in what order.',
    '',
    'THE ONE RULE THAT DEFINES THIS TASK. You do not write. You SELECT. This CV is assembled from the',
    'exact strings below, looked up by id, and nothing you type as prose reaches the page. If you',
    'return a rewritten, improved, shortened or combined version of a block, it is discarded, and the',
    'block is simply missing from the CV. The candidate wrote every one of these sentences and they',
    'are frozen: same words, same tense, same voice. Your judgement is in WHICH of them appear and in',
    'WHAT ORDER, and that is a real and difficult job, which is why it is the one you are given.',
    '',
    'THE SELECTION RULE. Choose the intersection of what this candidate HAS and what this posting',
    'ASKS FOR. That intersection is the whole criterion. It is a positive rule and never a',
    'subtractive one: you are not removing weak material, you are choosing the blocks that answer',
    'this posting. Anything outside the intersection does not earn a line on one page, however good',
    'it is.',
    '',
    'THE THREE OBJECTIONS. The recruiter who read this posting listed the three strongest reasons a',
    'screener would move this application to the no pile. They are in the user message. For each one,',
    'name the block you chose that answers it, or say plainly that nothing in this master does. Do',
    'not pretend a block answers an objection it does not. An honest "nothing here answers this" is',
    'worth more than a stretched match, because a human reads that line afterwards and decides what',
    'to do about it.',
    '',
    'THE ONE PAGE CEILING. The assembled CV must fit one page, and the measured ceiling is',
    String(PARA_CHARS_MAX) + ' characters of paragraph text, counting every selected block except headings.',
    'Each block below shows its character count. Budget against them. A selection that does not fit',
    'is cut down by the assembler using your drop_order, and a selection that still does not fit after',
    'every drop DOES NOT SHIP AT ALL: it is held for the candidate to look at by hand. Coming in under',
    'the ceiling is part of the job, not a formatting detail.',
    '',
    'drop_order IS NOT OPTIONAL. List the ids you chose that you would give up if the page is too',
    'full, LEAST VALUABLE FIRST. The assembler drops them one at a time, in your order, until the page',
    'fits. This is how you keep control of what is lost: an id that is not on this list will never be',
    'dropped, and if the ones on it run out before the page fits, nothing ships. Put most of your',
    'selection on it. The blocks you leave off are the ones you are saying must be on the page or the',
    'CV is not worth sending.',
    '',
    'WHAT YOU MAY NOT CHOOSE. Section headings and horizontal rules are emitted automatically around',
    'whatever you select, so they are not in the list below and an id that names one is refused. The',
    'date line under a role rides with its group automatically. Blocks marked MANDATORY are on every',
    'CV whether you ask for them or not; you may list them, and leaving them out changes nothing.',
    '',
    'THE BRIDGE LINE, and it is usually null. If the posting requires something real that this master',
    'genuinely does not cover anywhere, you may return ONE sentence that begins with the exact words',
    '"' + BRIDGE_PREFIX.trim() + ' " and states honestly that the candidate is ready to do it. It is the only sentence',
    'on the whole CV that is not his own writing, so it is held to hard rules and it is DISCARDED if',
    'it breaks any of them:',
    '  it begins with "' + BRIDGE_PREFIX.trim() + ' " and is ONE sentence ending in a full stop',
    '  it is at most ' + String(BRIDGE_MAX_CHARS) + ' characters',
    '  it contains NO DIGITS of any kind. Every number on a CV is a claim, and this is the one line',
    '    that did not come from a document the candidate approved',
    '  it claims no experience, no years, no tools used, no results. Ready to is a statement about',
    '    willingness and nothing else',
    '  plain present tense, short words, no hype, no em dash and no en dash',
    '  it never names TypeScript or JavaScript, which this candidate does not write',
    'If the master already covers the requirement, even partly, return null. Null is the normal',
    'answer. A bridge line is for a genuine, visible gap that a screener would notice, not for',
    'polish.',
    '',
    'OUTPUT. Return ONE JSON object and nothing else. No prose before it, no prose after it, no',
    'markdown fence.',
    '',
    '  {',
    '    "cv_block_ids": ["<id>", "<id>", ...],',
    '    "section_order": ["<section key>", ...],',
    '    "drop_order": ["<id>", "<id>", ...],',
    '    "objection_coverage": [{"objection": "<the objection, copied>", "block_id": "<id or null>",',
    '                            "note": "<one short sentence>"}],',
    '    "bridge_line": "<sentence>" or null,',
    '    "why": "<two sentences at most, what this selection is arguing>"',
    '  }',
    '',
    'cv_block_ids is the order blocks read INSIDE their group. Groups and sections keep document',
    'order, so you cannot put an older role above a newer one by accident, and you do not need to try.',
    'section_order may reorder whole sections; leave it out for document order.',
    '',
    'THE MASTER FOLLOWS. This is the ' + laneLabel + '. Every id is exact: copy it character for',
    'character, including the part after the at sign, which is a content fingerprint. An id you',
    'change, shorten or invent will not resolve, and an id that does not resolve stops the whole CV.',
  ].join('\n');
}

// The block listing. One line per block: id, kind, character count, and the text. Grouped the way
// the document groups it so the selector can see which role a bullet belongs to.
function listing(masterKey) {
  const v = S2.selectorView(masterKey);
  const mandatory = {};
  for (const b of v.mandatory) mandatory[b.id] = true;

  const lines = [];
  const seen = {};
  const emit = (b) => {
    lines.push('  ' + b.id + '  [' + b.kind + ', ' + b.chars + ' chars' + (mandatory[b.id] ? ', MANDATORY' : '') + ']');
    lines.push('      ' + b.text);
  };
  for (const g of v.groups) {
    const inGroup = v.mandatory.concat(v.selectable).filter((b) => b.section === g.section && b.group === g.group);
    if (!inGroup.length) continue;
    const head = 'SECTION ' + g.section + (g.section_title ? ' (' + g.section_title + ')' : '') +
      (g.group === 'x' ? '' : '  GROUP ' + g.group + (g.group_title ? ': ' + g.group_title : ''));
    lines.push('');
    lines.push(head);
    for (const b of inGroup) {
      if (seen[b.id]) continue;
      seen[b.id] = true;
      emit(b);
    }
  }
  return { text: lines.join('\n'), view: v };
}

function buildSystem(masterKey) {
  const lane = LN.lanes().find((l) => l.master_key === masterKey);
  const label = lane ? (lane.label + ' lane master') : (masterKey + ' master');
  const l = listing(masterKey);
  return {
    text: rubric(label) + '\n' + l.text + '\n',
    view: l.view,
  };
}

// ---------------------------------------------------------------------------------------------
// BUILD. Every lane's system block, plus everything the runtime needs to talk about it.
// ---------------------------------------------------------------------------------------------
const SELECT_SYSTEM = {};
const SELECT_META = {};
for (const key of MASTER_KEYS) {
  const built = buildSystem(key);
  SELECT_SYSTEM[key] = built.text;
  SELECT_META[key] = {
    master_sha256: built.view.master_sha256,
    ceiling_chars: built.view.ceiling_chars,
    selectable: built.view.selectable.length,
    mandatory: built.view.mandatory.length,
    redacted_ids: built.view.redacted_ids.length,
    system_chars: built.text.length,
  };
}

(function assertAgainstUpstream() {
  const parse = require('./23-parse-research.js');
  if (parse.name !== 'Parse Research') {
    throw new Error('Build Select Request: node 23 is named ' + JSON.stringify(parse.name) + ' and this node connects from "Parse Research". Rename both in the same edit.');
  }
  const pc = String(parse.parameters.jsCode || '');
  if (pc.indexOf('j.research = {') === -1) {
    throw new Error('Build Select Request: Parse Research no longer stamps `research` on a pair. This node does not use the hook, but the README and the writer do, and a stage that silently stopped producing it would only surface as a letter with no hook.');
  }

  // PRE-FLIGHT. See header note 6. Fail-closed, python absent included.
  MASTER.preflight(MASTER_KEYS);

  LN.prices(MODEL);
  if (MIN_CACHE_TOKENS === undefined) {
    throw new Error('Build Select Request: no cacheable-prefix minimum is recorded for ' + JSON.stringify(MODEL) + '. Below the minimum the cache silently does nothing, which on this stage means paying for the whole master once per pair.');
  }
  if (!MASTER_KEYS.length) {
    throw new Error('Build Select Request: no master lane keys resolved from the lane file, so there is nothing for the selector to choose from.');
  }

  for (const key of MASTER_KEYS) {
    const sys = SELECT_SYSTEM[key];
    const where = 'the ' + key + ' system block';

    // CACHEABILITY, per lane. Four characters per token is the rough English ratio and it is used
    // conservatively here, the same way the reader stage uses it.
    const estTokens = Math.floor(sys.length / 4);
    if (estTokens < MIN_CACHE_TOKENS) {
      throw new Error(
        'Build Select Request: ' + where + ' is about ' + estTokens + ' tokens (' + sys.length + ' characters) and the\n' +
        '  minimum cacheable prefix on ' + MODEL + ' is ' + MIN_CACHE_TOKENS + '. Below the minimum the cache_control marker\n' +
        '  does NOTHING and reports nothing, which on this stage means paying full price for a copy of his\n' +
        '  whole CV on every single pair.'
      );
    }

    // BYTE IDENTITY. The block is a baked constant so it is identical by construction; this proves
    // the builder is deterministic, which is the property that would quietly stop being true if a
    // map iteration order or a timestamp ever crept into the view.
    const again = buildSystem(key).text;
    if (again !== sys) {
      throw new Error(
        'Build Select Request: ' + where + ' is NOT byte identical when built twice.\n' +
        '  Caching is a prefix match, so one byte of drift invalidates the whole prefix and every pair\n' +
        '  after the first pays full price for a copy of his CV. Find the non deterministic part before\n' +
        '  shipping this.'
      );
    }

    // The no-dash law, re-proved from a second angle. The master preflight already checks the
    // printable half; this checks the exact bytes that reach the model, rubric included, because a
    // rubric that uses a character is a rubric that teaches the model to use it.
    if (sys.indexOf(String.fromCharCode(8212)) !== -1 || sys.indexOf(String.fromCharCode(8211)) !== -1) {
      throw new Error('Build Select Request: ' + where + ' contains an em dash or an en dash. No file in this system carries either character, and the master preflight should have caught this first.');
    }
    for (const word of ['TypeScript', 'JavaScript']) {
      const re = new RegExp('\\b' + word + '\\b', 'g');
      const hits = (sys.match(re) || []).filter((h) => h === word);
      // The rubric names both words once each, in the rule that FORBIDS them. Anything above that
      // came out of the master listing, which the preflight is supposed to have refused.
      if (hits.length > 1) {
        throw new Error('Build Select Request: ' + where + ' names ' + word + ' ' + hits.length + ' times. Once is the rule that forbids it; more than once means the master listing carries a claim that was pruned on his own instruction.');
      }
    }

    // The redaction, checked from this side too. _master.modelView throws if the redaction FAILED to
    // run; this checks what actually shipped, over the exact bytes that leave this machine for a
    // third party. The check lives in _stage2.js rather than inline so it can be negative tested: a
    // redaction check that has never been shown catching a leak is indistinguishable from one that
    // matches nothing.
    const leaked = S2.contactHitsIn(sys);
    if (leaked.length) {
      throw new Error(
        'Build Select Request: ' + where + ' still contains ' + leaked.length + ' contact detail(s) after redaction: ' +
        JSON.stringify(leaked.map((h) => h.pattern)) + '.\n' +
        '  The selector has no use for a phone number when it is choosing which bullet to keep, and this\n' +
        '  block is sent to a third party on every pair. Fix the classifier in _master.js before building.'
      );
    }
  }

  if (!Number.isInteger(SELECT_MAX_TOKENS) || SELECT_MAX_TOKENS < 1024) {
    throw new Error('Build Select Request: the select max_tokens read out of the intake cost model is ' + JSON.stringify(SELECT_MAX_TOKENS) + '. A selection of forty ids plus a drop order and three objection notes does not fit in less.');
  }

  // A reasoning node must never receive the soul voice block. Enrolment is by NODE NAME.
  if (NODE_NAME === 'Build Writer Request') {
    throw new Error('Build Select Request: this node must not be named "Build Writer Request". That name is the voice-sync enrolment key and exactly ONE node in this workflow may carry it, the letter writer.');
  }
  for (const key of MASTER_KEYS) {
    if (SELECT_SYSTEM[key].indexOf('SOUL_VOICE') !== -1) {
      throw new Error('Build Select Request: the ' + key + ' system block carries a soul voice marker. This node chooses ids; it does not write prose a human reads as his own words.');
    }
  }
}());

const LOGIC = `
// ---------------------------------------------------------------------------
// Build Select Request. One Anthropic body per live pair, on that pair own lane master.
// ---------------------------------------------------------------------------
const NL = String.fromCharCode(10);

function txt(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

const items = $input.all().map((i) => i.json);
if (!items.length) {
  throw new Error('Build Select Request: Parse Research delivered no items at all. It emits at least its own stage report on every path, so an empty input means that node did not run and every lane report has already been lost.');
}

let built = 0;
let skipped = 0;
const skipReasons = {};
const byLane = {};
const out = [];

for (const raw of items) {
  const j = Object.assign({}, raw);

  // Every item carries the routing boolean, reports included. Under strict type validation on
  // Select Route an undefined boolean is an ERROR rather than a false, so an item missing it would
  // fail the route and take the run verdict with it.
  if (j._kind !== 'pair') {
    j._call_now = false;
    out.push(j);
    continue;
  }
  if (j._status) {
    j._call_now = false;
    skipped += 1;
    skipReasons[j._status] = (skipReasons[j._status] || 0) + 1;
    out.push(j);
    continue;
  }

  const key = txt(j.master_key);
  const system = SELECT_SYSTEM[key];
  if (!system) {
    // Unreachable: _lane.js asserts the lane to master mapping at build time. Kept as a refusal
    // rather than a comment, because the alternative is an opus-5 call with an empty system block
    // that would cheerfully return ids for a master it was never shown.
    j._status = 'needs_review';
    j._status_class = 'hold';
    j._sheet_action = 'write_status';
    j._status_why = 'this pair carries master_key ' + JSON.stringify(key) + ' and this workflow was built with block libraries for ' + JSON.stringify(Object.keys(SELECT_SYSTEM)) + ' only. No CV can be assembled from a master that was never baked in.';
    j._call_now = false;
    skipped += 1;
    skipReasons['needs_review'] = (skipReasons['needs_review'] || 0) + 1;
    out.push(j);
    continue;
  }

  const brief = j.brief || {};
  const objections = Array.isArray(brief.objections) ? brief.objections : [];

  // What the selector is told about the job. The RAW AD IS NOT HERE, deliberately: the recruiter
  // seat has already read it and produced a structured brief, and handing the selector the posting
  // as well would put attacker controllable text in front of the one model whose answer decides
  // what goes on his CV.
  const ask = {
    role_title: txt(brief.role_title),
    employer: txt(brief.employer),
    employer_country: brief.employer_country || null,
    seniority: brief.seniority || null,
    employment_type: brief.employment_type || null,
    work_type: brief.work_type || null,
    must_have: Array.isArray(brief.must_have) ? brief.must_have : [],
    nice_to_have: Array.isArray(brief.nice_to_have) ? brief.nice_to_have : [],
    ats_terms: Array.isArray(brief.ats_terms) ? brief.ats_terms : [],
  };

  const objectionText = objections.length
    ? objections.map((o, n) => '  ' + (n + 1) + '. ' + txt(o && o.objection) + (o && o.evidence ? NL + '     evidence from the posting: ' + txt(o.evidence) : '')).join(NL)
    : '  (the recruiter returned none, which is itself worth noting in objection_coverage)';

  const userText =
    'Select the blocks of this master that answer the posting below, and return the JSON object the' + NL +
    'system block specifies.' + NL + NL +
    'WHAT THE POSTING ASKS FOR, as a senior recruiter read it. These are facts extracted from the' + NL +
    'posting, not the posting itself.' + NL +
    JSON.stringify(ask, null, 1) + NL + NL +
    'THE ATS TERMS to mirror where the master already uses them. Do not invent a block to carry a' + NL +
    'term: choose the blocks that already contain the candidate own words for it.' + NL +
    '  ' + (ask.ats_terms.length ? ask.ats_terms.join(', ') : '(none recorded)') + NL + NL +
    'THE THREE OBJECTIONS a screener would raise. Answer each one with a block, or say nothing does.' + NL +
    objectionText + NL + NL +
    'THE ONE PAGE CEILING is ' + PARA_CHARS_MAX + ' characters of paragraph text. Budget against the character' + NL +
    'counts in the system block, and put most of your selection on drop_order.' + NL;

  j.select_request = {
    model: SELECT_MODEL,
    max_tokens: SELECT_MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: system,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      { role: 'user', content: [{ type: 'text', text: userText }] },
    ],
  };
  j._select = {
    model: SELECT_MODEL,
    max_tokens: SELECT_MAX_TOKENS,
    master_key: key,
    master_sha256: (SELECT_META[key] || {}).master_sha256 || null,
    system_chars: system.length,
    user_chars: userText.length,
    selectable_blocks: (SELECT_META[key] || {}).selectable || null,
    mandatory_blocks: (SELECT_META[key] || {}).mandatory || null,
    ceiling_chars: PARA_CHARS_MAX,
    objections_given: objections.length,
    ats_terms_given: ask.ats_terms.length,
    cache_breakpoint: 'the system block, which is the whole master and is byte identical for every pair on this lane in this run. One cache write and then reads at a tenth of the input price, or one full price copy of his CV per pair if it silently fails.',
    contract: 'ids in, master strings out. Nothing this model types as prose reaches the page, except at most one bridge line that must begin with the exact words the rubric names and must survive every check in Assemble CV.',
  };
  j._call_now = true;
  built += 1;
  byLane[key] = (byLane[key] || 0) + 1;
  out.push(j);
}

const report = {
  _kind: 'stage_report',
  stage: 'select_request',
  model: SELECT_MODEL,
  max_tokens: SELECT_MAX_TOKENS,
  requests_built: built,
  by_master_lane: byLane,
  pairs_skipped: skipped,
  skipped_by_status: skipReasons,
  masters: SELECT_META,
  ceiling_chars: PARA_CHARS_MAX,
  cache: {
    breakpoint: 'system block, ephemeral, one per master lane',
    model_minimum_tokens: MIN_CACHE_TOKENS,
    note: 'the system block on this stage is the whole master, so a silent cache failure is the most expensive one in the workflow. Assemble CV reports cache reads per run so it shows up as cost rather than as nothing.',
  },
  contract: 'the selector emits IDS and the assembler emits MASTER STRINGS, so there is no code path by which the CV can carry a rewritten sentence. A model that hallucinates a better bullet produces an id that does not resolve, and an id that does not resolve is a refusal rather than a paragraph.',
  bridge_line_rule: 'at most one sentence beginning ' + JSON.stringify(BRIDGE_PREFIX) + ', no digits, at most ' + BRIDGE_MAX_CHARS + ' characters, one sentence, no dashes, no pronouns, no banned claims. It is the only sentence on the CV that is not his own writing, it is carried in its own field so nothing can mistake it for a block, and Assemble CV drops it rather than shipping a malformed one.',
  seat: 'an ATS selection editor choosing the intersection of what he HAS and what the posting ASKS FOR, answering the three objections the recruiter seat raised, against a hard one page ceiling.',
  _call_now: false,
  site_fetch_url: '',
  ad_fetch_url: '',
};
out.push(report);

return out.map((j) => ({ json: j, pairedItem: { item: 0 } }));
`;

const jsCode = [
  '// GENERATED at build time from work/36-job-application-writer/nodes/24-build-select-request.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  'const SELECT_MODEL = ' + JSON.stringify(MODEL) + ';',
  'const SELECT_MAX_TOKENS = ' + JSON.stringify(SELECT_MAX_TOKENS) + ';',
  'const MIN_CACHE_TOKENS = ' + JSON.stringify(MIN_CACHE_TOKENS) + ';',
  'const PARA_CHARS_MAX = ' + JSON.stringify(PARA_CHARS_MAX) + ';',
  'const BRIDGE_PREFIX = ' + JSON.stringify(BRIDGE_PREFIX) + ';',
  'const BRIDGE_MAX_CHARS = ' + JSON.stringify(BRIDGE_MAX_CHARS) + ';',
  'const SELECT_META = ' + JSON.stringify(SELECT_META) + ';',
  'const SELECT_SYSTEM = ' + JSON.stringify(SELECT_SYSTEM) + ';',
  LOGIC,
].join('\n');

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [5720, 100],
  connectFrom: 'Parse Research',
  notes: 'Assembles one Anthropic /v1/messages body per live pair: a cached system block carrying that lane own master as addressable blocks with content hash ids, contact details redacted, plus the selection rules and the one page ceiling; then a user turn with the recruiter brief, the ATS terms and the three objections. The selector returns IDS, a section order, a drop order and an objection coverage note, never text. claude-opus-5. Stamps _call_now on EVERY item so the strict route downstream can never see an undefined boolean. This is a reasoning node and it deliberately carries no soul voice block.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

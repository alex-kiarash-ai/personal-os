'use strict';
/*
 * 39-build-grade-request.js - "Build Grade Request". The blind grader, as a runtime stage.
 *
 * =============================================================================================
 * 1. BLIND MEANS BLIND. THE USER TURN IS THE LETTER AND NOTHING ELSE.
 * =============================================================================================
 * This is Anthropic's Outcomes pattern and the whole value is in what the grader does NOT see. The
 * close-out grader kit says it plainly: a grader in its own window cannot be talked into passing by
 * the maker's own justification. So the user turn carries the letter text and nothing else. No
 * company, no posting, no brief, no objections, no CV, no screening note, no audit result, and above
 * all none of the writer's reasoning about why its choices were right.
 *
 * That is also why the screening note is kept in its own field at Parse Letter rather than left in
 * the answer: it is the writer arguing its own case, and it is exactly the input that would let this
 * model be argued into a PASS.
 *
 * =============================================================================================
 * 2. THE RUBRIC IS BAKED FROM THE FILE, AND THE FIVE IDS ARE ASSERTED TO EXIST.
 * =============================================================================================
 * `work/23-self-review/close-out-grader/rubric.md` is the source. The voice criteria section and the
 * verdict section are read out of it at build time and baked, so this lane cannot drift from the
 * rubric every other identity-carrying output in this system is graded against. The build asserts
 * PV1 to PV5 are all present: a rubric that lost a criterion would otherwise produce a grader that
 * passes everything it no longer checks, and report a clean verdict doing it.
 *
 * =============================================================================================
 * 3. ONE DELIBERATE TIGHTENING, STATED RATHER THAN SMUGGLED.
 * =============================================================================================
 * The rubric's PV1 still carves out en dashes inside numeric and date ranges. That carve-out is from
 * 2026-07-07 and Shaheen reversed it on 2026-08-20 in his own words: "you have use this [en-dash] in
 * both versions PDF and Word, you already have this role, NEVER AGAIN use it." scripts/lib/voice-rules.js
 * already follows the reversal; the rubric has not been re-edited, and the rubric's own header settles
 * it ("If this rubric and those files disagree, the files win").
 *
 * So the rubric text is baked VERBATIM, his file is not rewritten from inside a node, and a clearly
 * marked scope note after it tells the grader that for this artifact both characters are zero
 * tolerance. A cover letter has no date ranges in it, so the note costs nothing and removes an
 * ambiguity that would otherwise make PV1 disagree with A1 on the same text.
 *
 * =============================================================================================
 * 4. THE CACHE BREAKPOINT IS SET BECAUSE THE BLOCK MEASURES ABOVE THE MINIMUM, NOT BY HABIT.
 * =============================================================================================
 * Prompt caching fails SILENTLY below the model minimum: no error, cache_creation_input_tokens 0 on
 * every call, and a marker that reads as an optimisation while doing nothing. So the marker was not
 * set first and justified afterwards. The block was built, measured, and the build ASSERTS the
 * measurement: at roughly 1090 tokens against a 1024 minimum for this model it clears, so the marker
 * is set. If the rubric is ever trimmed and the block falls back under, the assertion below fails
 * and says to remove the marker or grow the block, rather than leaving a decoration.
 *
 * Four characters per token is an estimate and this one sits close to the line, which is why the run
 * report counts real cache reads: a silent cache failure then shows up as cost rather than as
 * nothing at all.
 *
 * =============================================================================================
 * 5. THIS NODE CARRIES NO VOICE BLOCK, AND PV5 IS WEAKER FOR IT. SAID OUT LOUD.
 * =============================================================================================
 * Only the node named `Build Writer Request` may carry the soul voice block: enrolment is by node
 * name and nothing asserts the negative side, so every other node in this seat refuses it.
 *
 * The honest consequence: PV5, "his words, not generic English", is graded on the rubric's own
 * description of his register rather than against the live corpus. The option not taken was to bake
 * a second copy of the voice block here. It was rejected because a second copy is not enrolled: the
 * sync updates ONE node, so this one would go stale the first time soul.md changed and would then be
 * grading the current letter against last month's voice, silently. A weaker check that cannot drift
 * beats a stronger one that can, when nothing is watching either.
 */

const fs = require('fs');
const path = require('path');

const LN = require('./_lane');
const S2 = require('./_stage2');

const NODE_NAME = 'Build Grade Request';
const N38 = './38-audit-pair-final.js';

const MODEL = LN.STAGE_MODELS.grade;
const MIN_CACHE_TOKENS = LN.MIN_CACHEABLE_TOKENS[MODEL];
const GRADE_MAX_TOKENS = S2.readSourceNumber(
  './05-build-candidates.js',
  /\{\s*stage:\s*'grade',[^}]*out_tokens:\s*(\d+)\s*\}/,
  "the grade row of COST_MODEL (its out_tokens is this node's max_tokens)"
);

const RUBRIC_FILE = path.join(S2.REPO, 'work', '23-self-review', 'close-out-grader', 'rubric.md');
const PV_IDS = ['PV1', 'PV2', 'PV3', 'PV4', 'PV5'];

// ---------------------------------------------------------------------------------------------
// THE RUBRIC, READ OUT OF THE FILE. The voice criteria section plus the verdict section, verbatim.
// The visual criteria are not included: this artifact is prose and a grader asked about a palette
// would either invent an answer or return N/A five times, and both of those dilute a verdict that
// is about to hold a pair out of a Drive folder.
// ---------------------------------------------------------------------------------------------
function readRubric() {
  if (!fs.existsSync(RUBRIC_FILE)) {
    throw new Error(
      'Build Grade Request: the close-out grader rubric is missing at ' + path.relative(S2.REPO, RUBRIC_FILE) + '.\n' +
      '  The grader system block is baked FROM that file so this lane cannot drift from the rubric every\n' +
      '  other identity carrying output in this system is graded against. Refusing to invent one.'
    );
  }
  const text = fs.readFileSync(RUBRIC_FILE, 'utf8');
  const start = text.indexOf('## Voice criteria');
  if (start === -1) {
    throw new Error('Build Grade Request: rubric.md no longer carries a "## Voice criteria" heading, which is the section this grader is built from.');
  }
  let end = text.indexOf('\n## ', start + 1);
  if (end === -1) end = text.length;
  const voice = text.slice(start, end).trim();

  const vStart = text.indexOf('## Verdict');
  const verdict = vStart === -1 ? '' : text.slice(vStart).trim();
  return { voice: voice, verdict: verdict, whole: text };
}

// ---------------------------------------------------------------------------------------------
// THE RUBRIC FILE CONTAINS THE CHARACTER ITS OWN RULE IS ABOUT, and that was found by the build
// refusing rather than by reading. PV1's carve-out is illustrated with two example date ranges, and
// those examples are written with a real U+2013. So a verbatim bake would put the banned character
// into the prompt this lane sends on every pair, and into a node parameter in a repo whose standing
// order is that no file carries either character.
//
// Three things are NOT done about it. His rubric is not edited from inside a node. The examples are
// not deleted, because removing an example silently changes what a rule appears to say. And the
// character is not passed through and quietly tolerated.
//
// What IS done: each occurrence is rendered as its codepoint NAME in the baked copy, the count is
// reported, and the scope note below says so in as many words. The carve-out those examples
// illustrate is switched off for this artifact anyway, so nothing of the rubric's meaning is lost.
//
// Worth carrying upstream: the carve-out itself is stale. Shaheen reversed it on 2026-08-20 for both
// characters and scripts/lib/voice-rules.js already follows the reversal. rubric.md has not been
// re-edited, and it is not this seat's file to re-edit.
// ---------------------------------------------------------------------------------------------
const EN_DASH = String.fromCharCode(8211);
const EM_DASH = String.fromCharCode(8212);
let DASHES_RENAMED = 0;
function renameDashes(text) {
  let out = String(text);
  DASHES_RENAMED += (out.split(EN_DASH).length - 1) + (out.split(EM_DASH).length - 1);
  return out.split(EN_DASH).join('U+2013').split(EM_DASH).join('U+2014');
}

const RUBRIC_RAW = readRubric();
const RUBRIC = {
  voice: renameDashes(RUBRIC_RAW.voice),
  verdict: renameDashes(RUBRIC_RAW.verdict),
  whole: RUBRIC_RAW.whole,
};

function rubricBlock() {
  return [
    'You are a blind quality grader. You have been handed ONE finished artifact and ONE rubric, and',
    'nothing else. You have not seen the job it was written for, the person who wrote it, or any of',
    'the reasoning behind it, and that is deliberate: a grader who can read the maker own case for a',
    'piece of writing can be argued into passing it.',
    '',
    'The artifact is a cover letter written by a candidate in his own voice. Grade it against the five',
    'voice criteria below, exactly as written, one verdict each.',
    '',
    RUBRIC.voice,
    '',
    RUBRIC.verdict,
    '',
    'SCOPE NOTE FOR THIS ARTIFACT, and it is the only place this prompt departs from the rubric text',
    'above. PV1 as written still carves out en dashes inside numeric and date ranges. That carve out',
    'was reversed by the author on 2026-08-20, in his own words, for both characters and for all of',
    'his documents, and the rubric own header settles the conflict: when the rubric and the source',
    'files disagree, the files win. So for THIS artifact PV1 is zero tolerance on BOTH characters,',
    'U+2013 and U+2014, with no exception of any kind. A cover letter carries no date ranges, so this',
    'costs nothing and removes an ambiguity.',
    '',
    'One mechanical note about the text above. The rubric file illustrates that carve out with two',
    'example date ranges written using the very character the rule is about. Sending you that',
    'character would be self defeating, so every occurrence in the quoted rubric has been rendered as',
    'its codepoint name, U+2013 or U+2014, and nothing else was changed. Read those as the characters',
    'they name.',
    '',
    'TWO THINGS THAT ARE NOT YOUR JOB. You are not checking facts: you cannot see the job posting or',
    'the candidate CV, so a claim you cannot verify is not a FAIL, it is simply outside what you were',
    'given. You are not editing: do not supply a better sentence, do not rewrite anything, and do not',
    'suggest improvements. One verdict per criterion, with the evidence that decided it.',
    '',
    'EVIDENCE IS A QUOTE, NOT A DESCRIPTION. For a FAIL, quote the offending words from the letter.',
    'For a PASS, quote the words that convinced you, or say in one short clause what you looked for',
    'and did not find. A verdict with no evidence is an opinion, and the person reading this later',
    'cannot act on an opinion.',
    '',
    'OUTPUT. Return ONE JSON object and nothing else. No prose before it, no prose after it, no',
    'markdown fence.',
    '',
    '  {',
    '    "PV1": {"verdict": "PASS" or "FAIL", "evidence": "<one short sentence, quoting>"},',
    '    "PV2": {"verdict": "PASS" or "FAIL", "evidence": "..."},',
    '    "PV3": {"verdict": "PASS" or "FAIL", "evidence": "..."},',
    '    "PV4": {"verdict": "PASS" or "FAIL", "evidence": "..."},',
    '    "PV5": {"verdict": "PASS" or "FAIL", "evidence": "..."},',
    '    "verdict": "PASS" or "FAIL"',
    '  }',
    '',
    'The top level verdict is PASS only when all five are PASS. One FAIL anywhere makes it FAIL. Do',
    'not invent a third value, and do not hedge: a verdict you are unsure of is a FAIL with the',
    'uncertainty stated in the evidence.',
  ].join('\n');
}
const GRADE_SYSTEM = rubricBlock();

function assertAgainstUpstream() {
  const prev = require(N38);
  if (prev.name !== 'Audit Pair Final') {
    throw new Error('Build Grade Request: node 38 is named ' + JSON.stringify(prev.name) + ' and this node connects from "Audit Pair Final".');
  }
  const pc = String(prev.parameters.jsCode || '');
  if (pc.indexOf('pair.letter_audit = result;') === -1) {
    throw new Error('Build Grade Request: Audit Pair Final no longer stamps letter_audit. Only a pair that has passed the deterministic audit is worth paying a grader for.');
  }

  // THE FIVE IDS. A rubric that lost one would make a grader that passes what it no longer checks.
  for (const id of PV_IDS) {
    if (RUBRIC.whole.indexOf('**' + id + ' ') === -1) {
      throw new Error(
        'Build Grade Request: rubric.md does not declare ' + id + '.\n' +
        '  The five voice criteria are the whole contract of this stage, and the parser downstream expects\n' +
        '  a verdict for each. A grader built from a rubric that lost a criterion would pass what it no\n' +
        '  longer checks and report a clean verdict doing it.'
      );
    }
    if (GRADE_SYSTEM.indexOf(id) === -1) {
      throw new Error('Build Grade Request: ' + id + ' is in rubric.md but did not survive into the baked system block. The section cut is wrong.');
    }
  }
  if (!RUBRIC.verdict) {
    throw new Error('Build Grade Request: rubric.md no longer carries a "## Verdict" section, which is what tells the grader how a top level verdict is reached.');
  }

  // No visual criterion may leak in: this artifact is prose, and a grader asked about a palette
  // returns five N/A values that dilute a verdict which is about to hold a pair out of Drive.
  for (const bv of ['BV1', 'BV2', 'BV3', 'BV4', 'BV5']) {
    if (GRADE_SYSTEM.indexOf(bv) !== -1) {
      throw new Error('Build Grade Request: the baked system block carries the visual criterion ' + bv + '. This stage grades prose; the section cut has taken too much.');
    }
  }

  LN.prices(MODEL);
  if (MIN_CACHE_TOKENS === undefined) {
    throw new Error('Build Grade Request: no cacheable-prefix minimum recorded for ' + JSON.stringify(MODEL) + '.');
  }
  // See header note 4. The breakpoint is set because of this measurement, not in spite of it.
  const estTokens = Math.floor(GRADE_SYSTEM.length / 4);
  if (estTokens < MIN_CACHE_TOKENS) {
    throw new Error(
      'Build Grade Request: the rubric block is about ' + estTokens + ' tokens (' + GRADE_SYSTEM.length + ' characters) and the\n' +
      '  minimum cacheable prefix for ' + MODEL + ' is ' + MIN_CACHE_TOKENS + '. This node sets a cache_control marker on it,\n' +
      '  and below the minimum that marker does NOTHING and reports nothing, which reads as an\n' +
      '  optimisation while being none. Either grow the block or take the breakpoint off, and say which.'
    );
  }
  if (!Number.isInteger(GRADE_MAX_TOKENS) || GRADE_MAX_TOKENS < 256) {
    throw new Error('Build Grade Request: the grade max_tokens read out of the intake cost model is ' + JSON.stringify(GRADE_MAX_TOKENS) + '. Five verdicts with quoted evidence do not fit in less.');
  }

  const generated = renderJsCode();
  if (generated.indexOf(EM_DASH) !== -1 || generated.indexOf(EN_DASH) !== -1) {
    throw new Error(
      'Build Grade Request: the generated source contains an em dash or an en dash.\n' +
      '  The rubric it bakes is the rule against exactly those characters, so carrying one would be self\n' +
      '  defeating, and no file in this system may hold either. ' + DASHES_RENAMED + ' occurrence(s) were already\n' +
      '  renamed out of the quoted rubric, so anything left came from somewhere else in this node.'
    );
  }
  // The rename has to have RUN. If rubric.md is ever cleaned up at source this drops to zero, which
  // is fine and expected; what would not be fine is the rename silently matching nothing while the
  // characters were still arriving through a path this build does not look at.
  if (RUBRIC_RAW.whole.indexOf(EN_DASH) !== -1 && DASHES_RENAMED === 0) {
    throw new Error('Build Grade Request: rubric.md still contains an en dash but the rename found none in the section that was baked. The section cut and the rename are looking at different text.');
  }
  if (NODE_NAME === 'Build Writer Request') {
    throw new Error('Build Grade Request: this node must not be named "Build Writer Request". That name is the voice-sync enrolment key and belongs to the letter writer alone.');
  }
  if (generated.indexOf('SOUL_VOICE') !== -1) {
    throw new Error('Build Grade Request: the generated source carries a soul voice marker. See header note 5: a second copy would not be enrolled in the sync and would be grading against a stale voice within a month, silently.');
  }
}

const LOGIC = `
// ---------------------------------------------------------------------------
// Build Grade Request. One body per pair that survived the audit. The letter, and nothing else.
// ---------------------------------------------------------------------------
const NL = String.fromCharCode(10);

const items = $input.all().map((i) => i.json);
if (!items.length) {
  throw new Error('Build Grade Request: Audit Pair Final delivered no items at all. It emits at least its own stage report on every path, so an empty input means that node did not run.');
}

let built = 0;
let skipped = 0;
const skipReasons = {};
const out = [];

for (const raw of items) {
  const j = Object.assign({}, raw);

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

  const letter = String(j.letter_text === undefined || j.letter_text === null ? '' : j.letter_text);
  if (!letter.trim()) {
    j._status = 'needs_review';
    j._status_class = 'hold';
    j._sheet_action = 'write_status';
    j._status_why = 'this pair reached the grader with no letter text. Nothing is graded and nothing is guessed.';
    j._call_now = false;
    skipped += 1;
    skipReasons['needs_review'] = (skipReasons['needs_review'] || 0) + 1;
    out.push(j);
    continue;
  }

  // THE USER TURN. The letter, and nothing else. See header note 1: no company, no posting, no
  // brief, no CV, no screening note, no audit result, and none of the writer own reasoning.
  const userText =
    'Grade the cover letter below against the five voice criteria. Return the JSON object the system' + NL +
    'block specifies and nothing else.' + NL + NL +
    '---' + NL +
    letter + NL +
    '---' + NL;

  j.grade_request = {
    model: GRADE_MODEL,
    max_tokens: GRADE_MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: GRADE_SYSTEM,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      { role: 'user', content: [{ type: 'text', text: userText }] },
    ],
  };
  j._grade = {
    model: GRADE_MODEL,
    max_tokens: GRADE_MAX_TOKENS,
    criteria: PV_IDS,
    rubric_source: 'work/23-self-review/close-out-grader/rubric.md, voice criteria and verdict sections, baked verbatim at build time',
    system_chars: GRADE_SYSTEM.length,
    user_chars: userText.length,
    blind: 'the user turn is the letter text and nothing else. No company, no posting, no brief, no CV, no screening note, no audit result and none of the writer reasoning, because a grader that can read the maker own case can be argued into passing.',
    cache: 'the system block is the breakpoint. It is identical for every pair in the run and it measures just above the ' + MIN_CACHE_TOKENS + ' token minimum for this model, which is why the marker is set at all: below the minimum it would do nothing and report nothing. The margin is thin, so Parse Grade counts real cache reads and a silent failure shows up as cost rather than as nothing.',
    consequence: 'D16. A FAIL holds the pair: it is not uploaded, it sits in needs_review with the reasons, and a human ships it or rewrites it. Nothing that failed the voice check reaches Drive unattended.',
  };
  j._call_now = true;
  built += 1;
  out.push(j);
}

const report = {
  _kind: 'stage_report',
  stage: 'grade_request',
  model: GRADE_MODEL,
  max_tokens: GRADE_MAX_TOKENS,
  requests_built: built,
  pairs_skipped: skipped,
  skipped_by_status: skipReasons,
  criteria: PV_IDS,
  rubric_source: 'work/23-self-review/close-out-grader/rubric.md',
  blind: 'the grader sees the letter and the rubric. Nothing else, on purpose.',
  pv1_scope_note: 'the rubric PV1 carve out for en dashes inside date ranges is explicitly switched OFF for this artifact, because the author reversed it on 2026-08-20 for both characters and the rubric own header says the source files win. A cover letter has no date ranges, so this only removes an ambiguity between PV1 and the deterministic A1.',
  pv5_limitation: 'PV5 is graded on the rubric own description of his register rather than against the live corpus, because only the writer node may carry the soul voice block and a second unenrolled copy would go stale silently the first time soul.md changed.',
  _call_now: false,
  site_fetch_url: '',
  ad_fetch_url: '',
};
out.push(report);

return out.map((j) => ({ json: j, pairedItem: { item: 0 } }));
`;

function renderJsCode() {
  return [
    '// GENERATED at build time from work/36-job-application-writer/nodes/39-build-grade-request.js.',
    '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
    '// The rubric text below is baked VERBATIM from work/23-self-review/close-out-grader/rubric.md.',
    'const GRADE_SYSTEM = ' + JSON.stringify(GRADE_SYSTEM) + ';',
    'const GRADE_MODEL = ' + JSON.stringify(MODEL) + ';',
    'const GRADE_MAX_TOKENS = ' + JSON.stringify(GRADE_MAX_TOKENS) + ';',
    'const MIN_CACHE_TOKENS = ' + JSON.stringify(MIN_CACHE_TOKENS) + ';',
    'const PV_IDS = ' + JSON.stringify(PV_IDS) + ';',
    LOGIC,
  ].join('\n');
}

assertAgainstUpstream();

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [9620, 100],
  connectFrom: 'Audit Pair Final',
  notes: 'The blind grader as a runtime stage. The system block is PV1 to PV5 plus the verdict rule, baked VERBATIM from work/23-self-review/close-out-grader/rubric.md with the five ids asserted to exist at build time, and one clearly marked scope note switching off the PV1 date range carve out the author reversed on 2026-08-20. The user turn is the LETTER TEXT AND NOTHING ELSE: no company, no posting, no CV, no screening note, no audit result and none of the writer reasoning, because a grader that can read the maker own case can be argued into passing. claude-sonnet-4-6, with the system block as the cache breakpoint because it MEASURED just above the model minimum; the build asserts that measurement rather than assuming it, since below the minimum the marker reports nothing while doing nothing.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: renderJsCode(),
  },
};

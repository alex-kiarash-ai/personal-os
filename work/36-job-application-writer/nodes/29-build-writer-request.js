'use strict';
/*
 * 29-build-writer-request.js - "Build Writer Request". THE ONE PROSE NODE.
 *
 * =============================================================================================
 * 1. THE NAME IS A CONTRACT WITH A SCRIPT IN ANOTHER FOLDER, AND IT IS NOT DECORATION.
 * =============================================================================================
 * scripts/lib/sync-n8n-voice.js injects the soul voice block into exactly ONE node per enrolled
 * workflow: a Code node NAMED `Build Writer Request` whose generated source carries
 *
 *     const SYSTEM = "<a JSON string>";
 *     const TONE
 *
 * It finds the literal by searching for `const SYSTEM = `, then for the terminator `;` newline
 * `const TONE`, then JSON.parse of everything between. Miss the name, the const, or the
 * terminator, and the sync does not fail: it refuses to write and every letter this lane ever
 * ships is written in generic English by a model that was never shown his voice.
 *
 * So the shape below is built to that reader, and `config/test-stage-3.js` runs the REAL
 * `extractLiveBlock` against the REAL generated jsCode rather than asserting a regex of its own.
 * That is the single highest value proof in this seat.
 *
 * THE NEGATIVE SIDE IS NOT ASSERTED BY ANY SCRIPT. Enrolment is by node name, so "only the writer
 * gets the voice block" is true only while exactly one node in the workflow carries that name.
 * Nothing checks it. Every other Code node in this seat therefore refuses to be called it, the
 * same refusal seat 4 wrote into 24 and 28, and the offline suite asserts the count over all 43.
 *
 * =============================================================================================
 * 2. THE BLOCK IS BAKED HERE AT BUILD TIME, WHICH CLOSES DESIGN DEFECT 2.
 * =============================================================================================
 * Defect 2 from the plan review: `build.js --rebuild` reassembles every node from its file, so a
 * voice block that exists only because a later sync injected it into the LIVE workflow is wiped by
 * the next rebuild and stays wiped until the next generator run. The window between those two is a
 * window in which this lane writes cover letters in nobody's voice and reports nothing.
 *
 * The fix is to make the block part of what the build PRODUCES: this file reads soul.md through
 * `sync-n8n-voice.buildVoiceBlock()`, the same function the live sync uses, and bakes the result
 * into SYSTEM. A rebuild now carries a current block by construction, and the later sync sees an
 * identical stable part and reports a verified no-op. Two mechanisms, one definition, and the
 * generator stays the thing that refreshes it when soul.md changes.
 *
 * WHAT THAT MEANS FOR THIS TRACKED FILE, and it is the reason it is done this way round. soul.md
 * is gitignored and this file is tracked in a PUBLIC repo. The block is READ at build time and
 * lands in the generated jsCode, which goes to the box; the bytes in this file are the require
 * call and nothing else. Same discipline as 24 and 28 with the master text, and the same reason.
 *
 * Nothing about his person is written into this file either. The work authorization line, the
 * employer name, the availability wording and the approved figures all come out of the vault at
 * build time or off the CV at run time. A rubric that hardcoded his nationality would put it in a
 * public repo to save one regex.
 *
 * =============================================================================================
 * 3. FAIL CLOSED. NO BLOCK MEANS HOLD, AND IT MEANS IT AT BOTH ENDS.
 * =============================================================================================
 * Build time: this file refuses to build a writer whose SYSTEM has no markers. Shipping a workflow
 * that holds every pair is worse than not shipping one.
 * Run time: the node stamps `voice_block_present` on every pair, and a false holds the pair before
 * a single paid token is spent. That is what A16 reads. The runtime half is not redundant with the
 * build half: a hand edit in the n8n editor, a partial sync, or a restore from an old backup can
 * all produce a live node whose SYSTEM lost its block, and none of those re-runs this file.
 *
 * =============================================================================================
 * 4. THE RECRUITER LENS (D19) DECIDES ORDER. THE SOUL BLOCK DECIDES WORDS.
 * =============================================================================================
 * Two authorities in one prompt, and they are deliberately about different things. The lens is his
 * own 2026-09-12 casting, a senior technical recruiter with twenty years in the seat, and it rules
 * on what earns a line and in what order: the three objections are answered, the screener's need
 * comes first, and a sentence that does not move a screening decision does not get written. The
 * voice block rules on register, and it outranks every instinct toward polished corporate English.
 *
 * The failure this separation prevents is the one the BJAK rewrite named on 2026-09-12: a letter
 * can be perfectly ordered and still read as any competent machine wrote it, and it can be
 * perfectly in voice and still answer none of the three reasons it is about to be binned.
 *
 * =============================================================================================
 * 5. THE RAW AD NEVER REACHES THIS MODEL.
 * =============================================================================================
 * A posting is attacker controllable text. The recruiter seat at node 12 already read it under its
 * own injection rules and returned a structured brief, and that brief plus two verbatim quoted
 * spans that were PROVED to be substrings of real fetched text is all the writer gets. The
 * researcher's banned_facts list rides along as a negative list: things it knows that the employer
 * page does not say, none of which may appear.
 */

const fs = require('fs');
const path = require('path');

const LN = require('./_lane');
const S2 = require('./_stage2');
const MASTER = require('./_master');
const VOICE = require(path.join(S2.REPO, 'scripts', 'lib', 'sync-n8n-voice.js'));

const NODE_NAME = 'Build Writer Request';

const MODEL = LN.STAGE_MODELS.write;
const MIN_CACHE_TOKENS = LN.MIN_CACHEABLE_TOKENS[MODEL];
const MASTER_KEYS = S2.masterKeys();

// Read from the intake cost model rather than chosen again here, so the guard that refuses an
// unaffordable run and the node that spends the money cannot disagree.
const WRITE_MAX_TOKENS = S2.readSourceNumber(
  './05-build-candidates.js',
  /\{\s*stage:\s*'write',[^}]*out_tokens:\s*(\d+)\s*\}/,
  "the write row of COST_MODEL (its out_tokens is this node's max_tokens)"
);

// The word band. ONE definition in this repo: scripts/lib/voice-rules.js PROFILES.letter, which is
// what the audit checks and what the prose scanner CLI reports. Read, never restated: a rubric that
// asks for one band while the audit enforces another produces a letter that is rewritten for being
// exactly what it was told to be.
const VR = require(path.join(S2.REPO, 'scripts', 'lib', 'voice-rules.js'));
const WORD_MIN = VR.PROFILES.letter.min;
const WORD_MAX = VR.PROFILES.letter.max;

// The markers. The letter is what sits between LETTER_OPEN and LETTER_CLOSE and nothing else; the
// screening note after SCREEN_OPEN is for the README and the audit and never for the recruiter.
const LETTER_OPEN = '<<<LETTER>>>';
const LETTER_CLOSE = '<<<END>>>';
const SCREEN_OPEN = '<<<SCREEN>>>';

// The approved figures, per lane, DERIVED from the masters and the writer notes at build time.
// Never typed: a list that is written out goes stale the first time he amends a master, and a
// stale allowlist fails an honest letter while passing an invented figure.
const APPROVED_NUMBERS = {};
for (const key of MASTER_KEYS) APPROVED_NUMBERS[key] = MASTER.approvedNumbers(key).numbers;

// The exact work authorization line, per lane, lifted from the master itself. A11 checks the CV
// carries it; the letter's opener is told to state it as the CV states it. Both ends read the same
// string out of the same document.
const WORK_AUTH_RE = /Work authorization:[^\n]*/;
const WORK_AUTH = {};
for (const key of MASTER_KEYS) {
  const m = MASTER.parseMaster(key);
  const hit = WORK_AUTH_RE.exec(m.blocks.map((b) => b.text).join('\n'));
  WORK_AUTH[key] = hit ? hit[0].trim() : null;
}

// ---------------------------------------------------------------------------------------------
// THE RUBRIC. Generic English. No name, no nationality, no employer, no figure, no block id: this
// file is tracked and the repo is public. Everything personal arrives in the user turn.
// ---------------------------------------------------------------------------------------------
function rubric() {
  return [
    'You are a senior technical recruiter with twenty years of experience screening candidates for',
    'technology roles. You have read tens of thousands of applications and you decide on most of',
    'them in about six seconds. Today you are on the other side of the table: you are writing the',
    'cover letter that has to survive you.',
    '',
    'THE TWO AUTHORITIES IN THIS PROMPT, and they rule on different things.',
    'Your recruiter judgement decides WHAT earns a line and IN WHAT ORDER. The voice section at the',
    'end decides HOW every one of those lines is worded. Where they appear to conflict, the voice',
    'section wins on wording and you win on content. The words are the candidate own and they are',
    'not yours to improve into better English.',
    '',
    'THE SIX SECOND RULE. A screener reads the first two lines and decides whether to read the',
    'third. So the thing that gets this application past the first filter goes first, and the thing',
    'that is merely true goes last or goes nowhere. If a sentence would not change a screening',
    'decision, it does not earn its place, however well it reads.',
    '',
    'THE THREE OBJECTIONS ARE THE JOB. The user turn carries the three strongest reasons a screener',
    'would move this application to the no pile. They were written by a recruiter who read the',
    'posting. Every one of them is answered somewhere in the body of the letter, with evidence that',
    'is already on the CV. Answering an objection means giving the screener a fact that changes the',
    'answer, never reassuring language. If the CV genuinely does not answer one, say so plainly in',
    'one short clause and move on. An honest gap named in the letter beats a stretch, because the',
    'stretch is the thing that gets checked in the interview.',
    '',
    'THE SKELETON, in this order, and no other section:',
    '  1. The greeting, on its own line, exactly: Hi,',
    '  2. ONE line naming the role applied for.',
    '  3. The opener that answers the location and work authorization question honestly, before it',
    '     is asked. The user turn gives you the candidate work authorization line exactly as the CV',
    '     states it, and the city. State that, state the working arrangement, and claim NOTHING',
    '     beyond it. If the posting asks for a right to work the candidate does not hold, the user',
    '     turn says so: name it as a fact, do not apologise for it, and never imply it is held.',
    '  4. THREE BEATS, one short paragraph each, in this order:',
    '       beat one, what the candidate builds in the technical area this posting is about',
    '       beat two, the domain and the current employer. The user turn tells you whether that',
    '         employer needs introducing to this reader, in one line or in two.',
    '       beat three, the combination, argued against this specific posting, with the employer own',
    '         words quoted back once. The quoted span is given to you verbatim in the user turn and',
    '         it is the ONLY thing you may put inside quotation marks.',
    '  5. The honest gap. One or two sentences naming the thing this candidate does not have that',
    '     the posting asks for, and what is there instead. This is not a weakness paragraph and not',
    '     an apology.',
    '  6. Availability, one short line, using the wording the CV uses.',
    '  7. The signature: the candidate name alone, on the last line. No sign off phrase above it.',
    '',
    'LENGTH: between ' + WORD_MIN + ' and ' + WORD_MAX + ' words in the letter itself. A letter outside that band is',
    'rejected by a deterministic check and rewritten, so it costs a second call and buys nothing.',
    '',
    'THE HARD RULES. Every one of these is checked by code after you answer, and a failure is a',
    'rewrite or a hold. None of them is a style preference.',
    '  FIGURES. Every number in the letter comes from the approved list in the user turn or appears',
    '    inside the employer own words quoted there. No other figure, in any form, including a',
    '    rounded one, a range, a year of experience or a team size. If a claim needs a number the',
    '    list does not have, make the claim without the number.',
    '  QUOTATION MARKS. The only text that may sit inside quotation marks is the verbatim span the',
    '    user turn supplies. Do not invent a quotation, do not quote the posting from memory, and do',
    '    not use quotation marks for emphasis.',
    '  THE FACTS YOU MAY NOT USE. The user turn carries a list of things a researcher knows about',
    '    this company that the company own page does not say. None of them appears in the letter,',
    '    in any wording.',
    '  THE CV IS THE EVIDENCE BASE. The letter argues from the CV text in the user turn and adds no',
    '    experience, tool, result or responsibility that is not on it.',
    '  THE CURRENT EMPLOYER is described only in the words the CV uses for it. Do not reach for an',
    '    industry label of your own.',
    '  TWO LANGUAGES ARE NEVER CLAIMED: TypeScript, JavaScript. The candidate writes neither, they',
    '    were removed from the CV on the candidate own instruction, and no bridge, no "familiar',
    '    with" and no mirroring of the posting brings them back.',
    '  RETRIEVAL, if the letter mentions it at all, is full text search plus tool calling. Never',
    '    describe it as vector search, a vector database or embeddings.',
    '  DASHES. The characters U+2013 and U+2014 do not appear anywhere in your answer. Use a comma,',
    '    a colon or a full stop. This is a standing correction and it is checked on the raw output',
    '    with no substitution step, so one of them costs a rewrite.',
    '  NO GENDERED PRONOUNS anywhere in the answer.',
    '',
    'OUTPUT FORMAT. Return exactly this and nothing around it. No preamble, no explanation, no',
    'markdown fence, no heading.',
    '',
    LETTER_OPEN,
    'Hi,',
    '',
    '(the letter, in the skeleton above)',
    '',
    '(the candidate name alone)',
    LETTER_CLOSE,
    SCREEN_OPEN,
    'objection 1: <one sentence copied VERBATIM from the letter you just wrote, the sentence that answers objection 1>',
    'objection 2: <one sentence copied VERBATIM from the letter, the sentence that answers objection 2>',
    'objection 3: <one sentence copied VERBATIM from the letter, the sentence that answers objection 3>',
    'gap: <one sentence copied VERBATIM from the letter, the sentence that names the honest gap>',
    '',
    'THE SCREENING NOTE IS NOT PART OF THE LETTER. It never ships to the employer; it goes to the',
    'folder README a human reads, and to a checker that verifies each sentence you name is really in',
    'the letter, character for character. A sentence you paraphrase there fails that check and costs',
    'a rewrite, so copy, do not summarise. One line per objection, in the order the user turn lists',
    'them, plus the gap line. If there are fewer than three objections, write one line per objection',
    'given and no more.',
  ].join('\n');
}

// TONE. The delivery check, kept as its own constant because that is the shape the voice sync
// reads for (`const SYSTEM = ...;` then `const TONE`), and because it is a different kind of
// instruction from the rubric: the rubric is the brief, this is what you do before you answer.
//
// Defect 7 is the reason it is worth its tokens. The writer eval's own history recorded two dash
// slips in six on a FIRST pass. Unattended that is roughly three held pairs a day, and the fix
// downstream is a paid rewrite. A checklist the model runs before it answers is the cheapest place
// to catch the class.
function toneBlock() {
  return [
    'BEFORE YOU ANSWER, read your draft back once against this list. It is the same list the',
    'checker runs, so anything you fix here is a call you do not spend.',
    '  1. Read it against the phrasing samples in the voice section. Any sentence that could have',
    '     come from any competent AI gets rewritten in the candidate own words.',
    '  2. Scan for the two dash characters. Zero, including inside the screening note.',
    '  3. Count the words in the letter. Between ' + WORD_MIN + ' and ' + WORD_MAX + '.',
    '  4. Every figure: is it on the approved list, or inside the quoted span.',
    '  5. Every objection: point at the sentence that answers it. If you cannot, the letter is not',
    '     finished.',
    '  6. The last line is the candidate name alone.',
  ].join('\n');
}

// soul.md is GITIGNORED, so a fresh clone of the public repo does not have it and this build stops
// here with a sentence rather than an ENOENT. That is the right outcome: the one prose node in this
// workflow cannot be built without the voice it is supposed to write in, and a version of it that
// shipped anyway would produce letters under his name in nobody's register.
const SOUL_FILE = path.join(S2.REPO, 'soul.md');
if (!fs.existsSync(SOUL_FILE)) {
  throw new Error(
    'Build Writer Request: soul.md is not at ' + path.relative(S2.REPO, SOUL_FILE) + '.\n' +
    '  It is gitignored and local only, so a fresh clone of this PUBLIC repo will not have it. This node\n' +
    '  bakes the voice block from it at build time and refuses to build without it, because the\n' +
    '  alternative is a prose node that writes every cover letter in generic English under his name.\n' +
    '  Restore it from the encrypted vault backup before building this workflow.'
  );
}
const VOICE_BLOCK = VOICE.buildVoiceBlock(fs.readFileSync(SOUL_FILE, 'utf8'));
const SYSTEM_TEXT = rubric() + '\n\n' + VOICE_BLOCK;
const TONE_TEXT = toneBlock();

// Run AFTER the LOGIC template below, not here: it calls renderJsCode(), which reads LOGIC, and a
// const is in its temporal dead zone until its own line runs. The invocation sits under LOGIC.
function assertAgainstUpstream() {
  const asm = require('./28-assemble-cv.js');
  if (asm.name !== 'Assemble CV') {
    throw new Error('Build Writer Request: node 28 is named ' + JSON.stringify(asm.name) + ' and this node connects from "Assemble CV". Rename both in the same edit.');
  }
  const ac = String(asm.parameters.jsCode || '');
  if (ac.indexOf('pair.cv_text = renderText(') === -1) {
    throw new Error('Build Writer Request: Assemble CV no longer stamps cv_text from the master strings. The letter argues from the CV, so a pair with no cv_text must never reach a paid writer call.');
  }
  if (ac.indexOf('pair.cv_selection = {') === -1) {
    throw new Error('Build Writer Request: Assemble CV no longer stamps cv_selection. The writer reports what the letter was allowed to argue from and the README names the bridge line out of it.');
  }

  LN.prices(MODEL);
  if (MIN_CACHE_TOKENS === undefined) {
    throw new Error('Build Writer Request: no cacheable-prefix minimum is recorded for ' + JSON.stringify(MODEL) + '. Below the minimum the cache_control marker does nothing and reports nothing.');
  }
  if (!MASTER_KEYS.length) {
    throw new Error('Build Writer Request: no master lane keys resolved from the lane file, so there is no approved numbers list and no work authorization line to give the writer.');
  }
  if (!Number.isInteger(WRITE_MAX_TOKENS) || WRITE_MAX_TOKENS < 1024) {
    throw new Error('Build Writer Request: the write max_tokens read out of the intake cost model is ' + JSON.stringify(WRITE_MAX_TOKENS) + '. A ' + WORD_MAX + ' word letter plus a four line screening note does not fit in less, and this model runs adaptive thinking inside the same ceiling.');
  }

  // --- THE NAME, AND THE ONE THING IT BUYS -----------------------------------------------------
  if (NODE_NAME !== 'Build Writer Request') {
    throw new Error('Build Writer Request: this node is named ' + JSON.stringify(NODE_NAME) + '. scripts/lib/sync-n8n-voice.js enrols by that exact name, so renaming it silently disconnects this lane from the voice sync and every letter ships in generic English.');
  }
  if (VOICE.NODE !== NODE_NAME) {
    throw new Error('Build Writer Request: sync-n8n-voice.js now looks for a node called ' + JSON.stringify(VOICE.NODE) + ' and this node is called ' + JSON.stringify(NODE_NAME) + '. Change both in the same edit or the injection silently stops.');
  }

  // --- THE VOICE BLOCK, FAIL CLOSED AT BUILD TIME ----------------------------------------------
  if (SYSTEM_TEXT.indexOf(VOICE.START) === -1 || SYSTEM_TEXT.indexOf(VOICE.END) === -1) {
    throw new Error('Build Writer Request: the system block carries no soul voice markers. Refusing to build a prose node that would write every letter in generic English.');
  }
  if (VOICE_BLOCK.indexOf('Voice Rules') === -1) {
    throw new Error('Build Writer Request: the block sync-n8n-voice.js built from soul.md does not contain the Voice Rules section. Something changed in that builder and the block would be a header with nothing under it.');
  }

  // The real reader, run against the real generated source. Everything else in this seat is an
  // assertion about a shape; this is the shape being READ by the code that has to read it.
  const probe = renderJsCode();
  const live = VOICE.extractLiveBlock(probe);
  if (live.err) {
    throw new Error(
      'Build Writer Request: sync-n8n-voice.js extractLiveBlock() cannot find the voice block in this\n' +
      '  node generated source: ' + live.err + '.\n' +
      '  That function is the one the live sync and the drift checker both use. If it cannot parse this\n' +
      '  node, the sync refuses to write, reports nothing useful, and every letter this lane ships is\n' +
      '  written by a model that was never shown his voice. The shape it needs is exactly:\n' +
      '    const SYSTEM = <a JSON string literal>;\n' +
      '    const TONE ...'
    );
  }
  if (VOICE.stablePart(live.block) !== VOICE.stablePart(VOICE_BLOCK)) {
    throw new Error('Build Writer Request: the block extractLiveBlock() read back is not the block that was baked. The literal is being mangled somewhere between here and JSON.stringify.');
  }

  // --- THE CACHE BREAKPOINT --------------------------------------------------------------------
  // The system block is identical for every pair on every lane in a run, so it is one cache write
  // and then reads at a tenth of the input price. It fails SILENTLY below the model minimum.
  const sys = SYSTEM_TEXT + '\n\n' + TONE_TEXT;
  const estTokens = Math.floor(sys.length / 4);
  if (estTokens < MIN_CACHE_TOKENS) {
    throw new Error(
      'Build Writer Request: the system block is about ' + estTokens + ' tokens (' + sys.length + ' characters) and the\n' +
      '  minimum cacheable prefix on ' + MODEL + ' is ' + MIN_CACHE_TOKENS + '. Below the minimum the cache_control marker\n' +
      '  does NOTHING and reports nothing, so the rubric and the whole voice block are paid for at full\n' +
      '  price on every pair.'
    );
  }

  // --- THE NO DASH LAW, PROVED OVER THE EXACT BYTES THAT LEAVE THIS MACHINE ---------------------
  // A rubric that uses a character is a rubric that teaches the model to use it, and the voice
  // block is assembled from soul.md by a function this seat does not own.
  if (sys.indexOf(String.fromCharCode(8212)) !== -1 || sys.indexOf(String.fromCharCode(8211)) !== -1) {
    throw new Error('Build Writer Request: the system block contains an em dash or an en dash. No file in this system carries either character, and this is the one prompt in the workflow whose output is judged on exactly that.');
  }
  // The two language names appear once each, inside the rule that forbids them. More than that
  // means something leaked a claim into the prompt.
  for (const word of ['TypeScript', 'JavaScript']) {
    const hits = (sys.match(new RegExp('\\b' + word + '\\b', 'g')) || []).length;
    if (hits > 1) {
      throw new Error('Build Writer Request: the system block names ' + word + ' ' + hits + ' times. Once is the rule that forbids it; more than once means the prompt is teaching the model a claim that was pruned on his own instruction.');
    }
  }
  // No contact detail may sit in a prompt that leaves this machine on every pair. The rubric
  // carries none by construction; the VOICE block is assembled from soul.md, which is not this
  // seat's file, so it is checked rather than assumed.
  const leaked = S2.contactHitsIn(sys);
  if (leaked.length) {
    throw new Error(
      'Build Writer Request: the system block contains ' + leaked.length + ' contact detail(s): ' +
      JSON.stringify(leaked.map((h) => h.pattern)) + '.\n' +
      '  The writer has no use for one and this block is sent to a third party on every pair. It is not\n' +
      '  the rubric: check what buildVoiceBlock() pulled out of soul.md My Words.'
    );
  }

  // --- WHAT THE WRITER IS GIVEN ABOUT HIM ------------------------------------------------------
  for (const key of MASTER_KEYS) {
    if (!WORK_AUTH[key]) {
      throw new Error('Build Writer Request: the ' + key + ' master carries no "Work authorization:" line. The letter opener answers the location gate from that line and A11 asserts the CV carries it, so a master without one would make both a fiction.');
    }
    if (!APPROVED_NUMBERS[key] || APPROVED_NUMBERS[key].length < 5) {
      throw new Error('Build Writer Request: the ' + key + ' approved numbers list has ' + ((APPROVED_NUMBERS[key] || []).length) + ' entries. It is derived from his own CV text and writer notes, so a near empty list means the derivation broke, and A8 would then fail every honest letter that carries a figure he actually stands behind.');
    }
  }

  if (WORD_MIN !== 100 || WORD_MAX !== 280) {
    throw new Error('Build Writer Request: the letter band read out of voice-rules.js is ' + WORD_MIN + ' to ' + WORD_MAX + ' and the approved plan fixes it at 100 to 280. The band is read rather than restated so the rubric and the audit cannot disagree; if it moved on purpose, move the plan note in the same edit.');
  }
}

const LOGIC = `
// ---------------------------------------------------------------------------
// Build Writer Request. One Anthropic body per live pair. THE ONE PROSE NODE.
// ---------------------------------------------------------------------------
const NL = String.fromCharCode(10);

function txt(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

// The voice block, checked on the CONSTANT this node actually sends. A build cannot ship without
// it, so a false here means the live node was edited, partially synced, or restored from an old
// backup. Any of those and the letter is written by a model that never saw his voice, which is the
// one failure in this workflow that looks completely healthy from every count on the sheet.
const VOICE_BLOCK_PRESENT = SYSTEM.indexOf(VOICE_START) !== -1 && SYSTEM.indexOf(VOICE_END) !== -1;

const SYSTEM_TEXT = SYSTEM + NL + NL + TONE;

const items = $input.all().map((i) => i.json);
if (!items.length) {
  throw new Error('Build Writer Request: Assemble CV delivered no items at all. It emits at least its own stage report on every path, so an empty input means that node did not run and every lane report has already been lost.');
}

let built = 0;
let skipped = 0;
let heldNoVoice = 0;
const skipReasons = {};
const byLane = {};
const out = [];

for (const raw of items) {
  const j = Object.assign({}, raw);

  // Every item carries the routing boolean, reports included. Under strict type validation on
  // Write Route an undefined boolean is an ERROR rather than a false.
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

  // Stamped on every live pair whatever happens next, because A16 reads it and an absent field
  // under a strict check is not the same as a false.
  j.voice_block_present = VOICE_BLOCK_PRESENT;

  if (!VOICE_BLOCK_PRESENT) {
    j._status = 'needs_review';
    j._status_class = 'hold';
    j._sheet_action = 'write_status';
    j._status_why = 'the writer system block carries no soul voice markers, so this letter would be written in generic English under his name. The build refuses to produce a node without the block, so a live node missing it was edited by hand, partially synced, or restored from an old backup. Re-run node scripts/generate-alex.js, or rebuild this workflow. Nothing was sent and nothing was paid for.';
    j._call_now = false;
    heldNoVoice += 1;
    skipped += 1;
    skipReasons['needs_review'] = (skipReasons['needs_review'] || 0) + 1;
    out.push(j);
    continue;
  }

  const key = txt(j.master_key);
  const approved = APPROVED_NUMBERS[key] || null;
  const workAuth = WORK_AUTH[key] || null;
  const cvText = txt(j.cv_text);

  if (!cvText || !approved || !workAuth) {
    // Unreachable on a healthy run: Assemble CV holds a pair it could not build, and both tables
    // are baked per lane. Kept as a refusal because the alternative is a paid call that asks a
    // model to argue from a CV it was never shown.
    j._status = 'needs_review';
    j._status_class = 'hold';
    j._sheet_action = 'write_status';
    j._status_why = !cvText
      ? 'this pair reached the writer with no cv_text. The letter argues from the CV, so there is nothing to argue from and nothing is guessed.'
      : 'this pair carries master_key ' + JSON.stringify(key) + ' and this workflow was built with approved figures and a work authorization line for ' + JSON.stringify(Object.keys(APPROVED_NUMBERS)) + ' only.';
    j._call_now = false;
    skipped += 1;
    skipReasons['needs_review'] = (skipReasons['needs_review'] || 0) + 1;
    out.push(j);
    continue;
  }

  const brief = j.brief || {};
  const research = j.research || {};
  const objections = Array.isArray(brief.objections) ? brief.objections : [];
  const bannedFacts = Array.isArray(research.banned_facts) ? research.banned_facts : [];

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
    : '  (the recruiter returned none. Write the letter without an objection section and write no objection lines in the screening note.)';

  // THE ONLY TWO SPANS THAT MAY BE QUOTED. Both were proved to be substrings of text this run
  // actually fetched: quote_line against the posting at Parse Job Brief, the hook against the
  // employer page at Parse Research. Nothing else in this prompt may end up inside quotation marks.
  const quoteLine = (brief.quote_verified === true && txt(brief.quote_line)) ? txt(brief.quote_line) : '';
  const hook = (research.hook && typeof research.hook === 'object') ? research.hook : null;
  const hookQuote = hook ? txt(hook.quote) : '';
  const quoteLines = [];
  if (quoteLine) quoteLines.push('  from the posting: ' + JSON.stringify(quoteLine));
  if (hookQuote) quoteLines.push('  from the company own site (' + txt(hook.url) + '): ' + JSON.stringify(hookQuote) + (hook.why ? NL + '    why it was picked: ' + txt(hook.why) : ''));
  const quoteText = quoteLines.length
    ? quoteLines.join(NL)
    : '  (none. No verbatim span was proved this run, so the letter uses NO quotation marks at all and beat three argues without one.)';

  const ucLines = j.uc_context_required === true
    ? 'TWO lines introducing the current employer, for a reader outside its home market who will not know it. Use only what the CV says about it.'
    : 'ONE line is enough. This reader already knows the current employer.';

  const rtw = txt(brief.right_to_work_country);
  const rtwText = rtw
    ? 'THE POSTING ASKS FOR EXISTING RIGHT TO WORK IN ' + rtw.toUpperCase() + ', WHICH THE CANDIDATE DOES NOT HOLD.' + NL +
      '  State where the candidate can work, in the words of the work authorization line above. Do not' + NL +
      '  claim, imply, or leave open the possibility of holding ' + rtw + ' work rights. Do not apologise' + NL +
      '  and do not offer to obtain them.'
    : '  (the posting states no right to work requirement.)';

  const bannedText = bannedFacts.length
    ? bannedFacts.map((b) => '  ' + txt(b)).join(NL)
    : '  (none recorded.)';

  const userText =
    'Write the cover letter for the posting below and return it in the two blocks the system block' + NL +
    'specifies.' + NL + NL +
    'THE ROLE, as a senior recruiter read the posting. These are facts extracted from the posting,' + NL +
    'never the posting itself.' + NL +
    JSON.stringify(ask, null, 1) + NL + NL +
    'THE OBJECTIONS a screener would raise. Every one is answered in the body, in this order.' + NL +
    objectionText + NL + NL +
    'THE EMPLOYER OWN WORDS. The only spans that may appear inside quotation marks.' + NL +
    quoteText + NL + NL +
    'WHAT THE COMPANY DOES, one line, for context only:' + NL +
    '  ' + (txt(research.company_line) || '(not established this run.)') + NL + NL +
    'FACTS YOU MAY NOT USE. A researcher knows these and the company own page does not say them.' + NL +
    'None of them appears in the letter, in any wording.' + NL +
    bannedText + NL + NL +
    'THE CV THAT SHIPS WITH THIS LETTER. Every sentence of it is the candidate own writing and is' + NL +
    'frozen. The letter argues from these and adds nothing they do not support.' + NL +
    '---' + NL +
    cvText + NL +
    '---' + NL + NL +
    'THE APPROVED FIGURES. Every number in the letter is one of these, or appears inside the' + NL +
    'employer own words above. Nothing else, in any form.' + NL +
    '  ' + approved.join(', ') + NL + NL +
    'THE WORK AUTHORIZATION LINE, exactly as the CV states it:' + NL +
    '  ' + workAuth + NL +
    rtwText + NL + NL +
    'THE CURRENT EMPLOYER, beat two: ' + ucLines + NL + NL +
    'LENGTH: between ' + WORD_MIN + ' and ' + WORD_MAX + ' words in the letter.' + NL;

  j.write_request = {
    model: WRITE_MODEL,
    max_tokens: WRITE_MAX_TOKENS,
    system: [
      {
        type: 'text',
        text: SYSTEM_TEXT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      { role: 'user', content: [{ type: 'text', text: userText }] },
    ],
  };
  // The rewrite is a SECOND USER TURN on this same object (defect 7), so the audit needs the draft
  // and the original request together and nothing needs rebuilding.
  j._write = {
    model: WRITE_MODEL,
    max_tokens: WRITE_MAX_TOKENS,
    master_key: key,
    system_chars: SYSTEM_TEXT.length,
    user_chars: userText.length,
    voice_block_present: VOICE_BLOCK_PRESENT,
    objections_given: objections.length,
    quote_spans_given: quoteLines.length,
    banned_facts_given: bannedFacts.length,
    approved_numbers: approved,
    work_auth_line: workAuth,
    uc_context_required: j.uc_context_required === true,
    right_to_work_country: rtw || null,
    word_band: { min: WORD_MIN, max: WORD_MAX },
    markers: { letter_open: LETTER_OPEN, letter_close: LETTER_CLOSE, screen_open: SCREEN_OPEN },
    cache_breakpoint: 'the system block, which is the rubric plus the soul voice block and is byte identical for every pair on every lane in a run. One cache write and then reads at a tenth of the input price.',
    seat: 'a senior technical recruiter with twenty years of screening experience, writing the letter that has to survive a six second read. The recruiter lens decides what earns a line and in what order; the soul voice block decides the wording, and it outranks any instinct toward polished corporate English.',
    contract: 'the raw posting never reaches this model. It gets the structured brief the recruiter seat produced, two verbatim spans that were each proved to be a substring of text this run actually fetched, the CV it must argue from, and a negative list of facts it may not use.',
  };
  j._call_now = true;
  built += 1;
  byLane[key] = (byLane[key] || 0) + 1;
  out.push(j);
}

const warnings = [];
if (heldNoVoice > 0) {
  warnings.push('THE SOUL VOICE BLOCK IS MISSING FROM THE LIVE WRITER NODE. ' + heldNoVoice + ' pair(s) were held before a single token was spent. The build refuses to produce this node without the block, so the live workflow has been edited, partially synced or restored from an old backup. Every letter it would have written would have read as generic English under his name and every count on this run would still have been green.');
}

const report = {
  _kind: 'stage_report',
  stage: 'write_request',
  model: WRITE_MODEL,
  max_tokens: WRITE_MAX_TOKENS,
  requests_built: built,
  by_master_lane: byLane,
  pairs_skipped: skipped,
  skipped_by_status: skipReasons,
  voice: {
    block_present: VOICE_BLOCK_PRESENT,
    held_for_missing_block: heldNoVoice,
    enrolment: 'scripts/lib/sync-n8n-voice.js injects the block into the ONE node named Build Writer Request. The block is also baked at build time so a rebuild cannot strip it, and the two agree by construction because both are built by the same function from soul.md.',
    rule: 'fail closed. No block means the pair is held before any paid call, never written in generic English.',
  },
  word_band: { min: WORD_MIN, max: WORD_MAX },
  system_chars: SYSTEM_TEXT.length,
  cache: {
    breakpoint: 'system block, ephemeral, one for the whole run across both lanes',
    model_minimum_tokens: MIN_CACHE_TOKENS,
  },
  seat: 'a senior technical recruiter with twenty years of experience, deciding in six seconds. The three objections are mandatory inputs and each is answered in the body; what the screener needs comes first. The WORDS stay his.',
  screening_note: 'after the letter the model emits a screening note naming, verbatim, the sentence that answers each objection and the sentence that names the honest gap. It goes to the README and to the audit and NEVER into the letter.',
  _call_now: false,
  site_fetch_url: '',
  ad_fetch_url: '',
};
out.push(report);

return out.map((j) => ({ json: j, pairedItem: { item: 0 } }));
`;

assertAgainstUpstream();

// Built by a function so the build-time assertion above can run the REAL reader against the REAL
// bytes, rather than against a reconstruction of them.
function renderJsCode() {
  return [
    '// GENERATED at build time from work/36-job-application-writer/nodes/29-build-writer-request.js.',
    '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
    '//',
    '// THE SOUL VOICE BLOCK LIVES INSIDE THE SYSTEM LITERAL BELOW, between the markers.',
    '// scripts/lib/sync-n8n-voice.js refreshes it in place when soul.md changes. It finds the literal',
    '// by searching this source for the SYSTEM declaration and then for the TONE line that terminates',
    '// it, so do not rename either constant, do not reorder them, and do not put anything between them.',
    '// (Neither phrase is spelled out in a comment anywhere in this file: the search takes the FIRST',
    '// match, and a comment that quoted it would be found before the declaration and parsed as one.)',
    'const SYSTEM = ' + JSON.stringify(SYSTEM_TEXT) + ';',
    'const TONE = ' + JSON.stringify(TONE_TEXT) + ';',
    'const VOICE_START = ' + JSON.stringify(VOICE.START) + ';',
    'const VOICE_END = ' + JSON.stringify(VOICE.END) + ';',
    'const WRITE_MODEL = ' + JSON.stringify(MODEL) + ';',
    'const WRITE_MAX_TOKENS = ' + JSON.stringify(WRITE_MAX_TOKENS) + ';',
    'const MIN_CACHE_TOKENS = ' + JSON.stringify(MIN_CACHE_TOKENS) + ';',
    'const WORD_MIN = ' + JSON.stringify(WORD_MIN) + ';',
    'const WORD_MAX = ' + JSON.stringify(WORD_MAX) + ';',
    'const LETTER_OPEN = ' + JSON.stringify(LETTER_OPEN) + ';',
    'const LETTER_CLOSE = ' + JSON.stringify(LETTER_CLOSE) + ';',
    'const SCREEN_OPEN = ' + JSON.stringify(SCREEN_OPEN) + ';',
    'const APPROVED_NUMBERS = ' + JSON.stringify(APPROVED_NUMBERS) + ';',
    'const WORK_AUTH = ' + JSON.stringify(WORK_AUTH) + ';',
    LOGIC,
  ].join('\n');
}

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [7020, 100],
  connectFrom: 'Assemble CV',
  notes: 'THE ONE PROSE NODE. Assembles one Anthropic /v1/messages body per live pair: a cached system block carrying the senior recruiter lens, the letter skeleton, the hard rules and the soul voice block baked from soul.md at build time, then a user turn with the structured brief, the three objections, the two verbatim spans that were proved against fetched text, the CV the letter must argue from, the approved figures and the negative facts list. The RAW POSTING NEVER REACHES THIS MODEL. Reads $json only, never $(), so the regression eval can feed it from any fixture node. Stamps voice_block_present and holds the pair before any paid call when the block is gone. claude-sonnet-5.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: renderJsCode(),
  },
};

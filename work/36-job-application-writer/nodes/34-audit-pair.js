'use strict';
/*
 * 34-audit-pair.js - "Audit Pair". The deterministic A1 to A18 scan over the CV and the letter.
 *
 * =============================================================================================
 * 1. A CV FAILURE AND A LETTER FAILURE ARE DIFFERENT KINDS OF NEWS.
 * =============================================================================================
 * The CV is verbatim master by construction: Assemble CV emits strings looked up by content hashed
 * id, and the ONE line that is not his writing, the bridge, was already checked against these exact
 * rules and dropped rather than shipped if it failed. So a CV that fails this audit is not a bad
 * selection and it is not a bad letter. It means THE ASSEMBLER IS WRONG, or a master changed under
 * a pinned id, and neither of those is fixed by asking a model to try again.
 *
 * A CV failure therefore goes straight to needs_review. It is never rewritten, and the reason says
 * which check failed on which text, because that is the sentence somebody needs in order to go and
 * look at the right file.
 *
 * A LETTER failure gets exactly ONE reasoned rewrite. Defect 7 from the plan review is the reason
 * it is not optional: the writer eval's own history recorded two dash slips in six on a first pass,
 * and unattended that is roughly three held pairs a day on a cap of ten. The rewrite is a second
 * user turn on the SAME request object, naming every failed check, which is cheap because the
 * system block is already in the cache.
 *
 * =============================================================================================
 * 2. THE RULES ARE BAKED FROM scripts/lib/voice-rules.js, NEVER RETYPED.
 * =============================================================================================
 * That file is the ONE definition in this repo of what a dash is, what an AI tell is, which
 * pronouns are forbidden and which claims are banned. The box cannot require it, so
 * `renderRuntimeSource()` emits the literal and it is injected below, exactly as Assemble CV does
 * for the bridge line check. Retyping the tells list into a Code node is precisely how the live
 * Writer Voice Eval ended up with seventeen entries while the grader rubric had thirteen.
 *
 * THE TELLS LIST IS ONE LIST, and this seat did not reconcile it a second time. Seat 2 already
 * merged the three sources: the live eval's 17, the rubric PV2's 13 (a strict subset of the 17),
 * and soul.md Detection-proofing rules 3 and 6. Nothing was dropped, two hedges from rule 3 and
 * fifteen fixed-string shapes from rule 6 were added, and the result is voice-rules.js TELLS. That
 * is the list this node uses and the list the CLI reports, because it is the same array.
 *
 * =============================================================================================
 * 3. WHAT IS DERIVED RATHER THAN WRITTEN DOWN, AND WHY IT MATTERS TWICE.
 * =============================================================================================
 * The approved figures, the work authorization line, his name, his city and his current employer
 * are all READ out of the masters at build time. Twice useful: this file is tracked in a PUBLIC
 * repo and carries none of them, and a derived value cannot go stale the day he amends a master,
 * which is exactly when a hand written expectation would start failing every honest letter.
 *
 * Where a derivation cannot establish its value, the check that depends on it reports N/A with the
 * reason. A check that quietly passes because its expectation is an empty string is worse than no
 * check, and it is the failure mode this whole project keeps naming.
 *
 * =============================================================================================
 * 4. TWO PLACES WHERE THIS AUDIT IS DELIBERATELY STRICTER THAN THE PLAN'S ONE LINE.
 * =============================================================================================
 * A15 in the plan is "quote_line, when present, is a substring of ad_text". That is re-proved here.
 * It also checks the other direction, which is the one that can actually hurt: EVERY span the
 * letter puts inside quotation marks must be a real substring of the posting or of the employer
 * page this run fetched. A letter that quotes a company back to itself using a sentence the company
 * never wrote is the single most embarrassing failure this lane can produce, and it is invisible to
 * a check that only looks at the field the reader filled in.
 *
 * A12 in the plan is "no claim of UK or US right to work". Written naively that check FAILS the
 * letter the plan requires: D17 says a UK posting asking for right to work is answered honestly,
 * naming it as a fact. So the pattern is negation aware, sentence by sentence, and the limitation
 * is stated rather than hidden: a claim buried in a sentence that also contains a negation about
 * something else will pass. That is the right direction to be wrong in, because the alternative
 * rewrites every honest UK letter.
 *
 * =============================================================================================
 * 5. auditPair() IS LIFTED BY NODE 38, NOT COPIED.
 * =============================================================================================
 * Audit Pair Final runs the SAME scan. It lifts these exact bytes at build time, together with the
 * exact AUDIT_CFG line, so the two cannot disagree about what a pass is. That is the shared
 * template the seat brief asks for, made of the same bytes rather than of the same intention.
 */

const fs = require('fs');
const path = require('path');

const LN = require('./_lane');
const S2 = require('./_stage2');
const MASTER = require('./_master');
const VR = require(path.join(S2.REPO, 'scripts', 'lib', 'voice-rules.js'));

const NODE_NAME = 'Audit Pair';
const N29 = './29-build-writer-request.js';
const N33 = './33-parse-letter.js';

const REWRITE_MODEL = LN.STAGE_MODELS.rewrite;
const REWRITE_MAX_TOKENS = S2.readSourceNumber(
  './05-build-candidates.js',
  /\{\s*stage:\s*'rewrite',[^}]*out_tokens:\s*(\d+)\s*\}/,
  "the rewrite row of COST_MODEL (its out_tokens is the rewrite call's max_tokens)"
);

const PARA_CHARS_MAX = S2.PARA_CHAR_CEILING;
const MASTER_KEYS = S2.masterKeys();

// ---------------------------------------------------------------------------------------------
// THE FILENAME LAW. Read out of the enforcing script rather than restated.
//
// `node scripts/outputs-ledger.js validate` exits 2 on any CV or cover letter deliverable dated on
// or after 2026-08-20 whose filename carries more than his name. Its regex is the law as CODE, so
// the two filenames this workflow will ship are checked against THAT, here, at build time. A17 then
// asserts them at run time and stamps them onto the pair, which is where the render seat reads them
// from instead of inventing a pair of strings of its own.
// ---------------------------------------------------------------------------------------------
function filenameLaw() {
  const src = fs.readFileSync(path.join(S2.REPO, 'scripts', 'outputs-ledger.js'), 'utf8');
  const m = /const CV_ALLOWED = (\/.+\/);/.exec(src);
  if (!m) {
    throw new Error(
      'Audit Pair: could not read CV_ALLOWED out of scripts/outputs-ledger.js.\n' +
      '  The filename law is enforced by that script (exit 2, called by the Monday recovery sweep C12),\n' +
      '  so the two filenames this lane ships are checked against the real regex rather than against a\n' +
      '  second copy of it. If the shape changed, fix this reader in the same edit.'
    );
  }
  const body = m[1];
  const lastSlash = body.lastIndexOf('/');
  return new RegExp(body.slice(1, lastSlash), body.slice(lastSlash + 1));
}
const CV_ALLOWED = filenameLaw();
const CV_FILENAME = 'Shaheen_Kiarash_CV.pdf';
const LETTER_FILENAME = 'Shaheen_Kiarash_Cover_Letter.pdf';

// ---------------------------------------------------------------------------------------------
// DERIVATIONS FROM THE MASTERS. Two header shapes exist and both are handled by name, because a
// derivation that silently matched one of them would make every check on the other lane vacuous.
//
//   the AI master heads with an h1 name line and a single contact line
//   the Power BI master heads with labelled bullets (Name:, Location:, Work authorization:)
//
// Every value below is asserted after derivation. A null value makes its check report N/A with the
// reason, never pass.
// ---------------------------------------------------------------------------------------------
function deriveIdentity(key) {
  const m = MASTER.parseMaster(key);
  const hdr = m.blocks.filter((b) => b.section === 'hdr');
  const all = m.blocks.map((b) => b.text).join('\n');

  // NAME. Labelled bullet first, then the h1 line.
  let name = null;
  const labelled = /(^|\n)\s*(?:-\s*)?Name:\s*([^\n|]+)/.exec(all);
  if (labelled) name = labelled[2].trim();
  if (!name) {
    const h1 = hdr.filter((b) => b.level === 'h1')[0];
    if (h1) name = String(h1.text).trim();
  }
  if (name && !/^[A-Za-z][A-Za-z'.-]*(\s+[A-Za-z][A-Za-z'.-]*){1,3}$/.test(name)) name = null;

  // CITY. The header line that carries the availability phrase opens with the city.
  let city = null;
  const availBlock = hdr.filter((b) => /availab/i.test(String(b.text)))[0];
  if (availBlock) {
    let t = String(availBlock.text).replace(/^\s*-\s*/, '').replace(/^[A-Za-z ]{3,20}:\s*/, '');
    t = t.split(',')[0].split('|')[0].trim();
    if (/^[A-Za-z][A-Za-z .-]{1,30}$/.test(t)) city = t;
  }

  // THE WORK AUTHORIZATION LINE, and the tokens the letter opener has to carry.
  let workAuth = null;
  const wa = /Work authorization:[^\n|]*/.exec(all);
  if (wa) workAuth = wa[0].trim();
  let workAuthTokens = [];
  if (workAuth) {
    const value = workAuth.replace(/^Work authorization:\s*/, '');
    const stop = ['citizen', 'citizens', 'work', 'authorization', 'authorisation', 'and', 'the', 'with', 'for'];
    workAuthTokens = (value.match(/[A-Za-z]{3,}/g) || []).filter((w) => stop.indexOf(w.toLowerCase()) === -1);
    workAuthTokens = Array.from(new Set(workAuthTokens));
  }

  // THE CURRENT EMPLOYER. An organisation followed by a parenthesised parent of two words or more,
  // inside an experience heading. The AI master's first heading is a self-directed role whose
  // parenthesis holds one word, so a naive first-match rule would pick the wrong thing.
  let employer = null;
  const headings = m.blocks.filter((b) => b.section === 'exp' && b.level === 'h3').map((b) => String(b.text));
  for (const h of headings) {
    const e = /([A-Z][A-Za-z.&]*(?:\s+[A-Z][A-Za-z.&]*){0,2})\s*\(([^)]+)\)/.exec(h);
    if (e && e[2].trim().split(/\s+/).length >= 2) {
      employer = { org: e[1].trim(), parent: e[2].trim() };
      break;
    }
  }

  return { name: name || null, city: city || null, work_auth: workAuth, work_auth_tokens: workAuthTokens, employer: employer };
}

const IDENTITY = {};
const APPROVED_NUMBERS = {};
for (const key of MASTER_KEYS) {
  IDENTITY[key] = deriveIdentity(key);
  APPROVED_NUMBERS[key] = MASTER.approvedNumbers(key).numbers;
}

// ---------------------------------------------------------------------------------------------
// A12's PATTERNS. Written here rather than derived, because no file in this repo knows them: they
// are English shapes for claiming a right to work. They are checked sentence by sentence against a
// negation list, so the honest sentence D17 REQUIRES ("the posting asks for X, which I do not
// hold") does not read as the claim it is denying.
//
// Stated limitation: a claim inside a sentence that also negates something else passes. That is the
// safe direction to be wrong in here. The alternative pattern, one that ignores negation, would
// rewrite every honest UK letter this lane is designed to produce.
// ---------------------------------------------------------------------------------------------
const RTW_COUNTRY = '(?:uk|u\\.k\\.|united kingdom|britain|british|england|us|u\\.s\\.|usa|u\\.s\\.a\\.|united states|america|american)';
const RTW_RIGHT = '(?:right to work|work permit|work authoriz\\w*|work authoris\\w*|eligible to work|authoriz\\w* to work|authoris\\w* to work|permission to work|work visa|working visa|visa)';
const RTW_PATTERNS = [
  { id: 'right-then-country', source: '\\b' + RTW_RIGHT + '\\b[^.!?]{0,80}\\b' + RTW_COUNTRY + '\\b', flags: 'gi' },
  { id: 'country-then-right', source: '\\b' + RTW_COUNTRY + '\\b[^.!?]{0,40}\\b' + RTW_RIGHT + '\\b', flags: 'gi' },
  { id: 'holds-a-status', source: '\\b(?:i\\s+(?:hold|have|carry)|holder of)\\s+(?:an?\\s+)?' + RTW_COUNTRY + '\\b', flags: 'gi' },
];
const NEGATION_WORDS = ['no', 'not', 'never', 'without', 'cannot', 'cant', 'dont', 'doesnt', 'lack', 'lacks', 'neither', 'nor', 'none'];

const SIGNOFF = { source: '\\b(best regards|kind regards|warm regards|sincerely|yours sincerely|yours faithfully|yours truly|best wishes|regards,)\\b', flags: 'i' };

const PARAGRAPHS = { min: 5, max: 14 };
const QUOTED_SPAN_MIN = 25;
const GREETING = 'Hi,';

const SYSTEMIC_KINDS = ['auth', 'credits', 'rate_limit', 'upstream', 'transport', 'not_found', 'too_large', 'pairing', 'node_did_not_run', 'bad_request'];

const AUDIT_CFG = {
  approved_numbers: APPROVED_NUMBERS,
  identity: IDENTITY,
  para_chars_max: PARA_CHARS_MAX,
  filenames: { cv: CV_FILENAME, letter: LETTER_FILENAME },
  paragraphs: PARAGRAPHS,
  quoted_span_min: QUOTED_SPAN_MIN,
  greeting: GREETING,
  rtw_patterns: RTW_PATTERNS,
  negation_words: NEGATION_WORDS,
  signoff: SIGNOFF,
  claim_scope: {
    typescript: 'both', javascript: 'both', bureau: 'both',
    'vector-rag': 'both', 'job-pipeline': 'both', 'roles-processed': 'both', 'voice-project': 'both',
  },
  // -------------------------------------------------------------------------------------------
  // IS A DENIAL OF THIS CLAIM STILL A VIOLATION? The seven claims split, and the split is read off
  // their OWN stated wording in voice-rules.js rather than invented here.
  //
  //   false means the rule says never MENTION the thing at all, so a denial still mentions it and
  //     is still a hit. "never the word bureau for UC" is about the WORD. "never mention the job
  //     application pipelines in ANY generated output" is about the SUBJECT, and a letter that says
  //     "I do not run a job application pipeline" has just told a recruiter that one exists.
  //   true means the rule says never CLAIM a capability. "NEVER claim TypeScript", "Never claim
  //     vector RAG or embeddings". A sentence that says he does NOT have the thing is the rule
  //     being obeyed out loud, and failing it is the audit arguing with the writer prompt, which
  //     ORDERS this letter to name an honest gap.
  //
  // Measured, 2026-09-16, letter-eval execution 5427: all three of C2's claim checks fired on one
  // honest sentence, "I don't have TypeScript or JavaScript on the CV, and I have not run a
  // production vector database, so I won't pretend retrieval augmented generation at scale is
  // proven work". Three FAILs, one sentence, and the sentence was right. A bare substring scan has
  // no polarity, so it cannot tell a claim from its opposite.
  // -------------------------------------------------------------------------------------------
  claim_denial: {
    typescript: true, javascript: true, 'vector-rag': true,
    bureau: false, 'job-pipeline': false, 'roles-processed': false, 'voice-project': false,
  },
};

// Everything above plain ASCII as an escape sequence, for the same two reasons voice-rules.js gives:
// a raw character could put a banned one into a node parameter, and the bake travels to the box as
// JSON over REST where ASCII survives with no encoding questions.
const NON_ASCII = new RegExp('[\\u007f-\\uffff]', 'g');
function asciiJson(value) {
  return JSON.stringify(value).replace(NON_ASCII, function (c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  });
}

// The number tokeniser and its normaliser, taken from voice-rules.js as SOURCE. A8 is only
// meaningful if the allowlist and the checker tokenise a number the same way, and the allowlist is
// built by these exact functions at build time. Lifting the source is the only way to guarantee
// that on a box that cannot require the file.
function bakedVoiceFunction(name, proofNeedle) {
  const fn = VR[name];
  if (typeof fn !== 'function') {
    throw new Error('Audit Pair: scripts/lib/voice-rules.js no longer exports ' + name + '(), which this audit bakes so the allowlist and the checker agree about what a number is.');
  }
  const src = fn.toString();
  if (src.indexOf(proofNeedle) === -1) {
    throw new Error('Audit Pair: voice-rules.js ' + name + '() no longer contains ' + JSON.stringify(proofNeedle) + '. That phrase is what proves the baked bytes are the function this audit meant to reuse.');
  }
  if (/[^\x00-\x7f]/.test(src)) {
    throw new Error('Audit Pair: voice-rules.js ' + name + '() contains a non ASCII character in its source. It is baked into a node parameter that travels as JSON over REST, and the no dash law forbids exactly the characters most likely to appear. Write the escape sequence in voice-rules.js instead.');
  }
  return 'function ' + name + src.slice(src.indexOf('(')) + ';';
}

const VOICE_RUNTIME = VR.renderRuntimeSource();
const NUMBER_RUNTIME = [
  bakedVoiceFunction('normalise', '\\u2018'),
  bakedVoiceFunction('wordCount', 'split(/\\s+/).length'),
  bakedVoiceFunction('extractNumbers', 'thousands separators'),
].join('\n');

// Run AFTER the LOGIC template below: it calls renderJsCode(), which reads LOGIC.
function assertAgainstUpstream() {
  const parse = require(N33);
  const build = require(N29);
  if (parse.name !== 'Parse Letter') throw new Error('Audit Pair: node 33 is named ' + JSON.stringify(parse.name) + ' and this node connects from "Parse Letter".');
  if (build.name !== 'Build Writer Request') throw new Error('Audit Pair: node 29 is named ' + JSON.stringify(build.name) + ' and the rewrite is a second user turn on the request object that node built.');

  const pc = String(parse.parameters.jsCode || '');
  if (pc.indexOf('pair.letter_text = ex.letter;') === -1) {
    throw new Error('Audit Pair: Parse Letter no longer stamps letter_text from the raw extraction. That field is what every letter scope check below reads.');
  }
  if (pc.indexOf('stripDashes') !== -1) {
    throw new Error(
      'Audit Pair: Parse Letter has acquired a dash sanitiser.\n' +
      '  A1 would then pass on a letter whose dashes were repaired on the way in, the blind grader would\n' +
      '  read tidy prose, and the writer reaching for a banned character would be invisible to every\n' +
      '  surface built to notice it. Remove the sanitiser rather than loosening this check.'
    );
  }
  const bc = String(build.parameters.jsCode || '');
  if (bc.indexOf('write_request') === -1 || bc.indexOf('j.voice_block_present = VOICE_BLOCK_PRESENT;') === -1) {
    throw new Error('Audit Pair: Build Writer Request no longer builds write_request or no longer stamps voice_block_present. The rewrite is built on that request object and A16 reads that flag.');
  }

  // The rules engine, baked from its own renderer.
  if (typeof VOICE_RUNTIME !== 'string' || VOICE_RUNTIME.indexOf('VOICE_RULES_SHA') === -1) {
    throw new Error('Audit Pair: voice-rules.js renderRuntimeSource() no longer produces a bakeable source carrying VOICE_RULES_SHA.');
  }
  for (const nm of ['TELLS', 'PRONOUN_RE', 'DASH_RE', 'CLAIMS', 'BAND']) {
    if (VOICE_RUNTIME.indexOf('const ' + nm) === -1) {
      throw new Error('Audit Pair: the baked voice rules no longer declare ' + nm + ', which this audit uses by name.');
    }
  }
  if (VR.PROFILES.letter.min !== 100 || VR.PROFILES.letter.max !== 280) {
    throw new Error('Audit Pair: the letter band in voice-rules.js is ' + VR.PROFILES.letter.min + ' to ' + VR.PROFILES.letter.max + ' and the approved plan fixes A3 at 100 to 280.');
  }
  // Every claim in the shared rules has a scope here. A claim with no scope would be checked on
  // nothing and the audit would report a green A6, A7, A9 or A10 that tested no text at all.
  for (const c of VR.CLAIMS) {
    if (!AUDIT_CFG.claim_scope[c.id]) {
      throw new Error('Audit Pair: voice-rules.js declares a banned claim ' + JSON.stringify(c.id) + ' and this audit gives it no scope, so it would be checked on no text at all and report green. Add it to claim_scope.');
    }
    // The SAME shape as the scope guard above, for the same reason. A new claim must not DEFAULT
    // into either behaviour: defaulting to deniable would let an honest sentence carry a claim the
    // rule bans outright, and defaulting to not-deniable would fail the honest gap the writer
    // prompt orders. Both are silent, so neither is allowed to happen by omission. Written as a
    // hasOwnProperty test rather than a truthiness test on purpose: `false` is a real answer here
    // and `!AUDIT_CFG.claim_denial[c.id]` would read it as a missing one.
    if (!Object.prototype.hasOwnProperty.call(AUDIT_CFG.claim_denial, c.id) || typeof AUDIT_CFG.claim_denial[c.id] !== 'boolean') {
      throw new Error(
        'Audit Pair: voice-rules.js declares a banned claim ' + JSON.stringify(c.id) + ' and this audit does not say whether a DENIAL of it is still a violation.\n' +
        '  Read that claim own `why` in voice-rules.js and decide: a rule that says never CLAIM the\n' +
        '  capability is deniable (true), a rule that says never MENTION the thing at all is not\n' +
        '  (false), because a denial still mentions it. Add it to claim_denial. There is deliberately\n' +
        '  no default: both defaults fail silently and in opposite directions.'
      );
    }
  }

  // The filename law, checked against the regex that enforces it.
  for (const f of [CV_FILENAME, LETTER_FILENAME]) {
    if (!CV_ALLOWED.test(f)) {
      throw new Error(
        'Audit Pair: the filename ' + JSON.stringify(f) + ' does not satisfy the law in scripts/outputs-ledger.js.\n' +
        '  Shaheen, 2026-08-20: only his name and CV or Cover Letter. The company, the role and the date\n' +
        '  live in the FOLDER name, never in the file a recruiter receives.'
      );
    }
  }
  if (CV_ALLOWED.test('Shaheen_Kiarash_AI_Engineer_Acme.pdf')) {
    throw new Error('Audit Pair: the filename law regex read out of the ledger accepts a company bearing filename, so it is not the law it is supposed to be. Check the reader.');
  }

  // The derivations. A null expectation makes its check report N/A, so a lane where several came
  // back null is worth refusing at build time rather than shipping an audit that tests nothing.
  for (const key of MASTER_KEYS) {
    const id = IDENTITY[key];
    if (!id.work_auth) {
      throw new Error('Audit Pair: the ' + key + ' master carries no "Work authorization:" line, so A11 would have no expectation to assert and would pass on any CV at all.');
    }
    if (!id.work_auth_tokens.length) {
      throw new Error('Audit Pair: the ' + key + ' work authorization line yielded no significant token, so the letter opener check would pass on a letter that answers the location gate with nothing.');
    }
    if (!id.name) {
      throw new Error('Audit Pair: could not derive the candidate name from the ' + key + ' master. The signature check asserts the last line IS that name, so a null expectation would pass on any closing line.');
    }
    if (!APPROVED_NUMBERS[key] || APPROVED_NUMBERS[key].length < 5) {
      throw new Error('Audit Pair: the ' + key + ' approved numbers list has ' + ((APPROVED_NUMBERS[key] || []).length) + ' entries. A8 would then fail every honest letter that carries a figure he actually stands behind.');
    }
  }

  if (!Number.isInteger(REWRITE_MAX_TOKENS) || REWRITE_MAX_TOKENS < 1024) {
    throw new Error('Audit Pair: the rewrite max_tokens read out of the intake cost model is ' + JSON.stringify(REWRITE_MAX_TOKENS) + '.');
  }
  if (REWRITE_MODEL !== LN.STAGE_MODELS.write) {
    throw new Error('Audit Pair: the rewrite is pinned to ' + REWRITE_MODEL + ' and the first pass to ' + LN.STAGE_MODELS.write + '. The plan says same transport, same model: the rewrite is the same writer given its own draft and the reasons it failed, not a second opinion from a different one.');
  }

  const generated = renderJsCode();
  if (generated.indexOf(String.fromCharCode(8212)) !== -1 || generated.indexOf(String.fromCharCode(8211)) !== -1) {
    throw new Error('Audit Pair: the generated source contains an em dash or an en dash, which is the exact character this node exists to refuse.');
  }

  // THE FOUR SHARED HELPERS ARE STILL LIFTABLE. Checked on the generated bytes rather than on this
  // source, because that is the string _stage2.bakedFunction() cuts, and a declaration that drifted
  // back inside a closure would still LOOK right in the file above. If this ever fails, the letter
  // eval has silently stopped running the lane's own claim rule or its own number-source list and
  // gone back to a second copy of one of them, which is exactly what divergences 5428 and D2 were.
  for (const nm of ['sentenceBounds', 'negatedAround', 'numberSources', 'numberAllowlist']) {
    if (generated.indexOf('\nfunction ' + nm + '(') === -1) {
      throw new Error(
        'Audit Pair: ' + nm + '() is no longer declared at column zero in the generated code.\n' +
        '  _stage2.bakedFunction() cuts a function by that exact line, so nesting it back inside\n' +
        '  auditPair() makes it unreachable to Audit Pair Final and to the letter eval, and the eval\n' +
        '  would quietly fall back to a second implementation of the claim rule. That is the 2026-09-16\n' +
        '  divergence, and this check is what refuses it.'
      );
    }
  }
  if (generated.indexOf('negatedAround(letterN, x.at, true, CFG.negation_words)') === -1 ||
      generated.indexOf('negatedAround(letterN, h.at, false, CFG.negation_words)') === -1) {
    throw new Error(
      'Audit Pair: the two negatedAround() callers no longer pass CFG.negation_words explicitly.\n' +
      '  It takes the list as an argument rather than closing over AUDIT_CFG so the lifted bytes work\n' +
      '  wherever they land. A caller that dropped the argument would get an empty list, which means\n' +
      '  NOTHING reads as a denial and every honest gap sentence fails again.'
    );
  }

  // ONE source list, TWO readers. A8 decides which figures are allowed and A15 decides which quoted
  // spans are proved, and both questions are "what employer text does this pair actually hold".
  // They were two hand-built lists until 2026-09-16 and they had already drifted once. If either
  // caller stops reading numSources, the next person to add a source adds it to one check.
  // Counted as "assignments FROM numberSources", not as the exact declaration line, because a second
  // caller under a different variable name is the drift this is here to refuse and an exact-line
  // count would sail straight past it.
  if ((generated.match(/const numSources = numberSources\(pair\);/g) || []).length !== 1 ||
      (generated.match(/=\s*numberSources\(/g) || []).length !== 1 ||
      generated.indexOf('numberAllowlist(approved, numSources)') === -1 ||
      generated.indexOf('numSources.some((s) => spanIsIn(span, s.text))') === -1) {
    throw new Error(
      'Audit Pair: A8 and A15 no longer share ONE call to numberSources(pair).\n' +
      '  A8 asks which figures a pair licenses and A15 asks which quoted spans it proves, and both are\n' +
      '  the same question about the same four fields. Two lists is how they drift, and the letter eval\n' +
      '  lifts numberSources() by name, so a second inline list would also stop reaching the eval.'
    );
  }
  if (NODE_NAME === 'Build Writer Request') {
    throw new Error('Audit Pair: this node must not be named "Build Writer Request". That name is the voice-sync enrolment key and belongs to the letter writer alone.');
  }
  if (generated.indexOf('SOUL_VOICE_START') !== -1) {
    throw new Error('Audit Pair: the generated source carries a soul voice block. This node checks prose against rules; it does not write any.');
  }
}

const LOGIC = `
// ---------------------------------------------------------------------------
// Audit Pair. A1 to A18, deterministic, on cv_text and letter_text.
// ---------------------------------------------------------------------------
const NL = String.fromCharCode(10);

function round6(n) { return Math.round(n * 1e6) / 1e6; }

// ---------------------------------------------------------------------------
// TWO HELPERS AT COLUMN ZERO, AND WHY THAT INDENTATION IS LOAD BEARING.
//
// They used to live inside auditPair(). That made them private to this node, and the letter eval
// could not reach them: _stage2.bakedFunction() cuts a function by finding "\\nfunction NAME(" and
// a declaration nested in a closure has no such line. So the eval re-implemented the claim scan
// against voice-rules.js directly, and on 2026-09-16 the two genuinely diverged. Node 34 learned
// that a DENIAL is not a claim; the eval did not, and letter eval execution 5428 failed C2 on the
// honest gap sentence the writer prompt ORDERS the model to write.
//
// A false red is the polite half of that bug. The same gap produces a false GREEN just as easily:
// the eval's whole job is to answer "would the lane accept this letter", and it cannot answer that
// while it holds its own copy of the rule. So the rule moved out here where it can be LIFTED, and
// the eval now runs these bytes rather than a second implementation of them.
//
// negatedAround() takes its negation list as an ARGUMENT rather than closing over AUDIT_CFG, for
// the same reason: a lifted function that reaches for a free name only works where that name
// happens to exist, which is the kind of coupling that is invisible until it breaks at run time.
// ---------------------------------------------------------------------------
function sentenceBounds(text, index) {
  // The sentence a character index sits in. The newline is declared locally rather than read off
  // the node scope NL, because these bytes are lifted into a node that has no such const.
  const NLC = String.fromCharCode(10);
  const before = text.lastIndexOf('.', index);
  const b2 = text.lastIndexOf(NLC, index);
  const start = Math.max(before, b2, -1) + 1;
  let end = text.length;
  for (const ch of ['.', '!', '?', NLC]) {
    const e = text.indexOf(ch, index);
    if (e !== -1 && e < end) end = e;
  }
  return { start: start, end: end + 1 };
}

// ---------------------------------------------------------------------------
// IS THIS HIT INSIDE A NEGATING CONSTRUCTION. ONE implementation, three callers now, one parameter
// of difference, because it is one concept and a second copy of it would drift the way the tells
// list drifted between the live eval and the rubric.
//
//   A12, beforeOnly false. D17 REQUIRES the sentence "the posting asks for X, which I do not
//     hold", and that puts the negator AFTER the thing it denies. A12 has always read the whole
//     sentence and it still does.
//   the deniable claims, beforeOnly true. "TypeScript is no problem for me, I have used it"
//     would pass a whole sentence read, and it is a CLAIM. The negator has to govern the hit,
//     which in English means it comes first.
//   the letter eval's claim loop, beforeOnly true, running THESE BYTES rather than its own.
//
// THE REFINEMENT: a negator immediately followed by just, only or merely is NOT a denial. "I have
// not just TypeScript but also Python" is a claim wearing a negation, and it is the one shape
// where the positional rule alone gets the answer backwards.
//
// STATED LIMITATION, the same one A12 has carried since it was written, now shared by every
// caller: a hit inside a sentence that negates something ELSE will pass. That is the safe
// direction to be wrong in. The alternative rewrites every honest letter this lane exists to
// produce, and on the claim side the mention is REPORTED either way, so a reader can still see
// that the letter named a banned technology at all.
// ---------------------------------------------------------------------------
function negatedAround(text, at, beforeOnly, negationWords) {
  // ONE implementation, two behaviours, one parameter of difference. See the note above.
  const b = sentenceBounds(text, at);
  const region = (beforeOnly ? text.slice(b.start, at) : text.slice(b.start, b.end)).replace(/['\\u2019]/g, '');
  for (const w of (negationWords || [])) {
    const re = new RegExp('\\\\b' + w + '\\\\b(\\\\s+(?:just|only|merely)\\\\b)?', 'gi');
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(region)) !== null) {
      if (!m[1]) return true;
      if (m[0].length === 0) re.lastIndex += 1;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// WHICH TEXT ON A PAIR MAY LICENSE A FIGURE IN THE LETTER, AND WHAT THE VERDICT CALLS IT.
//
// Hoisted to column zero on 2026-09-16 for the same reason sentenceBounds and negatedAround were,
// and after the same class of bug. A8 here allowed a figure out of four places; the letter eval's
// numbers check allowed it out of two, because it held its own list. A figure the lane accepts made
// the eval red, and the identical gap makes the eval GREEN on a letter the lane would hold the
// moment the two lists differ the other way.
//
// So the source list is DATA now, declared once, and the eval runs these bytes rather than a second
// list that agrees with them today. Adding a source is a one line edit here and it reaches the eval
// automatically; the eval's own build guard then refuses if its seeds do not FEED the new source,
// which is the half that stops a silently narrower allowlist on the harness side.
//
// The label travels with the text on purpose. The ad is the biggest and least curated source, so a
// reader asking "why did a number I have never seen pass" needs the answer inside the verdict
// rather than by re-reading the posting.
// ---------------------------------------------------------------------------
function numberSources(pair) {
  // THE SINGLE DEFINITION of which text a figure may come from. Order matters: the allowlist keeps
  // the FIRST label it sees for a token, and the approved list is applied before any of these.
  //
  // Every field is spelled out as pair.x / brief.x / research.x on purpose, never through a local
  // alias. The letter eval's seed guard READS THIS SOURCE for those paths and refuses to build when
  // its own cases leave one of them empty, and an alias would hide a source from that reader.
  const brief = (pair && pair.brief) || {};
  const research = (pair && pair.research) || {};
  const out = [];
  if (brief.quote_verified === true && brief.quote_line) {
    out.push({ field: 'brief.quote_line', label: 'the employer own words', text: String(brief.quote_line) });
  }
  if (research.hook && research.hook.quote) {
    out.push({ field: 'research.hook.quote', label: 'the employer own words', text: String(research.hook.quote) });
  }
  if (pair && pair.site_text) {
    out.push({ field: 'pair.site_text', label: 'the employer own words', text: String(pair.site_text) });
  }
  // THE JOB AD IS EMPLOYER OWN WORDS TOO, and leaving it out was a real miss rather than a design
  // choice. Letter eval 5427 failed A8 on five figures and every one of them was a number the
  // EMPLOYER put in their own posting. The letter argued against the ad using the ad's numbers,
  // which is what a good letter does, and the check called them invented.
  if (pair && pair.ad_text) {
    out.push({ field: 'pair.ad_text', label: 'the job ad', text: String(pair.ad_text) });
  }
  return out;
}

function numberAllowlist(approved, sources) {
  // One token to one PROVENANCE LABEL. The approved list goes in first so a figure that IS on his
  // own list keeps the stronger label even when the posting happens to carry the same number.
  const allow = {};
  for (let i = 0; i < (approved || []).length; i += 1) allow[String(approved[i])] = 'the approved list';
  for (let i = 0; i < (sources || []).length; i += 1) {
    const ns = extractNumbers(sources[i].text);
    for (let k = 0; k < ns.length; k += 1) if (!allow[ns[k]]) allow[ns[k]] = sources[i].label;
  }
  return allow;
}

// ---------------------------------------------------------------------------
// THE SCAN. Lifted VERBATIM into Audit Pair Final by _stage2.bakedFunction, together with the
// AUDIT_CFG line above it, so the first pass and the final pass cannot disagree about what a pass
// is. Free names it relies on, all baked identically into both nodes from the same sources:
// TELLS, PRONOUN_RE, DASH_RE, CLAIMS, BAND, normalise, wordCount, extractNumbers, AUDIT_CFG,
// and the four helpers hoisted above, sentenceBounds, negatedAround, numberSources and
// numberAllowlist, which node 38 lifts by name alongside this one.
// ---------------------------------------------------------------------------
function auditPair(pair, phase) {
  const CFG = AUDIT_CFG;
  const cv = String(pair.cv_text === undefined || pair.cv_text === null ? '' : pair.cv_text);
  const letter = String(pair.letter_text === undefined || pair.letter_text === null ? '' : pair.letter_text);
  const key = String(pair.master_key || '');
  const brief = pair.brief || {};
  const research = pair.research || {};
  const sel = pair.cv_selection || {};
  const screen = pair.screen_note || {};
  const ident = (CFG.identity || {})[key] || {};

  const checks = [];
  function add(id, scope, status, why, hits) {
    checks.push({ id: id, scope: scope, status: status, why: why, hits: (hits || []).slice(0, 12) });
  }
  function verdict(id, scope, ok, whyOk, whyBad, hits) {
    add(id, scope, ok ? 'PASS' : 'FAIL', ok ? whyOk : whyBad, hits);
  }

  // --- small helpers. Self contained on purpose: none of them touches a dash. ---
  function flat(s) {
    return String(s === undefined || s === null ? '' : s).replace(/\\s+/g, ' ').trim().toLowerCase();
  }
  function spanIsIn(needle, hay) {
    const n = flat(needle).replace(/[.,;:!?]+$/, '');
    if (!n.length) return false;
    return flat(hay).indexOf(n) !== -1;
  }
  function paragraphsOf(text) {
    return String(text).split(/\\n\\s*\\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  }
  function linesOf(text) {
    return String(text).split(NL).map((l) => l.trim()).filter((l) => l.length > 0);
  }
  function sentenceAround(text, index) {
    const b = sentenceBounds(text, index);
    return text.slice(b.start, b.end);
  }
  function hitsOf(text, re) {
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push({ what: m[0], at: m.index });
      if (m[0].length === 0) re.lastIndex += 1;
      if (out.length >= 20) break;
    }
    return out;
  }
  function quoteAround(text, at, len) {
    const from = Math.max(0, at - 40);
    const to = Math.min(text.length, at + len + 40);
    return text.slice(from, to).replace(/\\s+/g, ' ').trim();
  }

  const cvN = normalise(cv);
  const letterN = normalise(letter);

  // --- A1. Zero U+2013 and zero U+2014, both texts. ---
  const dashCv = hitsOf(cv, DASH_RE);
  const dashLetter = hitsOf(letter, DASH_RE);
  verdict('A1.cv', 'cv', dashCv.length === 0, 'no en dash and no em dash in the CV',
    dashCv.length + ' dash character(s) in the CV. Every one of them came out of the frozen master, which is dash free at source, so this is an assembler or a master problem and never a writing one.',
    dashCv.map((h) => ({ what: h.what, quote: quoteAround(cv, h.at, 1) })));
  verdict('A1.letter', 'letter', dashLetter.length === 0, 'no en dash and no em dash in the letter',
    dashLetter.length + ' dash character(s) in the letter. Shaheen, 2026-08-20: NEVER AGAIN, both characters. Nothing repaired it on the way in, deliberately, so this is what the model actually wrote.',
    dashLetter.map((h) => ({ what: h.what, quote: quoteAround(letter, h.at, 1) })));

  // --- A2. AI tells, letter only. The CV is his own frozen text. ---
  const tellHits = [];
  const low = letterN.toLowerCase();
  for (const t of TELLS) {
    let from = 0;
    for (;;) {
      const i = low.indexOf(t, from);
      if (i < 0) break;
      tellHits.push({ what: t, at: i, quote: quoteAround(letterN, i, t.length) });
      from = i + t.length;
    }
  }
  const tellKept = tellHits.filter((h) => !tellHits.some((o) => o !== h && o.at <= h.at && (o.at + o.what.length) >= (h.at + h.what.length) && o.what.length > h.what.length));
  verdict('A2', 'letter', tellKept.length === 0, 'none of the ' + TELLS.length + ' reconciled AI tells',
    tellKept.length + ' AI tell(s): ' + tellKept.map((h) => JSON.stringify(h.what)).join(', '), tellKept);

  // --- A3. Word band. The same count the CLI and the live eval use. ---
  const words = wordCount(letter);
  verdict('A3', 'letter', words >= BAND.min && words <= BAND.max, words + ' words, inside [' + BAND.min + ', ' + BAND.max + ']',
    words + ' words against the band [' + BAND.min + ', ' + BAND.max + ']', []);

  // --- A4. The skeleton. One leg per element the approved shape names. ---
  const paras = paragraphsOf(letter);
  const lines = linesOf(letter);
  const legs = [];
  function leg(id, status, why) { legs.push({ leg: id, status: status, why: why }); }

  leg('greeting', lines.length && lines[0] === CFG.greeting ? 'PASS' : 'FAIL',
    'the first line is ' + JSON.stringify(lines.length ? lines[0] : '') + ' and the approved shape opens with exactly ' + JSON.stringify(CFG.greeting));

  const roleTitle = String(brief.role_title || '').trim();
  leg('role_line', !roleTitle ? 'N/A' : (flat(letter).indexOf(flat(roleTitle)) !== -1 ? 'PASS' : 'FAIL'),
    !roleTitle ? 'the brief carries no role title, so there is nothing to assert the role line against' : 'the role applied for is ' + JSON.stringify(roleTitle));

  const waTokens = Array.isArray(ident.work_auth_tokens) ? ident.work_auth_tokens : [];
  const waHit = waTokens.filter((t) => flat(letter).indexOf(flat(t)) !== -1);
  leg('location_gate', !waTokens.length ? 'N/A' : (waHit.length ? 'PASS' : 'FAIL'),
    !waTokens.length ? 'no token could be derived from the work authorization line' : 'the opener answers the work authorization question using the same word the CV uses (' + JSON.stringify(waTokens) + ')');

  leg('city', !ident.city ? 'N/A' : (flat(letter).indexOf(flat(ident.city)) !== -1 ? 'PASS' : 'FAIL'),
    !ident.city ? 'no city could be derived from the master header' : 'the opener names where he is');

  leg('employer', !(ident.employer && ident.employer.org) ? 'N/A' : (flat(letter).indexOf(flat(ident.employer.org)) !== -1 ? 'PASS' : 'FAIL'),
    !(ident.employer && ident.employer.org) ? 'no current employer could be derived from the experience headings' : 'beat two names the current employer');

  leg('availability', /availab/i.test(letter) ? 'PASS' : 'FAIL', 'the letter states availability, in the wording the CV uses');

  const signoffRe = new RegExp(CFG.signoff.source, CFG.signoff.flags);
  leg('no_signoff', signoffRe.test(letter) ? 'FAIL' : 'PASS', 'the approved shape closes on the name alone, with no sign off phrase above it');

  const lastLine = lines.length ? lines[lines.length - 1] : '';
  leg('signature', !ident.name ? 'N/A' : (lastLine === ident.name ? 'PASS' : 'FAIL'),
    !ident.name ? 'no name could be derived from the master' : 'the last line is ' + JSON.stringify(lastLine) + ' and the approved shape ends with the name alone');

  leg('paragraphs', paras.length >= CFG.paragraphs.min && paras.length <= CFG.paragraphs.max ? 'PASS' : 'FAIL',
    paras.length + ' paragraph(s) against the band [' + CFG.paragraphs.min + ', ' + CFG.paragraphs.max + '] the skeleton implies');

  const screenLines = Array.isArray(screen.lines) ? screen.lines : [];
  const gapLine = screenLines.filter((l) => l && l.kind === 'gap')[0] || null;
  leg('honest_gap', !gapLine ? 'FAIL' : (spanIsIn(gapLine.sentence, letter) ? 'PASS' : 'FAIL'),
    !gapLine
      ? 'the screening note names no gap sentence, so there is no evidence the honest gap was written at all'
      : 'the screening note names the gap sentence and it is a real substring of the letter');

  const legFails = legs.filter((l) => l.status === 'FAIL');
  verdict('A4', 'letter', legFails.length === 0, 'every element of the approved skeleton is present (' + legs.filter((l) => l.status === 'PASS').length + ' checked, ' + legs.filter((l) => l.status === 'N/A').length + ' not assertable)',
    legFails.length + ' skeleton element(s) missing or wrong: ' + legFails.map((l) => l.leg).join(', '), legs);

  // --- A5. Gendered pronouns, both texts. ---
  const proCv = hitsOf(cvN, PRONOUN_RE);
  const proLetter = hitsOf(letterN, PRONOUN_RE);
  verdict('A5.cv', 'cv', proCv.length === 0, 'no gendered pronoun in the CV',
    proCv.length + ' gendered pronoun(s) in the CV: ' + proCv.map((h) => h.what).join(', '), proCv.map((h) => ({ what: h.what, quote: quoteAround(cvN, h.at, h.what.length) })));
  verdict('A5.letter', 'letter', proLetter.length === 0, 'no gendered pronoun in the letter',
    proLetter.length + ' gendered pronoun(s) in the letter: ' + proLetter.map((h) => h.what).join(', '), proLetter.map((h) => ({ what: h.what, quote: quoteAround(letterN, h.at, h.what.length) })));

  // --- A6, A7, A9, A10. The banned claims, one named check each, on the scope the config gives. ---
  const CLAIM_CHECK = { typescript: 'A6', javascript: 'A6', bureau: 'A7', 'job-pipeline': 'A9', 'roles-processed': 'A9', 'voice-project': 'A9', 'vector-rag': 'A10' };
  const deniedMentions = [];
  for (const c of CLAIMS) {
    const scope = CFG.claim_scope[c.id] || 'letter';
    const label = (CLAIM_CHECK[c.id] || 'A9') + '.' + c.id;
    if (scope === 'both' || scope === 'cv') {
      // NEVER the denial carve out on the CV scope, whatever claim_denial says. The CV is verbatim
      // master by construction and a CV does not deny skills: a denial appearing there is the
      // ASSEMBLER emitting something that is not his frozen text, which is exactly the class this
      // audit holds the pair for. Letter scope only, deliberately, and this branch is where that
      // sentence is enforced rather than merely written down.
      const h = hitsOf(cvN, c.re);
      verdict(label + '.cv', 'cv', h.length === 0, 'clean', h.length + ' hit(s) in the CV: ' + h.map((x) => JSON.stringify(x.what)).join(', '), h.map((x) => ({ what: x.what, quote: quoteAround(cvN, x.at, x.what.length) })));
    }
    if (scope === 'both' || scope === 'letter') {
      const deniable = CFG.claim_denial[c.id] === true;
      const all = hitsOf(letterN, c.re);
      const bad = [];
      const denied = [];
      for (const x of all) {
        if (deniable && negatedAround(letterN, x.at, true, CFG.negation_words)) denied.push(x); else bad.push(x);
      }
      const shape = (x) => ({ what: x.what, quote: quoteAround(letterN, x.at, x.what.length) });
      for (const x of denied) deniedMentions.push(Object.assign({ claim: c.id, check: label + '.letter' }, shape(x)));
      // THE DENIED HITS RIDE ON THE PASS. They do not fail the verdict and they are not invisible:
      // the why says how many there were and the hits array carries them with their quotes, tagged
      // denied, so the README and anyone reading the audit can see that the letter named a banned
      // technology at all. rewriteFeedback only ever walks failed_letter, so these are inert to the
      // rewrite turn by construction.
      const deniedNote = denied.length
        ? ' (' + denied.length + ' mention(s) allowed as an explicit denial, which the writer prompt ORDERS when it asks for an honest gap: ' +
          denied.map((x) => JSON.stringify(quoteAround(letterN, x.at, x.what.length).slice(0, 110))).join(' | ') + ')'
        : '';
      verdict(label + '.letter', 'letter', bad.length === 0,
        'clean' + deniedNote,
        bad.length + ' hit(s) in the letter: ' + bad.map((x) => JSON.stringify(x.what)).join(', ') +
          (deniable ? '. Not one of them sits behind a negation, so each reads as a CLAIM rather than as the honest gap the writer prompt asks for.' : '. This claim is never deniable: the rule forbids MENTIONING the thing, and a denial still mentions it.'),
        bad.map(shape).concat(denied.map((x) => Object.assign({ denied: true }, shape(x)))));
    }
  }

  // --- A8. Every figure in the letter is approved, or sits inside employer text this pair actually
  // holds. The employer own words are included deliberately: the skeleton REQUIRES beat three to
  // quote them, and failing a letter for a number inside a sentence it was told to reproduce would
  // be a check arguing with the brief. WHICH text counts is numberSources(), hoisted to column zero
  // so the letter eval runs these bytes rather than its own shorter list. ---
  const adText = String(pair.ad_text === undefined || pair.ad_text === null ? '' : pair.ad_text);
  const approved = (CFG.approved_numbers || {})[key] || [];
  // numberSources() is THE list of sources, hoisted to column zero so the letter eval runs these
  // bytes instead of holding its own. A15 reads the same list below, so the two checks can never
  // disagree about what text this pair actually holds.
  const numSources = numberSources(pair);
  const allow = numberAllowlist(approved, numSources);
  const badNumbers = [];
  const usedFrom = {};
  for (const n of extractNumbers(letter)) {
    if (!allow[n]) badNumbers.push(n); else usedFrom[allow[n]] = (usedFrom[allow[n]] || 0) + 1;
  }
  const provenance = Object.keys(usedFrom).map((src) => usedFrom[src] + ' from ' + src);
  verdict('A8', 'letter', badNumbers.length === 0,
    'every figure in the letter is traceable (' + (provenance.length ? provenance.join(', ') : 'the letter carries no figure at all') + '). Allowlist: ' +
      approved.length + ' approved, ' + Object.keys(allow).length + ' allowed in total across the approved list and ' +
      (numSources.length ? numSources.length + ' source(s) of employer text on this pair (' + numSources.map((s) => s.field).join(', ') + ')' : 'NO employer text at all on this pair, so every allowed figure came off the approved list'),
    badNumbers.length + ' figure(s) in the letter appear on neither his approved list nor in any employer text this pair holds (' + (numSources.length ? numSources.map((s) => s.field).join(', ') : 'no employer text at all') + '): ' + Array.from(new Set(badNumbers)).join(', ') + '. Every number on an application is a claim, and one that is not in his own documents is one he never made.',
    Array.from(new Set(badNumbers)).map((n) => ({ what: n })));

  // --- A11. The work authorization line, exactly. ---
  const waLine = ident.work_auth || null;
  const waPresent = waLine ? cv.indexOf(waLine) !== -1 : false;
  const waOther = /Work authorization:[^\\n]*/g;
  const waFound = hitsOf(cv, waOther).map((h) => h.what.trim());
  const waWrong = waLine ? waFound.filter((f) => f !== waLine) : [];
  verdict('A11', 'cv', !!waLine && waPresent && waWrong.length === 0,
    'the CV carries the work authorization line exactly as the master states it',
    !waLine ? 'no expected work authorization line could be derived from the master'
      : (!waPresent ? 'the assembled CV does not carry the work authorization line. It is a forced block, so a CV without it is an assembler fault.'
        : 'the CV carries a DIFFERENT work authorization line: ' + JSON.stringify(waWrong)),
    waWrong.map((w) => ({ what: w })));

  // --- A12. No claim of a right to work he does not hold. Negation aware. ---
  const rtwHits = [];
  for (const p of CFG.rtw_patterns) {
    const re = new RegExp(p.source, p.flags);
    for (const h of hitsOf(letterN, re)) {
      // beforeOnly FALSE, and it has to stay false: D17's required sentence puts the negator after
      // the requirement it is denying. Same helper as the claim branch, one argument apart.
      if (!negatedAround(letterN, h.at, false, CFG.negation_words)) {
        rtwHits.push({ what: h.what, pattern: p.id, quote: sentenceAround(letterN, h.at).replace(/\\s+/g, ' ').trim().slice(0, 200) });
      }
    }
  }
  verdict('A12', 'letter', rtwHits.length === 0,
    'the letter claims no right to work it does not hold (a sentence that NAMES the requirement and denies holding it is correct and passes, which is what D17 asks for)',
    rtwHits.length + ' sentence(s) read as a claim of a right to work he does not hold: ' + rtwHits.map((h) => JSON.stringify(h.quote)).join(' | '),
    rtwHits);

  // --- A13. The one page ceiling, from what the assembler measured. ---
  const paraChars = Number(sel.para_chars);
  verdict('A13', 'cv', isFinite(paraChars) && paraChars <= CFG.para_chars_max,
    paraChars + ' characters of paragraph text against the ' + CFG.para_chars_max + ' ceiling',
    !isFinite(paraChars) ? 'the pair carries no cv_selection.para_chars, so the one page ceiling cannot be asserted at all' : paraChars + ' characters against a ceiling of ' + CFG.para_chars_max + '. D13 is a hard refuse.',
    []);

  // --- A14. The evidence the assembler left behind. Seat 4 already validated every id and forced
  // the mandatory set, so this asserts the PROOF is present rather than redoing the work. A miss
  // here means the assembler is wrong, which is why it can never route to a rewrite. ---
  const emitted = Array.isArray(sel.emitted_ids) ? sel.emitted_ids : null;
  const a14ok = !!cv && !!emitted && emitted.length > 0 && !!sel.master_sha256;
  verdict('A14', 'cv', a14ok,
    emitted ? emitted.length + ' block id(s) resolved and emitted, master ' + String(sel.master_sha256).slice(0, 12) : 'ok',
    'the pair carries no assembled evidence: cv_text ' + (cv ? 'present' : 'MISSING') + ', emitted_ids ' + (emitted ? emitted.length : 'MISSING') + ', master hash ' + (sel.master_sha256 ? 'present' : 'MISSING') + '. Assemble CV validates every id and forces the mandatory set, so a pair arriving here without that record did not come through it.',
    []);

  // --- A15. Quotes. The plan's direction, and the one that can hurt. adText and numSources are
  // declared up at A8, because A8 reads the posting as a number source and A8 runs first. One
  // declaration, both readers, so the two checks can never disagree about what text this pair
  // actually holds. numSources IS quote_line plus the hook plus site_text plus the ad, which is
  // exactly the set a quoted span used to be proved against here by hand. ---
  const q = brief.quote_line ? String(brief.quote_line) : '';
  const quoteReproved = !q ? null : (adText ? spanIsIn(q, adText) : null);
  const quotedSpans = [];
  // Built from char codes rather than written as escapes: the curly quotation marks are the ones a
  // model actually emits, and an escape sequence inside a template literal inside a generated node
  // is three layers of quoting in which exactly this kind of pattern goes wrong silently.
  const DQ = String.fromCharCode(34);
  const LQ = String.fromCharCode(8220);
  const RQ = String.fromCharCode(8221);
  const spanRe = new RegExp('[' + DQ + LQ + ']([^' + DQ + LQ + RQ + ']{2,400})[' + DQ + RQ + ']', 'g');
  spanRe.lastIndex = 0;
  let sm;
  while ((sm = spanRe.exec(letter)) !== null) {
    const span = sm[1].trim();
    if (span.length < CFG.quoted_span_min) continue;
    const ok = numSources.some((s) => spanIsIn(span, s.text));
    quotedSpans.push({ what: span.slice(0, 160), proved: !!ok });
    if (quotedSpans.length >= 8) break;
  }
  const unproved = quotedSpans.filter((s) => !s.proved);
  const a15ok = (quoteReproved !== false) && unproved.length === 0;
  verdict('A15', 'letter', a15ok,
    (q ? (quoteReproved === null ? 'the brief quote line was verified upstream and the ad text is not on the pair to re-prove it here; ' : 'the brief quote line is still a real substring of the posting; ') : 'the brief carries no quote line; ') +
      quotedSpans.length + ' quoted span(s) in the letter, all proved against text this run actually fetched',
    quoteReproved === false
      ? 'the brief quote line is NOT a substring of the posting text on this pair, so the one sentence the letter is allowed to quote back cannot be proved'
      : unproved.length + ' quoted span(s) in the letter are not in the posting and not on the employer page this run fetched: ' + unproved.map((s) => JSON.stringify(s.what)).join(' | ') + '. A sentence quoted back to a company that the company never wrote is the worst failure this lane can produce.',
    quotedSpans);

  // --- A16. The voice block, fail closed. ---
  verdict('A16', 'letter', pair.voice_block_present === true,
    'the writer node carried the soul voice block when this letter was written',
    'voice_block_present is ' + JSON.stringify(pair.voice_block_present) + '. A letter written without his voice block reads as generic English under his name and every other count on this run stays green, which is why this check is fail closed rather than a warning.',
    []);

  // --- A17. The filenames this pair will ship under. ---
  const fnOk = pair._filenames && pair._filenames.cv === CFG.filenames.cv && pair._filenames.letter === CFG.filenames.letter;
  verdict('A17', 'both', !!fnOk,
    'the pair carries exactly the two filenames the law allows: ' + CFG.filenames.cv + ' and ' + CFG.filenames.letter,
    'the pair carries ' + JSON.stringify(pair._filenames || null) + ' and the law allows only ' + JSON.stringify(CFG.filenames) + '. Shaheen, 2026-08-20: only his name and CV or Cover Letter, because the filename travels WITH the attachment and a per company name tells a recruiter, on a forward, exactly who else he applied to.',
    []);

  // --- A18. The screening note answers every objection, verbatim. ---
  const objections = Array.isArray(brief.objections) ? brief.objections : [];
  if (!objections.length) {
    add('A18', 'letter', 'N/A', 'the recruiter seat returned no objections, so there is nothing for the screening note to answer. The README says how many there were.', []);
  } else {
    const problems = [];
    for (let n = 1; n <= objections.length; n += 1) {
      const named = screenLines.filter((l) => l && l.kind === 'objection' && Number(l.index) === n);
      if (!named.length) { problems.push({ objection: n, why: 'no line in the screening note names a sentence for it' }); continue; }
      if (named.length > 1) { problems.push({ objection: n, why: 'the screening note names it ' + named.length + ' times' }); continue; }
      if (!spanIsIn(named[0].sentence, letter)) {
        problems.push({ objection: n, why: 'the named sentence is not in the letter, character for character: ' + JSON.stringify(String(named[0].sentence).slice(0, 120)) });
      }
    }
    verdict('A18', 'letter', problems.length === 0,
      'every one of the ' + objections.length + ' objection(s) is answered by a sentence the screening note names and that is really in the letter',
      problems.length + ' objection(s) are not demonstrably answered: ' + problems.map((p) => p.objection + ' (' + p.why + ')').join('; ') + '. A paraphrase proves nothing about whether the objection was answered, which is why the note has to copy.',
      problems);
  }

  const failed = checks.filter((c) => c.status === 'FAIL');
  return {
    phase: phase,
    pass: failed.length === 0,
    checks: checks,
    failed_cv: failed.filter((c) => c.scope === 'cv' || c.scope === 'both').map((c) => c.id),
    failed_letter: failed.filter((c) => c.scope === 'letter').map((c) => c.id),
    skeleton: legs,
    // The banned technologies the letter NAMED and then denied. Not a failure and not a warning
    // about the letter: the writer prompt orders an honest gap and this is what an honest gap looks
    // like. It is here so the mention is countable and readable afterwards, because a check that
    // silently forgives is only one step better than a check that wrongly blocks.
    denied_claims: deniedMentions.slice(0, 12),
    words: words,
    voice_rules_sha: VOICE_RULES_SHA,
    rule: 'a CV failure is NEVER rewritten: the CV is verbatim master by construction, so a failure there means the assembler is wrong or a master changed under a pinned id. A letter only failure gets ONE reasoned rewrite with the failed checks named as a second user turn on the same request object.',
  };
}

// ---------------------------------------------------------------------------
// THE REWRITE TURN. Defect 7: one reasoned rewrite, on the SAME request object, with the failed
// checks named. No silent substitution anywhere in this path.
// ---------------------------------------------------------------------------
function rewriteFeedback(result, pair) {
  const NL2 = String.fromCharCode(10);
  const lines = [];
  lines.push('That draft fails ' + result.failed_letter.length + ' deterministic check(s) and cannot ship. Rewrite the WHOLE');
  lines.push('letter, keep everything that already works, and fix every item below. Return the same two');
  lines.push('blocks in the same format, nothing else.');
  lines.push('');
  for (const id of result.failed_letter) {
    const c = result.checks.filter((x) => x.id === id)[0];
    if (!c) continue;
    lines.push('FAILED ' + id + ': ' + c.why);
    for (const h of (c.hits || []).slice(0, 6)) {
      if (h && h.leg) {
        if (h.status === 'FAIL') lines.push('    missing element: ' + h.leg + '. ' + h.why);
      } else if (h && h.quote) {
        lines.push('    at: ' + JSON.stringify(String(h.quote).slice(0, 160)));
      } else if (h && h.what !== undefined) {
        lines.push('    ' + JSON.stringify(String(h.what).slice(0, 160)));
      } else if (h && h.objection !== undefined) {
        lines.push('    objection ' + h.objection + ': ' + h.why);
      }
    }
    lines.push('');
  }
  lines.push('Nothing was repaired for you. The draft above is exactly what you wrote, including any');
  lines.push('character this list names, because a quietly corrected letter would hide the slip from');
  lines.push('the reader who checks it afterwards.');
  return lines.join(NL2);
}

function buildRewrite(pair, result) {
  const req = pair.write_request;
  if (!req || !Array.isArray(req.messages) || !req.messages.length) return null;
  const draft = LETTER_OPEN + String.fromCharCode(10) + String(pair.letter_text || '') + String.fromCharCode(10) + LETTER_CLOSE +
    (pair.screen_note && pair.screen_note.raw ? String.fromCharCode(10) + SCREEN_OPEN + String.fromCharCode(10) + String(pair.screen_note.raw) : '');
  return {
    model: REWRITE_MODEL,
    max_tokens: REWRITE_MAX_TOKENS,
    system: req.system,
    messages: req.messages.concat([
      { role: 'assistant', content: [{ type: 'text', text: draft }] },
      { role: 'user', content: [{ type: 'text', text: rewriteFeedback(result, pair) }] },
    ]),
  };
}

// --- the run ---------------------------------------------------------------------
const items = $input.all().map((i) => i.json);
if (!items.length) {
  throw new Error('Audit Pair: Parse Letter delivered no items at all. It emits at least its own stage report on every path, so an empty input means that node did not run.');
}

const out = [];
const stats = { audited: 0, passed: 0, to_rewrite: 0, held_cv: 0, held_letter_unfixable: 0, skipped: 0, denied_mentions: 0 };
const failCounts = {};
const skipReasons = {};
const warnings = [];

for (const raw of items) {
  const j = Object.assign({}, raw);

  if (j._kind !== 'pair') {
    j._call_now = false;
    out.push(j);
    continue;
  }
  if (j._status) {
    j._call_now = false;
    stats.skipped += 1;
    skipReasons[j._status] = (skipReasons[j._status] || 0) + 1;
    out.push(j);
    continue;
  }

  // The filenames are decided HERE and carried on the pair, so A17 asserts a real field and the
  // render seat reads the two names off the pair instead of writing a second copy of the law.
  j._filenames = { cv: AUDIT_CFG.filenames.cv, letter: AUDIT_CFG.filenames.letter };

  const result = auditPair(j, 'first');
  j.letter_audit = result;
  stats.audited += 1;
  stats.denied_mentions += (result.denied_claims || []).length;
  for (const id of result.failed_cv.concat(result.failed_letter)) failCounts[id] = (failCounts[id] || 0) + 1;

  if (result.failed_cv.length) {
    // NEVER a rewrite. See header note 1.
    j._status = 'needs_review';
    j._status_class = 'hold';
    j._sheet_action = 'write_status';
    j._status_why = 'the CV failed ' + result.failed_cv.length + ' deterministic check(s): ' + result.failed_cv.join(', ') +
      '. The CV is verbatim master by construction, so this is the ASSEMBLER or a master that changed under a pinned id, never a writing problem, and it is not sent to a model to try again. First reason: ' +
      (result.checks.filter((c) => c.id === result.failed_cv[0])[0] || {}).why;
    j._call_now = false;
    j._rewrite_attempted = false;
    stats.held_cv += 1;
    out.push(j);
    continue;
  }

  if (result.failed_letter.length) {
    const req = buildRewrite(j, result);
    if (!req) {
      j._status = 'needs_review';
      j._status_class = 'hold';
      j._sheet_action = 'write_status';
      j._status_why = 'the letter failed ' + result.failed_letter.length + ' check(s) (' + result.failed_letter.join(', ') + ') and the original request object is not on the pair, so the one reasoned rewrite cannot be built on it. Nothing is rebuilt from memory.';
      j._call_now = false;
      j._rewrite_attempted = false;
      stats.held_letter_unfixable += 1;
      out.push(j);
      continue;
    }
    j.rewrite_request = req;
    j._rewrite = {
      model: REWRITE_MODEL,
      max_tokens: REWRITE_MAX_TOKENS,
      failed: result.failed_letter,
      turns: req.messages.length,
      rule: 'ONE rewrite, on the SAME request object, with the failed checks named as a second user turn. Defect 7: the writer eval history recorded two dash slips in six on a first pass, and unattended that is roughly three held pairs a day. The system block is already cached, so this call is mostly output tokens.',
    };
    j._rewrite_attempted = true;
    j._call_now = true;
    stats.to_rewrite += 1;
    out.push(j);
    continue;
  }

  j._rewrite_attempted = false;
  j._call_now = false;
  stats.passed += 1;
  out.push(j);
}

if (stats.held_cv > 0) {
  warnings.push(stats.held_cv + ' pair(s) were HELD on a CV check and NOT rewritten. A CV failure means the assembler is wrong or a master changed under a pinned id, and asking a model to try again would produce a second CV with the same fault and a green report. Go and look at Assemble CV and at the master, in that order.');
}
if (stats.to_rewrite > 0) {
  warnings.push(stats.to_rewrite + ' letter(s) failed a deterministic check and were sent for their ONE reasoned rewrite. Nothing was repaired silently: a substituted dash would make the letter ship looking clean and hide the slip from the blind grader.');
}

if (stats.denied_mentions > 0) {
  warnings.push(stats.denied_mentions + ' mention(s) of a banned technology were ALLOWED because the letter denied them ("I do not have X"). The three deniable claims are TypeScript, JavaScript and vector RAG, whose rules forbid CLAIMING the capability rather than naming it, and the writer prompt ORDERS an honest gap. Each one is on its pair in letter_audit.denied_claims with its quote, so a reader can disagree with any of them.');
}

const report = {
  _kind: 'stage_report',
  stage: 'audit_pair',
  counts: stats,
  failures_by_check: failCounts,
  skipped_by_status: skipReasons,
  voice_rules_sha: VOICE_RULES_SHA,
  tells_in_list: TELLS.length,
  band: BAND,
  filenames: AUDIT_CFG.filenames,
  checks_run: 'A1 to A18. A CV scope failure goes straight to needs_review and is never rewritten; a letter only failure gets ONE reasoned rewrite with the failed checks named as a second user turn on the same request object.',
  warnings: warnings,
  _call_now: false,
  site_fetch_url: '',
  ad_fetch_url: '',
};
out.push(report);

return out.map((j) => ({ json: j, pairedItem: { item: 0 } }));
`;

function renderJsCode() {
  return [
    '// GENERATED at build time from work/36-job-application-writer/nodes/34-audit-pair.js.',
    '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
    VOICE_RUNTIME,
    NUMBER_RUNTIME,
    'const REWRITE_MODEL = ' + JSON.stringify(REWRITE_MODEL) + ';',
    'const REWRITE_MAX_TOKENS = ' + JSON.stringify(REWRITE_MAX_TOKENS) + ';',
    'const LETTER_OPEN = ' + JSON.stringify('<<<LETTER>>>') + ';',
    'const LETTER_CLOSE = ' + JSON.stringify('<<<END>>>') + ';',
    'const SCREEN_OPEN = ' + JSON.stringify('<<<SCREEN>>>') + ';',
    'const AUDIT_CFG = ' + asciiJson(AUDIT_CFG) + ';',
    LOGIC,
  ].join('\n');
}

assertAgainstUpstream();

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [8320, 100],
  connectFrom: 'Parse Letter',
  notes: 'The deterministic A1 to A18 scan over cv_text and letter_text, with the dash, tell, pronoun and banned claim rules BAKED from scripts/lib/voice-rules.js rather than retyped. A CV scope failure goes straight to needs_review and is never sent to a model, because the CV is verbatim master by construction and a failure there means the assembler is wrong. A letter only failure gets ONE reasoned rewrite: the same request object, the draft as an assistant turn, and the failed checks named as a second user turn. Nothing is repaired silently, because a substituted dash would make the letter ship looking clean and hide the slip from the blind grader.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: renderJsCode(),
  },
};

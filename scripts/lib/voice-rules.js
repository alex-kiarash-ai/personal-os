'use strict';
/*
 * voice-rules.js - the ONE definition of every word-level voice rule this repo enforces.
 *
 * WHY THIS FILE EXISTS, and it is the whole point of it.
 * Three places have to agree about what an AI tell is:
 *   1. scripts/prose-scan.js            the zero-token CLI a session or a script runs on a file
 *   2. work/36-job-application-writer/  the unattended lane's audit node (A1, A2, A5, A6, A7, A9,
 *      nodes/ (seat 5, node 34/38)      A10), which runs on the n8n box and cannot require() this
 *   3. work/36-job-application-writer/  the block library's master pre-flight
 *      nodes/_master.js
 * The n8n box has no access to this repo, so its copy is BAKED IN at build time. A baked copy is a
 * copy, and two copies drift. So the rule tables live here once, `renderRuntimeSource()` emits the
 * literal a build step injects into the node, and `RULES_SHA` lets the baked copy be compared
 * against this file and refused when it has fallen behind. The alternative, retyping the tells list
 * into a Code node, is exactly how the live Writer Voice Eval ended up with seventeen tells while
 * the grader rubric had thirteen, which is the drift this seat was asked to reconcile.
 *
 * NO DASH CHARACTER APPEARS IN THIS FILE, including inside the patterns that hunt for dashes. The
 * standing order forbids writing U+2013 or U+2014 into any file, so the scanner builds its own
 * needles from \u escapes. A guard written with the character it bans is a guard that cannot be
 * committed.
 *
 * Nothing here is personal data: no name, no employer, no number from a CV. The rule tables are
 * generic English. That is deliberate, this file is TRACKED in a PUBLIC repo.
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------------------------
// 1. DASHES
//
// Zero tolerance on both characters, everywhere, including text copied verbatim out of a frozen
// master. This is NOT the rubric's PV1 rule and the divergence is deliberate and load-bearing.
//
// PV1 in work/23-self-review/close-out-grader/rubric.md still carves out en-dashes inside numeric
// and date ranges ("Jan 2019 - Present"). That carve-out is from 2026-07-07 and it was overtaken on
// 2026-08-20, when Shaheen reversed the master-text exception in his own words: "you have use this
// [en-dash] in both versions PDF and Word, you already have this role, NEVER AGAIN use it." Both
// characters were then removed from both CV masters AT SOURCE, so a range in his own text is now
// written with a hyphen and there is nothing left for the carve-out to protect. The rubric's own
// header settles the conflict: "If this rubric and those files disagree, the files win."
//
// The measured state as of 2026-09-14: 0 em-dashes and 0 en-dashes in either master, whole file.
// So zero tolerance costs nothing today and catches the one thing that matters, a model or a
// template quietly reintroducing the character his last correction was about.
// ---------------------------------------------------------------------------------------------
const EN_DASH = String.fromCharCode(0x2013);
const EM_DASH = String.fromCharCode(0x2014);
const DASH_RE = new RegExp('[\u2013\u2014]', 'g');

// ---------------------------------------------------------------------------------------------
// 2. THE RECONCILED TELLS LIST
//
// THREE sources had to be merged, and they disagreed:
//
//   (a) the live Writer Voice Eval (n8n workflow grMqmGzzbTXTEdKr, node "Writer Metrics"), 17
//       entries, read from the box on 2026-09-14. This is what a live lane actually enforces today.
//   (b) the close-out grader rubric PV2, 13 entries. A strict SUBSET of (a): (a) adds "it is
//       important to note", "seamless", "thrilled to" and "look forward to delivering".
//   (c) soul.md Detection-proofing rule 3 (vocabulary tells) and rule 6 (structural tells).
//
// DROPPED: nothing. Every entry in (a) and (b) survives. There was no entry in either that soul.md
// contradicts, so there was nothing to drop, and dropping a live entry would have quietly loosened
// a gate that is passing 6/6 today.
//
// ADDED from soul.md rule 3, which both (a) and (b) had missed:
//   "it is worth noting"   named in rule 3 as a hedge, in neither scanner
//   "it is important to"   rule 3 names the STEM, not just the "...to note" completion, so
//                          "it is important to show that" slipped past both scanners
//
// ADDED from soul.md rule 6, the structural tells, but ONLY the ones that are a fixed string a
// word scanner can actually find. Rule 6 is about SHAPES, and most of them are not machine
// checkable at all (see STRUCTURAL_JUDGEMENT below). These are the ones that are:
//   weasel attribution     "experts agree", "studies show", "industry reports suggest",
//                          "widely regarded as"
//   importance puffery     "marks a pivotal moment", "stands as a testament", "plays a vital role",
//                          "solidifies its position"
//   fake strong verbs      "serves as a", "acts as a bridge"
//   faux insight setups    "what nobody tells you", "the part everyone misses",
//                          "what most people get wrong"
//   metadiscourse          "in other words", "as you can see", "the key point is",
//                          "this distinction matters"
//
// WHY ERRING TOWARD BLOCKING IS RIGHT HERE. #36 is unattended. A false FAIL costs one reasoned
// rewrite and, if that also fails, a pair held for review. A false PASS ships slop to a recruiter
// under Shaheen's name. The two failure modes are not symmetric, so an ambiguous entry is blocked
// rather than waved through.
//
// KNOWN FALSE POSITIVE SOURCES, named so nobody is surprised at 06:45: "realm" fails a letter to a
// company whose product is called Realm; "navigate" fails a letter to a maritime or mapping shop.
// Both are held for review, neither ships wrong, and neither is worth weakening the list over.
//
// DELIBERATELY NOT BLOCKING: "overall" and "ultimately" (rule 6 summary-recap endings) and "look
// forward to" without "delivering". "overall" appears legitimately in his own approved metric
// ("overall BI development time"), and a blocking rule that fires on his own sanctioned wording is
// a rule that gets switched off. They are ADVISORY instead, see STRUCTURAL_HINTS.
//
// MATCHING: case-insensitive substring, after apostrophe normalisation. Substring, not word
// boundary, so "delve" also catches "delving" and "underscore" also catches "underscoring", which
// is what rule 6 asks for.
// ---------------------------------------------------------------------------------------------
const TELLS = [
  // --- from the live Writer Voice Eval, all 17, unchanged ---
  "it's important to note",
  'it is important to note',
  'that said',
  'moreover',
  'furthermore',
  'additionally',
  'in conclusion',
  'delve',
  'navigate',
  'leverage',
  'underscore',
  'arguably',
  'tapestry',
  'realm',
  'seamless',
  'thrilled to',
  'look forward to delivering',
  // --- added from soul.md Detection-proofing rule 3 ---
  'it is worth noting',
  'it is important to',
  // --- added from soul.md Detection-proofing rule 6, fixed-string shapes only ---
  'experts agree',
  'studies show',
  'industry reports suggest',
  'widely regarded as',
  'marks a pivotal moment',
  'stands as a testament',
  'plays a vital role',
  'solidifies its position',
  'serves as a',
  'acts as a bridge',
  'what nobody tells you',
  'the part everyone misses',
  'what most people get wrong',
  'in other words',
  'as you can see',
  'the key point is',
  'this distinction matters',
];

// The four entries the live eval has that the rubric PV2 list does not. Kept as data rather than
// prose so a future reconciliation can diff the two lists mechanically instead of by reading.
const TELLS_RUBRIC_PV2 = [
  "it's important to note", 'that said', 'moreover', 'furthermore', 'additionally',
  'in conclusion', 'delve', 'navigate', 'leverage', 'underscore', 'arguably', 'tapestry', 'realm',
];
const TELLS_LIVE_EVAL = TELLS_RUBRIC_PV2.concat([
  'it is important to note', 'seamless', 'thrilled to', 'look forward to delivering',
]);

// ---------------------------------------------------------------------------------------------
// 3. PRONOUNS
//
// soul.md, Shaheen 2026-07-28, verbatim: "I do not want to give Alex a gender, I want you to not
// use HE/HIM at all. Apply that." The rule forbids he/she AND "it" as a substitute, but "it" is
// unusable as a scan target in running English, so the deterministic half is the gendered set and
// the "it" half stays with the grader's judgement. The scan is exactly the one soul.md specifies.
// ---------------------------------------------------------------------------------------------
const PRONOUN_RE = /\b(he|him|his|himself|she|her|hers|herself)\b/gi;

// ---------------------------------------------------------------------------------------------
// 4. BANNED CLAIMS
//
// Each one is its own check with its own id, so a negative test can prove each independently and a
// FAIL names the specific rule rather than "banned claims". Every one traces to a written order in
// vault/me/cv/ai/writer-notes-ai.md or the root constitution.
//
// The three SEMANTIC ones (job pipelines, roles-processed counts, the voice project) cannot be
// matched by a single word. "voice" alone is unusable: his own master says "captures my writing
// style and voice", which is approved text. So each is a small set of phrases that name the thing
// rather than gesture at it, and each is documented with what it deliberately does NOT catch.
// ---------------------------------------------------------------------------------------------
const CLAIMS = [
  {
    id: 'typescript',
    why: 'writer-notes-ai.md: NEVER claim TypeScript. Pruned from the master 2026-08-19 as an overclaim, on Shaheen\'s own instruction.',
    re: /\btypescript\b/gi,
  },
  {
    id: 'javascript',
    why: 'writer-notes-ai.md: NEVER claim JavaScript. Pruned 2026-07-25 as an overclaim, on Shaheen\'s own instruction.',
    re: /\bjavascript\b/gi,
  },
  {
    id: 'bureau',
    why: 'writer-notes (both lanes), Shaheen 2026-07-14: never the word "bureau" for UC. It is "the leading credit information provider".',
    re: /\bbureaux?\b/gi,
  },
  {
    id: 'vector-rag',
    why: 'writer-notes (AI lane): retrieval is BM25 full-text plus MCP tool-calling, "RAG-style". Never claim vector RAG or embeddings.',
    re: /\b(vector\s+(?:rag|search|store|database|db)|vectors?|embeddings?|embedded\s+vectors?)\b/gi,
  },
  {
    id: 'job-pipeline',
    why: 'writer-notes, standing order 2026-07-14: never mention the job-application pipelines in ANY generated output.',
    // Names the thing. Does NOT catch a bare "pipeline", which is legitimate everywhere in his data work.
    re: /\b(job[- ]application\s+(?:pipeline|engine|workflow|lane)s?|application\s+engine|job\s+application\s+(?:automation|bot)|auto[- ]?appl(?:y|ies|ying|ication\s+bot)|applies\s+to\s+jobs\b)/gi,
  },
  {
    id: 'roles-processed',
    why: 'writer-notes, standing order 2026-07-14: never mention roles-processed counts. A count of roles or applications handled is the tell.',
    // Two shapes: a number in front of roles/jobs/applications, and the processed verb behind them.
    re: /(\b\d[\d.,]*\+?\s+(?:roles?|jobs?|applications?|postings?|vacancies)\b|\b(?:roles?|jobs?|applications?|postings?|vacancies)\s+(?:processed|screened|scored|handled|submitted|applied\s+to)\b)/gi,
  },
  {
    id: 'voice-project',
    why: 'writer-notes, standing order 2026-07-14: never mention the voice project. Named specifically, because "voice" alone is approved master text ("captures my writing style and voice").',
    re: /\b(voice\s+(?:mode|loop|lane|pipeline|assistant|project|automation|dictation)|text[- ]to[- ]speech|speech[- ]to[- ]text|dictation\s+lane|whisper\s+(?:model|transcription|lane)|\bTTS\b|\bSTT\b)/gi,
  },
];

// ---------------------------------------------------------------------------------------------
// 5. STRUCTURAL: what a word-level scanner CAN hint at, and what it simply cannot see.
//
// soul.md rule 6 is about SHAPES. A scanner over a bag of strings can only reach the shapes that
// happen to have a fixed string in them, and the ones it can reach are already in TELLS above.
// These two tables exist so the next seat knows exactly where the machine stops and the grader's
// judgement has to start, instead of assuming a green scan means the prose passed rule 6.
//
// STRUCTURAL_HINTS are REPORTED and NEVER change the exit code. They are the cases where the shape
// is real but the string is ambiguous enough that blocking would fire on legitimate text.
// ---------------------------------------------------------------------------------------------
const STRUCTURAL_HINTS = [
  {
    id: 'colon-reveal',
    why: 'rule 6 colon reveal: a noun phrase, a colon, then a dramatic lowercase reveal. ADVISORY because his own master uses a legitimate one ("The design rule throughout: two reasoning calls wrapped in deterministic gates"), so this cannot block.',
    re: /(?:^|[.!?]\s)([A-Z][^.!?:\n]{4,60}):\s+[a-z]/g,
  },
  {
    id: 'summary-recap',
    why: 'rule 6 summary-recap endings. ADVISORY because "overall" appears inside his own approved metric ("overall BI development time") and blocking it would fire on sanctioned wording.',
    re: /\b(ultimately|overall|all in all|to sum up)\b/gi,
  },
  {
    id: 'formatting-slop',
    why: 'rule 6 formatting slop: emoji, or markdown emphasis inside prose a recruiter reads as a letter.',
    re: /(\*\*[^*\n]+\*\*|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}])/gu,
  },
];

// Not checkable by any string scan. Listed so the handoff is explicit.
const STRUCTURAL_JUDGEMENT = [
  'synonym cycling: rotating agent / assistant / tool / platform for the same thing across paragraphs. Needs discourse tracking across the whole text, not a string match.',
  'fake-profound kicker: a closing metaphor or mic-drop line. Semantic, and the offending sentence carries no fixed vocabulary.',
  'superficial analysis: trailing -ing clauses that pretend to explain ("reflecting a shift", "showcasing the move"). "showcasing" and "underscoring" are caught by TELLS, "reflecting" and "highlighting" are ordinary words that cannot be blocked.',
  'PV4 rhythm: uniform, evenly measured sentence cadence. Measurable in principle (variance of sentence length) but the threshold is a taste call, so it stays with the grader.',
  'PV5 his words, not generic English: the load-bearing rubric criterion. A text can pass every check in this file and still read as correct-but-generic corporate English, which is precisely the failure PV5 exists to catch.',
  'PV3 corporate softeners beyond the fixed strings above: cheerleading, hedging walls, faked certainty.',
];

// ---------------------------------------------------------------------------------------------
// 6. NORMALISATION, and why it is not cosmetic.
//
// The live eval matches "it's important to note" with an ASCII apostrophe. The frozen master
// carries 4 CURLY apostrophes (U+2019) and Shaheen chose to keep them, so curly apostrophes are in
// circulation in this system and a writer model will happily emit one. "it’s important to
// note" would sail past the live eval today. Normalising the text before matching closes that, and
// the negative test for it writes the tell with a curly apostrophe on purpose.
// ---------------------------------------------------------------------------------------------
function normalise(text) {
  return String(text == null ? '' : text)
    .replace(new RegExp('[\u2018\u2019\u201b]', 'g'), "'")
    .replace(new RegExp('[\u201c\u201d]', 'g'), '"')
    .replace(new RegExp('\u00a0', 'g'), ' ');
}

// The word count is defined EXACTLY as the live Writer Voice Eval defines it, so the CLI and the
// box can never disagree about whether a letter is in band:
//   const words = cover.trim() ? cover.trim().split(/\s+/).length : 0;
function wordCount(text) {
  const t = String(text == null ? '' : text).trim();
  return t ? t.split(/\s+/).length : 0;
}

// ---------------------------------------------------------------------------------------------
// 7. NUMBERS (the source A8 leans on).
//
// A8 asks that every number in the letter appears in the approved-numbers list or in the ad text.
// That only works if both sides tokenise numbers the same way, so the tokeniser lives here with
// the rules, not in whichever node happens to need it first.
//
// Canonical form is the BARE number with separators stripped, and a range is split into its ends:
//   "70-75%"  -> ['70','75']      "7.5+"  -> ['7.5']
//   "20,000"  -> ['20000']        "0.7%"  -> ['0.7']
//   "3-4"     -> ['3','4']        "600+"  -> ['600']
// Comparing bare numbers on purpose: the letter may legitimately write "70%" where the master
// writes "70-75%", and failing that would be a false positive about formatting, not about an
// invented magnitude. What A8 protects against is a number he never said, and a bare-number
// comparison catches exactly that.
// ---------------------------------------------------------------------------------------------
function extractNumbers(text) {
  const out = [];
  const src = normalise(text);
  const re = /\d[\d.,]*/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    // A digit run INSIDE an identifier is not a number he claimed. "n8n" is a product name, "B2B"
    // is a tenant type, "S3" is a bucket. Without this, A8 pulls a bare "8" out of "self hosted
    // n8n", which is a phrase from his own master, and fails a letter that is entirely honest.
    // Found by the negative test, not by reading the code, which is the point of the negative test.
    const prev = m.index > 0 ? src[m.index - 1] : '';
    if (/[A-Za-z]/.test(prev)) continue;
    let tok = m[0];
    // a trailing separator is punctuation, not part of the number ("in 2026," -> "2026")
    tok = tok.replace(/[.,]+$/, '');
    if (!tok) continue;
    // thousands separators out, decimal point kept: 20,000 -> 20000 and 0.7 -> 0.7
    const bare = tok.replace(/,(?=\d{3}\b)/g, '');
    out.push(bare);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// 8. THE SCAN ENGINE. One function, used by the CLI, by _master.js and (baked) by the audit node.
// ---------------------------------------------------------------------------------------------

const PROFILES = {
  // The cover letter: everything, with the band the plan fixes at 100..280 (A3).
  letter: { checks: ['dashes', 'tells', 'words', 'pronouns', 'claims'], min: 100, max: 280 },
  // The CV: verbatim master by construction, so a hit here means the ASSEMBLER is wrong, not the
  // writer. No band: length is governed by the one-page render check (R2) and the char ceiling
  // (A13), neither of which is a word count.
  cv: { checks: ['dashes', 'tells', 'pronouns', 'claims'], min: null, max: null },
  // Anything else. Band only if the caller passes one.
  text: { checks: ['dashes', 'tells', 'pronouns', 'claims'], min: null, max: null },
};

function quote(src, index, len, pad) {
  const p = pad == null ? 40 : pad;
  const from = Math.max(0, index - p);
  const to = Math.min(src.length, index + len + p);
  return (from > 0 ? '...' : '') + src.slice(from, to).replace(/\s+/g, ' ').trim() + (to < src.length ? '...' : '');
}

function scan(text, opts) {
  const o = opts || {};
  const profileName = o.profile && PROFILES[o.profile] ? o.profile : 'text';
  const profile = PROFILES[profileName];
  const raw = String(text == null ? '' : text);
  const norm = normalise(raw);
  const low = norm.toLowerCase();
  const min = o.min != null ? o.min : profile.min;
  const max = o.max != null ? o.max : profile.max;

  const checks = [];
  const add = (id, ok, detail, hits) => checks.push({ id, status: ok ? 'PASS' : 'FAIL', detail, hits: hits || [] });

  // --- dashes (A1 / PV1) ---
  if (profile.checks.includes('dashes')) {
    const hits = [];
    let m;
    DASH_RE.lastIndex = 0;
    while ((m = DASH_RE.exec(raw)) !== null) {
      hits.push({ what: m[0] === EM_DASH ? 'U+2014 em-dash' : 'U+2013 en-dash', at: m.index, quote: quote(raw, m.index, 1) });
    }
    add('dashes', hits.length === 0,
      hits.length ? hits.length + ' dash character(s). Shaheen 2026-08-20: NEVER AGAIN, both characters, master text included.' : 'no U+2013 and no U+2014',
      hits);
  }

  // --- AI tells (A2 / PV2) ---
  if (profile.checks.includes('tells')) {
    const found = [];
    for (const t of TELLS) {
      let from = 0;
      for (;;) {
        const i = low.indexOf(t, from);
        if (i < 0) break;
        found.push({ what: t, at: i, quote: quote(norm, i, t.length) });
        from = i + t.length;
      }
    }
    // A tell that is a substring of another tell matched at the same place is one offence, not two
    // ("it is important to" inside "it is important to note"). Report the longest.
    const kept = found.filter(h => !found.some(o2 => o2 !== h && o2.at <= h.at && (o2.at + o2.what.length) >= (h.at + h.what.length) && o2.what.length > h.what.length));
    kept.sort((a, b) => a.at - b.at);
    add('tells', kept.length === 0,
      kept.length ? kept.length + ' AI tell(s): ' + kept.map(h => JSON.stringify(h.what)).join(', ') : 'none of the ' + TELLS.length + ' reconciled tells',
      kept);
  }

  // --- word band (A3) ---
  if (profile.checks.includes('words') || (min != null || max != null)) {
    const n = wordCount(raw);
    const ok = (min == null || n >= min) && (max == null || n <= max);
    add('words', ok, n + ' words' + (min != null || max != null ? ' against [' + (min == null ? '-' : min) + ', ' + (max == null ? '-' : max) + ']' : ''), []);
  }

  // --- pronouns (A5) ---
  if (profile.checks.includes('pronouns')) {
    const hits = [];
    let m;
    PRONOUN_RE.lastIndex = 0;
    while ((m = PRONOUN_RE.exec(norm)) !== null) {
      hits.push({ what: m[0], at: m.index, quote: quote(norm, m.index, m[0].length) });
    }
    add('pronouns', hits.length === 0,
      hits.length ? hits.length + ' gendered pronoun(s): ' + hits.map(h => h.what).join(', ') + '. Alex is never he, him, his, she or it (Shaheen 2026-07-28).' : 'no gendered pronouns',
      hits);
  }

  // --- banned claims (A6, A7, A9, A10), one named check each ---
  if (profile.checks.includes('claims')) {
    for (const c of CLAIMS) {
      const hits = [];
      let m;
      c.re.lastIndex = 0;
      while ((m = c.re.exec(norm)) !== null) {
        hits.push({ what: m[0], at: m.index, quote: quote(norm, m.index, m[0].length) });
        if (m[0].length === 0) c.re.lastIndex += 1;
      }
      add('claim:' + c.id, hits.length === 0,
        hits.length ? hits.length + ' hit(s): ' + hits.map(h => JSON.stringify(h.what)).join(', ') + '. ' + c.why : 'clean',
        hits);
    }
  }

  // --- numbers (A8 support; only when the caller supplies an allowlist) ---
  if (Array.isArray(o.approvedNumbers)) {
    const allow = new Set(o.approvedNumbers.map(String));
    const hits = [];
    for (const n of extractNumbers(raw)) {
      if (!allow.has(n)) hits.push({ what: n, at: -1, quote: n });
    }
    add('numbers', hits.length === 0,
      hits.length ? hits.length + ' number(s) not in the approved list: ' + hits.map(h => h.what).join(', ') : 'every number is approved',
      hits);
  }

  // --- ADVISORY. Reported, never blocking, never in the verdict. ---
  const advisory = [];
  for (const h of STRUCTURAL_HINTS) {
    const hits = [];
    let m;
    h.re.lastIndex = 0;
    while ((m = h.re.exec(norm)) !== null) {
      hits.push({ what: (m[1] || m[0]).trim(), at: m.index, quote: quote(norm, m.index, (m[0] || '').length) });
      if (m[0].length === 0) h.re.lastIndex += 1;
    }
    advisory.push({ id: h.id, status: hits.length ? 'NOTE' : 'clean', why: h.why, hits });
  }

  const failed = checks.filter(c => c.status === 'FAIL');
  return {
    profile: profileName,
    pass: failed.length === 0,
    failed: failed.map(c => c.id),
    checks,
    advisory,
    words: wordCount(raw),
    judgement_still_required: STRUCTURAL_JUDGEMENT,
  };
}

// ---------------------------------------------------------------------------------------------
// 9. THE BAKED COPY. How the n8n audit node gets these rules without requiring this file.
//
// build.js (seat 5) injects renderRuntimeSource() between markers in the audit node's jsCode. The
// node then carries a literal that was GENERATED from this file rather than retyped from it, and
// RULES_SHA gives the node something to assert against so a stale bake is caught rather than run.
// ---------------------------------------------------------------------------------------------
function canonical() {
  return JSON.stringify({
    tells: TELLS,
    pronouns: PRONOUN_RE.source,
    dashes: DASH_RE.source,
    claims: CLAIMS.map(c => ({ id: c.id, re: c.re.source, flags: c.re.flags })),
    hints: STRUCTURAL_HINTS.map(h => ({ id: h.id, re: h.re.source, flags: h.re.flags })),
    profiles: PROFILES,
  });
}
const RULES_SHA = crypto.createHash('sha256').update(canonical()).digest('hex');

// Everything above plain ASCII is emitted as an escape sequence. TWO reasons and the first is a
// hard rule: DASH_RE.source is the literal two-character class, so embedding it raw would write the
// two banned characters into a generated file and into an n8n node parameter. The negative test
// caught exactly that on the first run of this function. The second reason is that the bake travels
// to the box as JSON over REST, and ASCII survives that with no encoding questions.
const NON_ASCII = new RegExp('[\\u007f-\\uffff]', 'g');
function asciiJson(value) {
  return JSON.stringify(value).replace(NON_ASCII, function (c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  });
}

function renderRuntimeSource() {
  const lines = [];
  lines.push('// GENERATED from scripts/lib/voice-rules.js. Do not edit in the n8n editor.');
  lines.push('// Rebake with the build step; RULES_SHA is asserted against the repo copy.');
  lines.push('const VOICE_RULES_SHA = ' + asciiJson(RULES_SHA) + ';');
  lines.push('const TELLS = ' + asciiJson(TELLS) + ';');
  lines.push('const PRONOUN_RE = new RegExp(' + asciiJson(PRONOUN_RE.source) + ", 'gi');");
  lines.push('const DASH_RE = new RegExp(' + asciiJson(DASH_RE.source) + ", 'g');");
  lines.push('const CLAIMS = ' + asciiJson(CLAIMS.map(c => ({ id: c.id, source: c.re.source, flags: c.re.flags }))) + '.map(function (c) { return { id: c.id, re: new RegExp(c.source, c.flags) }; });');
  lines.push('const BAND = { min: ' + PROFILES.letter.min + ', max: ' + PROFILES.letter.max + ' };');
  return lines.join('\n');
}

module.exports = {
  TELLS, TELLS_RUBRIC_PV2, TELLS_LIVE_EVAL,
  PRONOUN_RE, DASH_RE, EN_DASH, EM_DASH,
  CLAIMS, STRUCTURAL_HINTS, STRUCTURAL_JUDGEMENT,
  PROFILES, RULES_SHA,
  normalise, wordCount, extractNumbers, scan, renderRuntimeSource, canonical,
};

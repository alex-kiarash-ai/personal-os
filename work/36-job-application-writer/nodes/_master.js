'use strict';
/*
 * _master.js - the CV master block library. BUILD TIME ONLY.
 *
 * ============================================================================================
 * WHY THIS FILE EXISTS, and it is the one idea that makes #36 different from the engines it
 * replaces.
 *
 * Shaheen's AI CV master is FROZEN. His words, 2026-08-19: "Do not change anything (not a word or
 * a color or a font) Exact as it is." Tailoring means SELECT, REORDER and keyword-mirror his
 * sentences. Never rewrite them.
 *
 * The retired engines enforced that by asking a model nicely and then checking the output
 * afterwards. That is a filter, and a filter has a false-negative rate. This lane enforces it BY
 * CONSTRUCTION instead:
 *
 *   1. the masters are parsed HERE, at build time, into addressable blocks with content-hash ids
 *   2. the selector model is shown those blocks and emits ONLY a list of ids and an order
 *   3. the assembler emits ONLY strings that came out of the master
 *
 * There is then NO PATH by which a rewritten sentence reaches the CV, because the model never gets
 * to write one. A model that hallucinates a better bullet produces an id that does not resolve, and
 * an id that does not resolve is a refusal, not a paragraph.
 *
 * ============================================================================================
 * THE ID, and what the hash is for.
 *
 *   exp.r2.b04@a1f9c2d0
 *   ^   ^  ^   ^
 *   |   |  |   sha256 of the block's printable text, first 8 hex
 *   |   |  sequence within the group, document order, 1-based, zero padded
 *   |   group: rN for the Nth H3 subsection inside the section, x when there is no H3
 *   section: hdr sum exp proj skl ind cert edu lang
 *
 * The hash is the whole point of the id. If the master is ever amended, every affected id CHANGES,
 * so anything pinning an old id fails LOUDLY instead of silently shipping stale text. A positional
 * id alone would survive an edit to the sentence it names, which is precisely the failure mode
 * worth designing against: a CV that looks right, carries an id that resolves, and quotes a
 * sentence Shaheen corrected three weeks ago.
 *
 * The id components are POSITIONAL on purpose, never a slug of the employer or the job title. Ids
 * travel: into a model prompt, into an n8n node parameter on a rented box, into a sheet cell, into
 * a log line. A positional id leaks nothing about where he has worked. The TEXT is what the
 * selector needs, and the text is sent deliberately and only to the model that has to choose.
 *
 * ============================================================================================
 * GRANULARITY: one block is one bullet, or one paragraph line, or one heading. Nothing smaller.
 *
 * Measured against the real documents rather than assumed:
 *   the AI master's printable half is 96 lines, of which 34 are bullets and 13 are paragraph lines
 *   the Power BI master's printable half is 88 lines, of which 30 are bullets and 15 are lines
 *
 * SMALLER (a clause, a sentence inside a bullet) fails the whole design. Every bullet in both
 * masters is already exactly one sentence of his own text. Splitting a bullet would let a selector
 * recombine two half sentences into a sentence he never wrote, which is rewriting with extra steps,
 * and it is the precise thing this architecture exists to make impossible.
 *
 * LARGER (a whole role, a whole section) makes selection meaningless. The AI master is three pages
 * of raw material and the CV has to render on ONE page (D13, hard refuse; the #14 engine already
 * drops an over-length CV as cv_over_one_page). Selecting at role granularity gives the assembler
 * five levers on a document that needs about twenty. writer-notes-ai.md says it plainly: "the
 * writer must select, never dump."
 *
 * So the bullet is the unit, because the bullet is both the smallest coherent grammatical unit of
 * HIS text and the unit the one-page ceiling is actually paid for in.
 *
 * ============================================================================================
 * WHAT THIS FILE IS NOT. It is not a node. The leading underscore keeps it out of build.js's node
 * glob (/^\d+-.+\.js$/), the same convention as work/34-job-search-bi/nodes/_lane.js. It runs on
 * THIS machine at build time and bakes its output into node parameters. The n8n box cannot read
 * this repo and never calls any of this.
 *
 * ============================================================================================
 * PRIVACY. This file is TRACKED and the repo is PUBLIC. It therefore contains:
 *   NO master text, NO employer name, NO number from a CV, NO block id.
 * Every one of those is DERIVED at run time from vault/me/cv/**, which .gitignore:96 keeps local.
 * That is also why the approved-numbers list is derived from the masters rather than typed out
 * here: a hardcoded user count in a tracked file publishes a CV fact, and it drifts the
 * first time he amends the master. Derivation fixes both at once.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

// nodes/ -> work/36-job-application-writer/ -> work/ -> repo root
const LANE_DIR = path.resolve(__dirname, '..');
const REPO = path.resolve(__dirname, '..', '..', '..');
const VR = require(path.join(REPO, 'scripts', 'lib', 'voice-rules.js'));

// A13: the assembled CV's printable character ceiling. Kept here because the assembler is here;
// seat 4 owns the drop POLICY that gets a selection under it, this only measures and reports.
const PARA_CHAR_CEILING = 3760;

const NOTES_HEADING = '## WRITER-AGENT NOTES (not printed)';

const LANES = {
  ai: {
    key: 'ai',
    label: 'AI Automation lane',
    file: path.join(REPO, 'vault', 'me', 'cv', 'ai', 'master-ai-cv.md'),
    // The mirror is GENERATED from a frozen .docx. Staleness is a real failure mode here and
    // build-cv-master.py --check is the only thing that can see it.
    mirror_of_docx: true,
    notes_file: path.join(REPO, 'vault', 'me', 'cv', 'ai', 'writer-notes-ai.md'),
  },
  powerbi: {
    key: 'powerbi',
    label: 'Power BI / Data lane',
    file: path.join(REPO, 'vault', 'me', 'cv', 'powerbi', 'master-powerbi-cv.md'),
    // MD first, no docx behind it, and NOT frozen. So there is no staleness check to run; the
    // fixture pins its sha256 instead, which catches an unannounced edit just as loudly.
    mirror_of_docx: false,
    notes_file: null,
  },
};

// ---------------------------------------------------------------------------------------------
// SECTION SLUGS.
//
// Derived from the H2 heading text through a semantic map, so the two lanes agree about what a
// section IS even though they name them differently ("PROFESSIONAL SUMMARY" on one, "PROFILE" on
// the other). A heading the map does not know still parses, with a deterministic fallback slug,
// because refusing to build on a new section would block a legitimate amendment. The fixture is
// what raises the alarm on a new section, and that is the right place for it: parsing stays
// permissive, the pin stays strict.
// ---------------------------------------------------------------------------------------------
const SECTION_MAP = [
  [/^header$/i, 'hdr'],
  [/^(professional summary|summary|profile)$/i, 'sum'],
  [/^(professional experience|experience|work experience)$/i, 'exp'],
  [/(projects)$/i, 'proj'],
  [/^(skills|skills & tools|skills and tools)$/i, 'skl'],
  [/^industry experience$/i, 'ind'],
  [/^certifications?$/i, 'cert'],
  [/^education$/i, 'edu'],
  [/^languages?$/i, 'lang'],
];

function sectionSlug(title) {
  for (const [re, slug] of SECTION_MAP) if (re.test(title.trim())) return slug;
  const fallback = title.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 4);
  return fallback || 'sec';
}

// ---------------------------------------------------------------------------------------------
// CONTACT PATTERNS. Used for two different jobs, and they must be the same patterns for both:
//   1. classifying a block as contact-carrying, so the model view can redact it
//   2. ASSERTING the redaction worked, by counting hits in the redacted view
// Asserting with the same patterns that did the redaction is deliberate. It does not prove the
// patterns are complete, and nothing can; it proves the redaction actually ran, which is the bug
// that would otherwise ship silently. Completeness is covered separately by the print-view count
// being greater than zero: if the patterns matched nothing anywhere, the assertion is vacuous and
// the build refuses.
// ---------------------------------------------------------------------------------------------
const CONTACT_PATTERNS = [
  { id: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { id: 'phone', re: /\+\d[\d\s().-]{6,}\d/g },
  { id: 'linkedin', re: /linkedin\.com\/in\/[A-Za-z0-9-]+/gi },
  // The street pattern is TIGHT on purpose, and the first cut of it was not. It read
  //   \d{1,4}\s+[A-Za-z]+(?:...|st|rd|ave)\b
  // which matched "7 specialist" inside his own summary, because "specialist" ends in "st". That
  // marked the professional summary as a contact block, which would have forced it onto every CV
  // and redacted it from the selector. Found by inspecting the classification, not by reading the
  // regex. A suffix is not an address: the English form needs the street word as its OWN token, and
  // the Swedish form is a compound followed by a number.
  { id: 'street', re: /(?:\b\d{1,4}[A-Za-z]?\s+[A-Z][A-Za-z.'-]+\s+(?:Street|Road|Avenue|Lane|Drive|Boulevard|Blvd)\b|\b[A-ZÅÄÖ][a-zåäö]+(?:gatan|gata|vägen|vagen|torget)\s+\d{1,4}\b)/g },
];

const REDACTED = '[contact details withheld from the selector. This block is MANDATORY and is emitted verbatim from the master at print time.]';

function countContact(text) {
  let n = 0;
  const by = {};
  for (const p of CONTACT_PATTERNS) {
    p.re.lastIndex = 0;
    const hits = String(text).match(p.re) || [];
    by[p.id] = hits.length;
    n += hits.length;
  }
  return { total: n, by };
}

function sha256(s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex'); }

function readMaster(laneKey) {
  const lane = LANES[laneKey];
  if (!lane) throw new Error('#36 _master.js: unknown lane ' + JSON.stringify(laneKey) + '. Known lanes: ' + Object.keys(LANES).join(', '));
  if (!fs.existsSync(lane.file)) {
    throw new Error(
      '#36 _master.js: the ' + lane.label + ' master is missing at ' + path.relative(REPO, lane.file).replace(/\\/g, '/') + '.\n' +
      '  vault/ is gitignored on purpose, so a fresh clone will not have it and cannot build this lane.\n' +
      '  Restore it from the nightly encrypted vault backup. Do NOT write a replacement from memory:\n' +
      '  the AI master is FROZEN and the only two ways it changes are Shaheen handing over a new file\n' +
      '  or Shaheen authorising a surgical correction.'
    );
  }
  const raw = fs.readFileSync(lane.file, 'utf8');
  if (!raw.trim()) throw new Error('#36 _master.js: the ' + lane.label + ' master is empty');
  return raw;
}

// ---------------------------------------------------------------------------------------------
// THE PRINTABLE HALF.
//
// Both masters carry a preamble (a title and blockquote lines about how the file is maintained)
// and a WRITER-AGENT NOTES half that is never printed. The notes heading is a CONTRACT, stated in
// scripts/build-cv-master.py: "the resync script's printable() splits on that string". This splits
// on exactly the same string, for exactly the same reason.
//
// The preamble ends at the FIRST horizontal rule. The Power BI master has four more rules inside
// its body, so anchoring on the first one and on the notes heading is the only split that works for
// both files.
// ---------------------------------------------------------------------------------------------
function splitPrintable(raw, laneKey) {
  const lines = raw.split('\n');
  let firstRule = -1;
  for (let i = 0; i < lines.length; i += 1) if (lines[i].trim() === '---') { firstRule = i; break; }
  if (firstRule < 0) throw new Error('#36 _master.js: the ' + laneKey + ' master has no horizontal rule ending its preamble. The file shape changed; do not guess where the CV starts.');
  const notesAt = lines.findIndex(l => l.trim() === NOTES_HEADING);
  if (notesAt < 0) {
    throw new Error(
      '#36 _master.js: the ' + laneKey + ' master has no ' + JSON.stringify(NOTES_HEADING) + ' heading.\n' +
      '  That heading is a contract (scripts/build-cv-master.py says so in as many words): every\n' +
      '  negative mark in this repo is checked against the half ABOVE it. Without it, a check for\n' +
      '  "TypeScript" would fire on the note that FORBIDS TypeScript, and the build would refuse\n' +
      '  forever for the most confusing possible reason.'
    );
  }
  // Offsets into the raw string, so the round trip can be proved on bytes rather than on lines.
  const start = lines.slice(0, firstRule + 1).join('\n').length + 1; // just after the rule line
  const end = lines.slice(0, notesAt).join('\n').length;
  return { text: raw.slice(start, end), start, end, notes: raw.slice(end) };
}

// ---------------------------------------------------------------------------------------------
// BLOCK CLASSIFICATION. Derived from the documents and from writer-notes, never hand-listed by id,
// so an authorised amendment that MOVES a line keeps that line's class.
//
// mandatory   emitted on every CV that ships, whether the selector asked for it or not
// selectable  the selector's actual menu
// structural  headings and horizontal rules: emitted only as the frame around a selected child
// meta        a role's date line: bound to its group, emitted whenever the group has any child
// directive   an instruction to the BUILDER that must never be printed
//
// THE MANDATORY SET, and where each one comes from:
//   name            the H1, or the "- Name:" header bullet. R4 asserts the rendered text contains
//                   "Shaheen Kiarash", so a CV without it fails the render check by definition.
//   contact         any block carrying an email, a phone or a LinkedIn URL. A CV a recruiter cannot
//                   answer is not a CV. This is the one mandatory class that is REDACTED from the
//                   model: the selector has no use for a phone number when choosing a bullet.
//   work auth       A11 asserts the line is exactly "Work authorization: Swedish citizen (EU
//                   citizen)". A check that asserts the content of a line the assembler was free to
//                   drop is a check that passes by accident, so the line is forced.
//   the header      EVERY non-directive block in the header section, which on the AI master is the
//                   four lines before the first H2 and on the Power BI master is the "## HEADER"
//                   bullet list. This is the ONE mandatory mark derived by JUDGEMENT rather than
//                   from a written rule, and it is called out as such.
//
//                   Why the whole header and not just the headline: the two masters write the same
//                   header differently. The AI master fuses location, availability, email, phone and
//                   LinkedIn into ONE line; the Power BI master splits them into six bullets. If
//                   only the contact-matching blocks were forced, the AI lane would always carry
//                   location and availability (they ride the contact line) and the Power BI lane
//                   would drop them, and the two lanes would ship structurally different headers for
//                   no reason anybody chose. Forcing the whole section makes them agree. Nothing in
//                   either header is a real trim target anyway: seven short lines against a ceiling
//                   that is spent on bullets.
//
// The PHOTO line in the Power BI master is the directive case: "Photo (for rendered CVs):
// outputs/.../profile-photo.jpg". It is a build instruction that happens to live in a bullet. A
// parser that treated it as selectable prose would eventually print a local file path on a CV.
// ---------------------------------------------------------------------------------------------
const RE_WORK_AUTH = /^(?:-\s*)?Work authorization\s*:/i;
const RE_NAME_BULLET = /^-\s*Name\s*:/i;
const RE_DIRECTIVE = /^-\s*(?:Photo|Template|Render|Build)\b[^:]*:/i;
// A role's date line: starts with a month or a year and carries a range. Matched loosely on
// purpose, both masters write it differently ("Feb 2026 - Present, Self-directed" against
// "Jun 2021 - Present <middot> BI Platform Owner").
const RE_META = /^(?:[A-Z][a-z]{2}\s+\d{4}|\d{4})\s*[-]\s*(?:Present|[A-Z][a-z]{2}\s+\d{4}|\d{4})/;

function classify(level, raw, text, section, firstAfterH3) {
  // A section heading frames content; it is never content. An H1 is different: in the AI master the
  // H1 IS his name, which is the single most mandatory string on the page (R4 asserts the rendered
  // text contains it). Treating every "#" line as structural would have made the name droppable.
  if (level === 'h2' || level === 'h3' || level === 'rule') return 'structural';
  if (RE_DIRECTIVE.test(raw)) return 'directive';
  if (level === 'h1') return 'mandatory';
  if (section === 'hdr') return 'mandatory';
  // Defensive, and deliberately AFTER the header rule: if a contact detail or the work-authorization
  // line ever moves out of the header in a future amendment, it stays forced and stays redacted
  // rather than quietly becoming a bullet the selector can drop.
  if (RE_WORK_AUTH.test(raw)) return 'mandatory';
  if (RE_NAME_BULLET.test(raw)) return 'mandatory';
  if (countContact(text).total > 0) return 'mandatory';
  // the line directly under an H3, when it reads as a date range, is that group's meta line
  if (firstAfterH3 && RE_META.test(text)) return 'meta';
  return 'selectable';
}

// ---------------------------------------------------------------------------------------------
// THE PARSER. Every character of the printable half belongs to exactly one block or to the gap
// between two blocks, which is what makes the round trip provable rather than approximate.
// ---------------------------------------------------------------------------------------------
function parseMaster(laneKey) {
  const lane = LANES[laneKey];
  const raw = readMaster(laneKey);
  const { text: printable } = splitPrintable(raw, laneKey);

  const blocks = [];
  const sections = [];
  let section = { key: 'hdr', title: null, groups: [] };  // pre-heading content is the header
  sections.push(section);
  let group = { key: 'x', title: null };
  section.groups.push(group);
  const seq = {};           // "<section>.<group>" -> running sequence
  let justOpenedGroup = false;

  const lines = printable.split('\n');
  let off = 0;
  for (const line of lines) {
    const lineStart = off;
    off += line.length + 1;
    if (!line.trim()) continue;   // blank lines are gap, never a block

    let kind, textOnly;
    if (/^#\s/.test(line)) { kind = 'h1'; textOnly = line.replace(/^#\s+/, ''); }
    else if (/^##\s/.test(line)) { kind = 'h2'; textOnly = line.replace(/^##\s+/, ''); }
    else if (/^###\s/.test(line)) { kind = 'h3'; textOnly = line.replace(/^###\s+/, ''); }
    else if (line.trim() === '---') { kind = 'rule'; textOnly = '---'; }
    else if (/^-\s/.test(line)) { kind = 'bullet'; textOnly = line.replace(/^-\s+/, ''); }
    else { kind = 'line'; textOnly = line; }

    if (kind === 'h2') {
      // An explicit "## HEADER" (the Power BI master has one, the AI master does not) folds into the
      // synthetic header section already open, so the two masters produce the same section keys from
      // different shapes. Anything else opens a new section.
      const slug = sectionSlug(textOnly);
      if (slug === 'hdr' && section.key === 'hdr') {
        section.title = textOnly;
      } else {
        section = { key: slug, title: textOnly, groups: [] };
        sections.push(section);
        group = { key: 'x', title: null };
        section.groups.push(group);
      }
      justOpenedGroup = false;
    } else if (kind === 'h3') {
      const n = section.groups.filter(g => g.key !== 'x').length + 1;
      group = { key: 'r' + n, title: textOnly };
      section.groups.push(group);
      justOpenedGroup = true;
    }

    const block = {
      kind: (kind === 'h1' || kind === 'h2' || kind === 'h3') ? 'heading' : kind,
      level: kind,
      raw: line,
      text: textOnly,
      section: section.key,
      section_title: section.title,
      group: group.key,
      group_title: group.title,
      start: lineStart,
      end: lineStart + line.length,
    };

    const firstAfterH3 = !!(blocks.length && blocks[blocks.length - 1].level === 'h3');
    block.role = classify(kind, line, textOnly, section.key, firstAfterH3);
    if (kind !== 'h3') justOpenedGroup = false;

    // id
    const gk = block.section + '.' + block.group;
    seq[gk] = (seq[gk] || 0) + 1;
    const n = String(seq[gk]).padStart(2, '0');
    block.seq = seq[gk];
    block.id = block.section + '.' + block.group + '.b' + n + '@' + sha256(block.text).slice(0, 8);
    block.chars = block.text.length;
    block.contact = countContact(block.text);

    blocks.push(block);
  }

  // id uniqueness. Two identical sentences in different places get different ids because the
  // prefix differs; two identical sentences in the SAME group would collide, and a colliding id
  // is an id that silently selects the wrong thing.
  const seen = new Map();
  for (const b of blocks) {
    if (seen.has(b.id)) {
      throw new Error('#36 _master.js: duplicate block id ' + b.id + ' in the ' + laneKey + ' master. Two blocks in one group carry identical text; the id cannot address either of them.');
    }
    seen.set(b.id, b);
  }

  return {
    lane: laneKey,
    label: lane.label,
    file: lane.file,
    master_sha256: sha256(raw),
    printable,
    printable_sha256: sha256(printable),
    blocks,
    byId: seen,
    sections,
    mandatory: blocks.filter(b => b.role === 'mandatory'),
    selectable: blocks.filter(b => b.role === 'selectable'),
    structural: blocks.filter(b => b.role === 'structural'),
    meta: blocks.filter(b => b.role === 'meta'),
    directive: blocks.filter(b => b.role === 'directive'),
    notes: splitPrintable(raw, laneKey).notes,
  };
}

// ---------------------------------------------------------------------------------------------
// THE ROUND TRIP. Reassembling every block in document order, with the gaps put back, has to
// reproduce the printable half BYTE FOR BYTE. Not nearly. Byte for byte.
//
// This is the proof that the parser has not quietly eaten anything. A parser that dropped one
// blank line would still look perfect in every other test in this repo, and would then produce a
// CV with two sections run together, and nobody would know why.
// ---------------------------------------------------------------------------------------------
function roundTrip(laneKey) {
  const m = parseMaster(laneKey);
  let out = '';
  let cursor = 0;
  for (const b of m.blocks) {
    out += m.printable.slice(cursor, b.start);   // the gap
    out += m.printable.slice(b.start, b.end);    // the block
    cursor = b.end;
  }
  out += m.printable.slice(cursor);              // the tail
  const ok = out === m.printable;
  let firstDiff = -1;
  if (!ok) {
    const n = Math.min(out.length, m.printable.length);
    for (let i = 0; i < n; i += 1) if (out[i] !== m.printable[i]) { firstDiff = i; break; }
    if (firstDiff < 0) firstDiff = n;
  }
  return {
    lane: laneKey,
    ok,
    expected_bytes: Buffer.byteLength(m.printable),
    actual_bytes: Buffer.byteLength(out),
    expected_sha256: sha256(m.printable),
    actual_sha256: sha256(out),
    first_difference_at: firstDiff,
    blocks: m.blocks.length,
  };
}

// ---------------------------------------------------------------------------------------------
// THE TWO VIEWS.
//
// modelView is what the selector is shown. printView is what the assembler emits from. The ONLY
// difference is contact redaction, and the count is ASSERTED rather than trusted: the model has no
// use for his phone number when it is choosing which bullet to keep, so it does not get it, and
// "does not get it" is a number this function checks rather than a sentence this comment claims.
// ---------------------------------------------------------------------------------------------
function view(laneKey, redact) {
  const m = parseMaster(laneKey);
  const shown = b => ({
    id: b.id,
    section: b.section,
    section_title: b.section_title,
    group: b.group,
    group_title: b.group_title,
    kind: b.level === 'line' ? 'line' : b.level,
    chars: b.chars,
    text: (redact && b.contact.total > 0) ? REDACTED : b.text,
  });

  const mandatory = m.mandatory.map(shown);
  const selectable = m.selectable.map(shown);
  const groups = [];
  for (const s of m.sections) {
    for (const g of s.groups) {
      const n = m.blocks.filter(b => b.section === s.key && b.group === g.key && (b.role === 'selectable' || b.role === 'mandatory')).length;
      if (n) groups.push({ section: s.key, section_title: s.title, group: g.key, group_title: g.title, blocks: n });
    }
  }

  const body = mandatory.concat(selectable).map(b => b.text).join('\n');
  const found = countContact(body);
  const redactedIds = m.blocks.filter(b => b.contact.total > 0).map(b => b.id);

  return {
    lane: laneKey,
    master_sha256: m.master_sha256,
    rules_sha: VR.RULES_SHA,
    ceiling_chars: PARA_CHAR_CEILING,
    groups,
    mandatory,
    selectable,
    redaction: {
      applied: !!redact,
      redacted_ids: redact ? redactedIds : [],
      contact_hits_in_this_view: found.total,
      contact_hits_by_pattern: found.by,
    },
  };
}

function modelView(laneKey) {
  const v = view(laneKey, true);
  const unredacted = view(laneKey, false);

  // ASSERT, do not trust. Two halves, and the second is the one that matters:
  //   (1) the model view must contain ZERO contact hits
  //   (2) the print view must contain MORE than zero, otherwise (1) is vacuously true and the
  //       whole redaction could be a no-op over patterns that match nothing.
  if (v.redaction.contact_hits_in_this_view !== 0) {
    throw new Error(
      '#36 _master.js: REDACTION FAILED for the ' + laneKey + ' lane. The model-facing view still\n' +
      '  contains ' + v.redaction.contact_hits_in_this_view + ' contact detail(s): ' + JSON.stringify(v.redaction.contact_hits_by_pattern) + '.\n' +
      '  Refusing to hand a selector his phone number. Fix the classifier before building.'
    );
  }
  if (unredacted.redaction.contact_hits_in_this_view === 0) {
    throw new Error(
      '#36 _master.js: the redaction assertion for the ' + laneKey + ' lane is VACUOUS. The print view\n' +
      '  carries zero contact hits, so "zero in the model view" proves nothing. Either the master lost\n' +
      '  its contact line, or CONTACT_PATTERNS no longer matches the way it is written.'
    );
  }
  if (!v.redaction.redacted_ids.length) {
    throw new Error('#36 _master.js: nothing was redacted for the ' + laneKey + ' lane, which cannot be right for a CV master.');
  }
  return v;
}

function printView(laneKey) { return view(laneKey, false); }

// ---------------------------------------------------------------------------------------------
// WHAT THE SELECTOR MUST EMIT, and what happens when it does not.
//
//   { "cv_block_ids": ["exp.r1.b02@...", "exp.r1.b05@..."], "section_order": ["sum","exp",...] }
//
// ids only, and an order. No text, no field called "rewritten", no "improved_bullet". The
// assembler below is the only thing that ever touches a string from the master, and it looks every
// id up rather than trusting any of them.
//
// ORDERING, and why it is not simply "the order the model gave":
//   sections follow section_order when given, document order otherwise
//   groups inside a section follow DOCUMENT order, always. A model cannot put the 2019 internship
//   above the current role by accident.
//   blocks inside a group follow the MODEL's order. That is the real tailoring lever: the bullet
//   that matches the ad goes first inside the role it belongs to.
// ---------------------------------------------------------------------------------------------
function assemble(laneKey, request) {
  const m = parseMaster(laneKey);
  const req = request || {};
  const ids = Array.isArray(req.ids) ? req.ids.slice() : [];

  // 1. every id resolves, or the run refuses. This is the wall the whole design rests on.
  const unknown = ids.filter(id => !m.byId.has(id));
  if (unknown.length) {
    const stale = unknown.filter(id => {
      const prefix = String(id).split('@')[0];
      return m.blocks.some(b => b.id.split('@')[0] === prefix);
    });
    throw new Error(
      '#36 _master.js: the selection names ' + unknown.length + ' block id(s) that do not exist in the ' +
      laneKey + ' master: ' + unknown.join(', ') + '\n' +
      (stale.length
        ? '  ' + stale.length + ' of them match a real block POSITION with a different content hash. That is\n' +
          '  the amendment signal: the master text changed under a pinned id. Re-read the master, do not\n' +
          '  patch the id.\n'
        : '  None of them match a known position either, so this is an invented id rather than a stale one.\n') +
      '  Nothing is assembled from an unresolved id. The CV is master text or it is nothing.'
    );
  }

  // 2. a block that is not the selector's to choose cannot be chosen
  for (const id of ids) {
    const b = m.byId.get(id);
    if (b.role === 'directive') throw new Error('#36 _master.js: block ' + id + ' is a BUILD DIRECTIVE, not CV text, and must never be printed.');
    if (b.role === 'structural') throw new Error('#36 _master.js: block ' + id + ' is a heading or a rule. Headings are emitted automatically around selected children, never selected.');
    if (b.role === 'meta') throw new Error('#36 _master.js: block ' + id + ' is a role date line. It rides with its group automatically.');
  }

  const chosen = new Set(ids);
  for (const b of m.mandatory) chosen.add(b.id);   // forced, whether asked for or not

  // 3. order
  const docSections = [];
  for (const s of m.sections) if (!docSections.includes(s.key)) docSections.push(s.key);
  let order = docSections;
  if (Array.isArray(req.section_order) && req.section_order.length) {
    const bad = req.section_order.filter(k => !docSections.includes(k));
    if (bad.length) throw new Error('#36 _master.js: section_order names unknown section(s): ' + bad.join(', ') + '. Known: ' + docSections.join(', '));
    order = req.section_order.concat(docSections.filter(k => !req.section_order.includes(k)));
  }

  const emitted = [];
  for (const sectionKey of order) {
    const sectionBlocks = m.blocks.filter(b => b.section === sectionKey);
    const heading = sectionBlocks.find(b => b.level === 'h2');
    const groupKeys = [];
    for (const b of sectionBlocks) if (!groupKeys.includes(b.group)) groupKeys.push(b.group);

    const sectionOut = [];
    for (const gk of groupKeys) {
      const inGroup = sectionBlocks.filter(b => b.group === gk);
      const picked = inGroup.filter(b => chosen.has(b.id));
      if (!picked.length) continue;                       // a group with nothing selected emits nothing
      const h3 = inGroup.find(b => b.level === 'h3');
      const metaLine = inGroup.find(b => b.role === 'meta');
      if (h3) sectionOut.push(h3);
      if (metaLine) sectionOut.push(metaLine);
      // the model's order inside the group, mandatory first so the header never shuffles
      const byRequest = ids.filter(id => picked.some(p => p.id === id)).map(id => m.byId.get(id));
      const forced = picked.filter(p => p.role === 'mandatory' && !byRequest.includes(p));
      const rest = picked.filter(p => !byRequest.includes(p) && !forced.includes(p));
      for (const b of forced.concat(byRequest, rest)) sectionOut.push(b);
    }
    if (!sectionOut.length) continue;                     // a section with nothing selected emits no heading
    if (heading) emitted.push(heading);
    for (const b of sectionOut) emitted.push(b);
  }

  const text = emitted.map(b => b.raw).join('\n');
  const paraChars = emitted.filter(b => b.level !== 'h1' && b.level !== 'h2' && b.level !== 'h3').reduce((a, b) => a + b.chars, 0);

  return {
    lane: laneKey,
    text,
    ids: emitted.map(b => b.id),
    block_count: emitted.length,
    mandatory_forced: m.mandatory.filter(b => !ids.includes(b.id)).map(b => b.id),
    para_chars: paraChars,
    ceiling_chars: PARA_CHAR_CEILING,
    over_ceiling: paraChars > PARA_CHAR_CEILING,
  };
}

// ---------------------------------------------------------------------------------------------
// APPROVED NUMBERS, the source A8 leans on.
//
// A8: every number in the letter appears in this list or in the ad text. The list is DERIVED, never
// typed, from two places:
//   the printable half   every number in his own CV text is by definition a number he stands behind
//   the notes half       writer-notes carries figures that are approved but not on the CV, the Alex
//                        scale line and the approved outcome metrics ("70-75%", "0.7%", "7.5+")
// Deriving it rather than listing it does three jobs at once: it cannot drift when he amends a
// master, it cannot go stale when a note is updated, and it keeps CV numbers out of a tracked file
// in a public repo.
//
// Tokenising is voice-rules.js's extractNumbers, the SAME function the letter audit uses, because
// an allowlist and a checker that disagree about what a number is will fail honest letters and pass
// invented ones.
// ---------------------------------------------------------------------------------------------
// TWO EXCLUSIONS, and both were found by looking at what the first cut actually produced rather
// than by reasoning about what it should produce.
//
//   THE CONTACT BLOCK IS NOT A SOURCE OF APPROVED NUMBERS. His phone number put 46, 76, 014, 07 and
//   37 on the allowlist. A letter could then claim "37 workflows" and pass A8 on the strength of
//   his area code. A phone number is a contact detail, never a figure he stands behind.
//
//   THE NOTES HARVEST STOPS AT THE FIRST SUBHEADING. The notes half of the AI mirror carries the
//   approved figures in its bullet list, and then an AMENDMENT LOG and a FILENAME LAW underneath.
//   The log is prose about edits, and it was contributing 20260819 and 20260820 (backup filenames),
//   106 (a line-ending count from an incident report) and 52. None of those is a claim he ever made.
//   The figure-bearing bullets are the part above the next "## ", so that is where the harvest ends.
//
// A token with a LEADING ZERO is dropped as well: "07" out of a rule date, "014" out of a phone.
// Nobody writes a claim figure with a leading zero, and "0.7" survives because the zero is followed
// by a separator rather than a digit.
function approvedNumbers(laneKey) {
  const m = parseMaster(laneKey);
  const lane = LANES[laneKey];
  const clean = list => list.filter(n => !/^0\d/.test(n));

  const masterText = m.blocks
    .filter(b => b.contact.total === 0 && b.role !== 'directive')
    .map(b => b.text).join('\n');
  const fromMaster = clean(VR.extractNumbers(masterText));

  // The AI mirror embeds the notes; the Power BI master keeps them inline. Either way the notes half
  // of the file is what we have, and the AI lane's source notes file is read too so the list
  // survives a mirror that is mid-rebuild.
  let notesText = firstNotesSection(m.notes);
  if (lane.notes_file && fs.existsSync(lane.notes_file)) {
    notesText += '\n' + firstNotesSection(fs.readFileSync(lane.notes_file, 'utf8'), '\n## Notes');
  }
  const fromNotes = clean(VR.extractNumbers(notesText));

  const all = Array.from(new Set(fromMaster.concat(fromNotes)));
  all.sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
  return {
    lane: laneKey,
    numbers: all,
    from_master: Array.from(new Set(fromMaster)),
    from_notes: Array.from(new Set(fromNotes)),
  };
}

// The bullet list under the notes heading, stopping at the next "## " subheading.
//
// ISO dates are stripped first. Almost every note is stamped with the day Shaheen set the rule
// ("updated 2026-07-27", "Shaheen 2026-07-14"), and those stamps were putting 27, 18 and 25 on the
// allowlist as if they were figures he had claimed. A rule's date is metadata about the rule, never
// a number in his CV.
function firstNotesSection(text, anchor) {
  const start = anchor ? text.indexOf(anchor) : text.indexOf(NOTES_HEADING);
  if (start < 0) return '';
  const after = text.slice(start + (anchor || NOTES_HEADING).length);
  const next = after.search(/\n## /);
  const body = next < 0 ? after : after.slice(0, next);
  return body.replace(/\b20\d{2}-\d{2}-\d{2}\b/g, ' ');
}

// ---------------------------------------------------------------------------------------------
// PRE-FLIGHT. Three refusals, each one a regression that must never reach a rendered CV.
//
// (1) THE MIRROR IS STALE AGAINST THE DOCX. master-ai-cv.md is GENERATED from the frozen .docx and
//     nothing downstream can read a .docx. A stale mirror means every CV this lane ships is built
//     from a version of his text he has already replaced, and it looks perfectly healthy the whole
//     time. build-cv-master.py --check is the only thing that can see it, so it is run rather than
//     assumed. It also carries its own banned-text gate (dashes, credential URLs, the visa sentence,
//     the superseded 12-minutes figure), so running it buys those too.
//
//     FAIL CLOSED, including when python is absent. This follows the gitleaks precedent in the root
//     constitution exactly: "a found secret blocks, a gitleaks that errors blocks, an ABSENT
//     gitleaks blocks", with one loud deliberate override. Here that override is
//     ALEX_ALLOW_NO_PYTHON=1, and it is loud: it prints what it is skipping.
//
// (2) A DASH IN EITHER MASTER. Shaheen, 2026-08-20: "NEVER AGAIN use it", after a CV shipped with
//     his 4 em-dashes and 3 en-dashes intact because a written carve-out said master text ships
//     verbatim. Both characters were removed at source, so verbatim reuse is dash-free BY
//     CONSTRUCTION, and this refusal is what keeps that true.
//
// (3) TypeScript OR JavaScript IN EITHER MASTER. Both were pruned as overclaims on his own
//     instruction, JS on 2026-07-25 and TS on 2026-08-19, and both must never be reintroduced.
//
// (2) AND (3) RUN ON THE PRINTABLE HALF ONLY, AND THAT IS NOT A SHORTCUT. The AI mirror's notes
// half contains the words TypeScript and JavaScript 8 and 3 times, inside the very rules that
// FORBID them. A whole-file check would refuse to build, every time, forever, for the most
// confusing possible reason, and the next person would weaken the check rather than read it. The
// notes heading exists precisely so a negative mark can be scoped to the recruiter-facing half;
// scripts/build-cv-master.py and resync-cv-2026-07-14.js already scope theirs the same way.
// ---------------------------------------------------------------------------------------------
function preflight(laneKeys) {
  const keys = laneKeys && laneKeys.length ? laneKeys : Object.keys(LANES);
  const report = [];

  for (const k of keys) {
    const lane = LANES[k];
    const raw = readMaster(k);
    const { text: printable } = splitPrintable(raw, k);

    // (2) dashes, printable half
    VR.DASH_RE.lastIndex = 0;
    const dashes = printable.match(VR.DASH_RE) || [];
    if (dashes.length) {
      const lines = printable.split('\n').filter(l => VR.DASH_RE.test(l)).slice(0, 5);
      throw new Error(
        '#36 _master.js: the ' + lane.label + ' master contains ' + dashes.length + ' dash character(s) in its\n' +
        '  printable half. Shaheen, 2026-08-20, verbatim: "you have use this [en-dash] in both versions\n' +
        '  PDF and Word, you already have this role, NEVER AGAIN use it."\n' +
        '  Offending line(s):\n    ' + lines.join('\n    ') + '\n' +
        '  Fix the master (back up into _amendments/ first), rebuild the mirror, then build again.'
      );
    }

    // (3) TypeScript / JavaScript, printable half
    for (const word of ['TypeScript', 'JavaScript']) {
      const re = new RegExp('\\b' + word + '\\b', 'gi');
      const hits = printable.match(re) || [];
      if (hits.length) {
        throw new Error(
          '#36 _master.js: the ' + lane.label + ' master claims ' + word + ' ' + hits.length + ' time(s) in its\n' +
          '  printable half. Shaheen does not write either language and both were pruned as overclaims on\n' +
          '  his own instruction (JavaScript 2026-07-25, TypeScript 2026-08-19). They must never be\n' +
          '  reintroduced, mirrored from a job ad, or bridged as "familiar".'
        );
      }
    }

    // (1) mirror staleness, AI lane only
    let mirror = 'n/a (md-first master, no docx behind it; the fixture pins its sha256 instead)';
    if (lane.mirror_of_docx) mirror = checkMirror();
    report.push({ lane: k, dashes: 0, typescript: 0, javascript: 0, mirror, printable_sha256: sha256(printable) });
  }
  return report;
}

function checkMirror() {
  const script = path.join(REPO, 'scripts', 'build-cv-master.py');
  if (!fs.existsSync(script)) throw new Error('#36 _master.js: scripts/build-cv-master.py is missing, so mirror staleness cannot be checked. That script is the only thing that can read the frozen docx.');
  // ALEX_PYTHON exists for two reasons: a machine where the interpreter is called python3, and the
  // negative test, which points it at a binary that does not exist to prove the fail-closed branch
  // actually fails closed. A guard whose "cannot run" path has never been exercised is a guard whose
  // "cannot run" path does not work.
  const python = process.env.ALEX_PYTHON || 'python';
  const r = spawnSync(python, [script, '--check'], { encoding: 'utf8' });
  if (r.error || r.status === null) {
    if (process.env.ALEX_ALLOW_NO_PYTHON === '1') {
      return 'SKIPPED by ALEX_ALLOW_NO_PYTHON=1. The mirror was NOT checked against the frozen docx on this build.';
    }
    throw new Error(
      '#36 _master.js: could not run ' + python + ' scripts/build-cv-master.py --check (' + ((r.error && r.error.message) || 'no exit status') + ').\n' +
      '  FAIL CLOSED, on purpose, the same way the commit hook treats an absent gitleaks: a staleness\n' +
      '  check that cannot run is not a staleness check that passed. Every CV built from a stale mirror\n' +
      '  ships text Shaheen has already replaced, and looks perfectly healthy doing it.\n' +
      '  Deliberate override, loudly: ALEX_ALLOW_NO_PYTHON=1'
    );
  }
  if (r.status !== 0) {
    throw new Error(
      '#36 _master.js: the AI master MIRROR IS STALE against master-ai-cv.docx.\n' +
      '  ' + String(r.stdout || '').trim() + '\n' +
      '  Rebuild it with: python scripts/build-cv-master.py\n' +
      '  Then re-run the fixture test: every block id whose text changed will have changed too, and\n' +
      '  that is the system working, not a bug. See nodes/MASTER-BLOCKS.md.'
    );
  }
  return 'fresh: ' + String(r.stdout || '').trim();
}

// ---------------------------------------------------------------------------------------------
// THE FINGERPRINT. Everything the fixture pins, and nothing else. Structure and hashes, never text.
// ---------------------------------------------------------------------------------------------
function fingerprint(laneKey) {
  const m = parseMaster(laneKey);
  return {
    lane: laneKey,
    master_sha256: m.master_sha256,
    printable_sha256: m.printable_sha256,
    counts: {
      blocks: m.blocks.length,
      mandatory: m.mandatory.length,
      selectable: m.selectable.length,
      structural: m.structural.length,
      meta: m.meta.length,
      directive: m.directive.length,
    },
    sections: m.sections.map(s => ({
      key: s.key,
      groups: s.groups.filter(g => m.blocks.some(b => b.section === s.key && b.group === g.key)).map(g => g.key),
      blocks: m.blocks.filter(b => b.section === s.key).length,
    })),
    mandatory_ids: m.mandatory.map(b => b.id),
    ids: m.blocks.map(b => b.id),
  };
}

module.exports = {
  LANES, PARA_CHAR_CEILING, NOTES_HEADING, REDACTED, CONTACT_PATTERNS,
  REPO, LANE_DIR,
  sha256, sectionSlug, countContact,
  parseMaster, roundTrip, modelView, printView, assemble,
  approvedNumbers, preflight, checkMirror, fingerprint,
};

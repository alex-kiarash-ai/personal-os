'use strict';
/*
 * _stage2.js - seat 4's build-time helper for runtime nodes 15 to 28. BUILD TIME ONLY.
 *
 * The leading underscore keeps it out of build.js's node glob (/^\d+-.+\.js$/), the same convention
 * as _lane.js and _master.js. The n8n box never calls any of this: it runs on this machine and
 * bakes its output into node parameters.
 *
 * =============================================================================================
 * WHY THIS FILE EXISTS RATHER THAN THREE COPIES OF THE SAME TWENTY LINES.
 * =============================================================================================
 * Three things in stage 2 must be READ out of something that already owns them, never restated:
 *
 *   1. THE URL GUARD. Seat 3 wrote it inside the generated code of 05-build-candidates.js and it
 *      is the reason an attacker-influenced spreadsheet cell cannot make this workflow fetch
 *      `http://gotenberg:3000` from inside the docker network. Node 15 fetches a SECOND
 *      attacker-influenced url (the employer website a model read out of a job ad), which is if
 *      anything the more exposed of the two, and a second hand-written copy of that guard is how
 *      one of them ends up with a rule the other does not have. Runtime nodes cannot require each
 *      other, so the only honest reuse is to lift the function SOURCE at build time and bake the
 *      same bytes into the second node.
 *
 *   2. THE HTML EXTRACTOR. Same argument, one node later: 09-attach-ad.js turns a fetched page into
 *      plain text, decodes entities, strips dashes at the door and recognises an authwall or a bot
 *      check. A company homepage is the same problem as a job ad and deserves the same reader.
 *
 *   3. THE JSON EXTRACTOR. 14-parse-job-brief.js already decides what "get one JSON object out of a
 *      model answer" means, fences and all. Two definitions of that would fail honest answers on
 *      one stage and accept malformed ones on another.
 *
 * bakedFunction() lifts one top-level function out of a node's GENERATED jsCode by name, checks it
 * parses on its own, and checks it still contains a phrase that proves it is the function meant. If
 * a lifted function is ever renamed or reshaped upstream, THIS build fails by name rather than the
 * copy quietly going stale.
 *
 * =============================================================================================
 * THE MASTER TABLES, AND THE PRIVACY LINE THEY SIT ON.
 * =============================================================================================
 * This file is TRACKED and the repo is PUBLIC, so it carries NO master text, NO employer name, NO
 * CV number and NO block id. It carries the CODE that reads those out of `_master.js` at build time
 * from the gitignored vault, exactly the way 05-build-candidates.js carries the code that bakes a
 * spreadsheet id it never names.
 *
 * The baked output does reach the n8n box, and that is the design rather than an oversight: the
 * selector cannot choose a bullet it has not been shown, and the assembler cannot emit a master
 * string it does not hold. MASTER-BLOCKS.md says it in as many words: "the text is what the
 * selector needs, and the text goes deliberately and only to the model that has to choose."
 * The MODEL view is redacted of contact details; the PRINT view is not, because the assembler has
 * to print them.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const MASTER = require('./_master.js');
const LN = require('./_lane.js');

function rel(p) { return path.relative(REPO, p).replace(/\\/g, '/'); }

// ---------------------------------------------------------------------------------------------
// LIFTING A FUNCTION OUT OF A NODE'S GENERATED CODE.
//
// The generated code is top-level JavaScript with zero-indent function declarations, so a function
// runs from `\nfunction NAME(` to the next `}` that starts a line. Brace COUNTING is deliberately
// not used: these functions contain regex literals such as /^\d{1,3}$/, and a counter that does not
// implement JavaScript's regex-versus-division ambiguity would cut in the wrong place and produce
// something that still parses. Column-zero closing braces are unambiguous in generated code and the
// parse check below is what proves the cut was clean.
// ---------------------------------------------------------------------------------------------
function bakedFunction(nodeRelFile, name, proofNeedle) {
  const abs = path.join(__dirname, nodeRelFile);
  if (!fs.existsSync(abs)) {
    throw new Error('#36 _stage2.js: cannot lift ' + name + '(), the node file ' + rel(abs) + ' is missing.');
  }
  delete require.cache[require.resolve(abs)];
  const def = require(abs);
  const src = String((def.parameters && def.parameters.jsCode) || '');
  const marker = '\nfunction ' + name + '(';
  const at = src.indexOf(marker);
  if (at === -1) {
    throw new Error(
      '#36 _stage2.js: ' + rel(abs) + ' no longer declares a top-level function called ' + JSON.stringify(name) + '.\n' +
      '  It is LIFTED rather than rewritten so stage 1 and stage 2 can never hold two different copies\n' +
      '  of the same rule. If it legitimately moved, decide where the rule lives now and change both\n' +
      '  ends in the same edit. Do NOT paste a copy into a stage 2 node to make this pass.'
    );
  }
  const end = src.indexOf('\n}', at + marker.length);
  if (end === -1) {
    throw new Error('#36 _stage2.js: ' + name + '() in ' + rel(abs) + ' has no closing brace at column zero, so the lift cannot find its end.');
  }
  const body = src.slice(at + 1, end + 2);
  if (proofNeedle && body.indexOf(proofNeedle) === -1) {
    throw new Error(
      '#36 _stage2.js: ' + name + '() was lifted out of ' + rel(abs) + ' but no longer contains ' + JSON.stringify(proofNeedle) + '.\n' +
      '  That phrase is what proves the lifted bytes are the rule this stage meant to reuse, rather than\n' +
      '  a different function that happens to carry the same name.'
    );
  }
  try {
    new Function(body);
  } catch (e) {
    throw new Error('#36 _stage2.js: the lifted ' + name + '() does not parse on its own (' + e.message + '). The cut is wrong, not the source.');
  }
  return body;
}

// Same idea for a baked const, but reading the SOURCE file rather than the generated code, for the
// build-time tables a node declares above its LOGIC template.
function readSourceNumber(nodeRelFile, re, what) {
  const abs = path.join(__dirname, nodeRelFile);
  const src = fs.readFileSync(abs, 'utf8');
  const m = re.exec(src);
  if (!m) {
    throw new Error(
      '#36 _stage2.js: could not find ' + what + ' in ' + rel(abs) + '.\n' +
      '  It is read rather than restated so the cost model and the node that spends the money cannot\n' +
      '  disagree about how many tokens a stage is allowed. If the shape changed, fix this reader.'
    );
  }
  return Number(m[1]);
}

// ---------------------------------------------------------------------------------------------
// THE BOARD AND ATS DENYLIST.
//
// Node 15 decides whether a url is the EMPLOYER's own site. A job board or an applicant tracking
// system is never that, and fetching one produces a page about the board, out of which a model
// would happily quote a "hook" that has nothing to do with the company.
//
// The board half is DERIVED from the shared source contract, so a source added to the collectors
// lands here in the same edit rather than being remembered. The ATS half is a written list, because
// no file in this repo knows it: the plan names greenhouse, lever, ashby, workable, linkedin and
// indeed, and the rest are added deliberately by this seat on the same reasoning. Over-blocking
// costs one hook, which is an outcome the design already calls acceptable (D6: refuse to invent
// one). Under-blocking puts a recruiting platform's marketing copy into his cover letter.
// ---------------------------------------------------------------------------------------------
const ATS_DENY_DOMAINS_FROM_PLAN = [
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'linkedin.com', 'indeed.com',
];
const ATS_DENY_DOMAINS_ADDED_BY_THIS_SEAT = [
  'smartrecruiters.com', 'teamtailor.com', 'recruitee.com', 'jobvite.com', 'bamboohr.com',
  'myworkdayjobs.com', 'workday.com', 'taleo.net', 'icims.com', 'successfactors.com',
  'personio.de', 'jobylon.com', 'varbi.com', 'reachmee.com', 'jobs.se', 'glassdoor.com',
  'monster.com', 'ziprecruiter.com', 'wellfound.com', 'angel.co', 'otta.com', 'welcometothejungle.com',
];

function hostOf(url) {
  const m = /^https?:\/\/([^/?#\s:@]+)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : null;
}

// The registrable-ish domain: the last two labels, which is what a denylist entry is written as.
// It is deliberately NOT a public-suffix implementation. A two-label cut over-matches for a
// co.uk-style suffix, and over-matching here means "do not treat this as the employer's own site",
// which is the safe direction.
function denyDomains() {
  const contract = LN.sourcesContract();
  const fromContract = [];
  for (const key of Object.keys(contract.sources || {})) {
    const h = hostOf((contract.sources[key] || {}).endpoint);
    if (!h) continue;
    const labels = h.replace(/^www\./, '').replace(/^api\./, '').split('.');
    const dom = labels.length >= 2 ? labels.slice(-2).join('.') : h;
    if (fromContract.indexOf(dom) === -1) fromContract.push(dom);
  }
  if (!fromContract.length) {
    throw new Error(
      '#36 _stage2.js: not one board host could be derived from the shared source contract.\n' +
      '  The denylist would then carry only the written ATS half, and every collector board would read\n' +
      '  as the employer own site. Refused rather than shipped short.'
    );
  }
  const all = fromContract.slice();
  for (const d of ATS_DENY_DOMAINS_FROM_PLAN.concat(ATS_DENY_DOMAINS_ADDED_BY_THIS_SEAT)) {
    if (all.indexOf(d) === -1) all.push(d);
  }
  all.sort();
  return { domains: all, from_contract: fromContract.slice().sort(), from_plan: ATS_DENY_DOMAINS_FROM_PLAN.slice(), added_here: ATS_DENY_DOMAINS_ADDED_BY_THIS_SEAT.slice() };
}

// ---------------------------------------------------------------------------------------------
// THE MASTER TABLES, in the two shapes stage 2 bakes.
// ---------------------------------------------------------------------------------------------

// What the SELECTOR is shown: every block it may choose, with its id, grouped the way the document
// groups them. Contact blocks arrive already redacted by _master.modelView(), which throws rather
// than hands a model a phone number.
function selectorView(masterKey) {
  const v = MASTER.modelView(masterKey);
  const order = [];
  for (const g of v.groups) {
    const key = g.section + '/' + g.group;
    if (order.indexOf(key) === -1) order.push(key);
  }
  return {
    lane: v.lane,
    master_sha256: v.master_sha256,
    ceiling_chars: v.ceiling_chars,
    groups: v.groups,
    group_order: order,
    mandatory: v.mandatory,
    selectable: v.selectable,
    redacted_ids: v.redaction.redacted_ids,
  };
}

// ---------------------------------------------------------------------------------------------
// THE CONTACT BELT.
//
// _master.modelView() already throws if its redaction failed, and this is the belt on that brace:
// it is run over the EXACT BYTES that leave this machine for a third party, after every other step
// has had its turn. Two guards over one fact is usually a smell; here it is not, because the two
// check different things. modelView checks that the redaction RAN. This checks what actually
// shipped, which is the only question a person cares about afterwards.
//
// It lives here rather than inline in node 24 for one reason: a guard nobody can call is a guard
// nobody can negative-test, and a redaction check that has never been shown catching a leak is
// indistinguishable from one that matches nothing.
//
// The id-shaped exclusion is load bearing. A block id is `exp.r1.b04@a1f9c2d0`, which an email
// pattern reads as an address. Excluding exactly that shape, and nothing looser, keeps the check
// honest: a real address has a dot after the at sign and an id never does.
// ---------------------------------------------------------------------------------------------
const CONTACT_RES = [
  { id: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { id: 'phone', re: /\+\d[\d\s().-]{6,}\d/g },
  { id: 'linkedin', re: /linkedin\.com\/in\/[A-Za-z0-9-]+/gi },
];
const BLOCK_ID_SHAPE = /^[a-z]+\.[a-z0-9]+\.b\d+@[0-9a-f]{8}$/;

function contactHitsIn(text) {
  const hits = [];
  for (const p of CONTACT_RES) {
    p.re.lastIndex = 0;
    for (const h of (String(text).match(p.re) || [])) {
      if (p.id === 'email' && BLOCK_ID_SHAPE.test(h)) continue;   // a block id, not an address
      hits.push({ pattern: p.id, sample: h });
    }
  }
  return hits;
}

// What the ASSEMBLER emits from: every block, in document order, with the raw markdown line the CV
// is printed from. This is the print view, so nothing is redacted: the header line the recruiter
// answers on is the whole point of a CV.
function assemblerTable(masterKey) {
  const m = MASTER.parseMaster(masterKey);

  const byId = {};
  for (const b of m.blocks) {
    byId[b.id] = {
      raw: b.raw,
      text: b.text,
      level: b.level,
      role: b.role,
      section: b.section,
      group: b.group,
      chars: b.chars,
    };
  }

  // Document order of sections and, inside each, of groups and of the blocks in each group. The
  // runtime assembler walks THIS rather than re-deriving order from ids, because an id is a string
  // and string order is not document order.
  const sections = [];
  for (const s of m.sections) {
    const sectionBlocks = m.blocks.filter((b) => b.section === s.key);
    if (!sectionBlocks.length) continue;
    const h2 = sectionBlocks.find((b) => b.level === 'h2');
    const groupKeys = [];
    for (const b of sectionBlocks) if (groupKeys.indexOf(b.group) === -1) groupKeys.push(b.group);
    sections.push({
      key: s.key,
      title: s.title,
      h2_id: h2 ? h2.id : null,
      groups: groupKeys.map((gk) => {
        const inGroup = sectionBlocks.filter((b) => b.group === gk);
        const h3 = inGroup.find((b) => b.level === 'h3');
        const meta = inGroup.find((b) => b.role === 'meta');
        return {
          key: gk,
          title: (h3 && h3.text) || null,
          h3_id: h3 ? h3.id : null,
          meta_id: meta ? meta.id : null,
          block_ids: inGroup.map((b) => b.id),
        };
      }),
    });
  }

  return {
    lane: masterKey,
    master_sha256: m.master_sha256,
    printable_sha256: m.printable_sha256,
    ceiling_chars: MASTER.PARA_CHAR_CEILING,
    byId,
    sections,
    mandatory_ids: m.mandatory.map((b) => b.id),
    selectable_ids: m.selectable.map((b) => b.id),
    // Ids the selector may NOT choose, by role, so the runtime can name the reason without
    // re-deriving what a role means.
    refused_ids: {
      structural: m.structural.map((b) => b.id),
      meta: m.meta.map((b) => b.id),
      directive: m.directive.map((b) => b.id),
    },
    // The position prefix of every id, so an unresolved id can be told apart from a stale one
    // WITHOUT the runtime holding a second copy of the hashing rule. A prefix that exists with a
    // different hash is the amendment signal.
    positions: m.blocks.map((b) => b.id.split('@')[0]),
  };
}

// The lane keys stage 2 bakes for, derived from the lane file rather than typed, so a third source
// lane fails here instead of producing a workflow that silently cannot tailor for it.
function masterKeys() {
  return LN.lanes().map((l) => l.master_key);
}

module.exports = {
  REPO, rel,
  bakedFunction, readSourceNumber,
  denyDomains, hostOf, contactHitsIn,
  selectorView, assemblerTable, masterKeys,
  PARA_CHAR_CEILING: MASTER.PARA_CHAR_CEILING,
};

'use strict';
/*
 * _render.js - seat 6's build-time helper for runtime nodes 44 to 51. BUILD TIME ONLY.
 *
 * The leading underscore keeps it out of build.js's node glob (/^\d+-.+\.js$/), the same convention
 * as _lane.js, _master.js and _stage2.js. The n8n box never calls any of this: it runs on this
 * machine and its output is baked into node parameters.
 *
 * =============================================================================================
 * WHY THIS FILE EXISTS AND NOT THREE COPIES OF THE SAME RULES.
 * =============================================================================================
 * Four things in stage 4 must live in exactly ONE place:
 *
 *   1. THE PAGE CSS AND THE RENDER SAFETY LAW THAT GOVERNS IT. Locked 2026-07-18 after a real
 *      clipped CV shipped. `.page` carries `min-height` and `overflow: visible`, never `height`
 *      with `overflow: hidden`. A comment saying so is not a check, so assertPageCssIsSafe() below
 *      is the check, it is exported, and test-stage-4.js shows it REFUSING the forbidden pairing
 *      before any pass is reported. A guard nobody can call is a guard nobody can negative test.
 *
 *   2. MD5. Node 44 hashes two markdown files and node 49 hashes two PDFs, and seat 7 compares all
 *      four against what Google Drive reports back. Two implementations of MD5 is two chances to
 *      disagree with Drive, so there is one function here, baked into both nodes as the SAME BYTES,
 *      and test-stage-4.js proves it against node crypto on real inputs.
 *
 *      WHY IT IS WRITTEN OUT BY HAND RATHER THAN REQUIRED. An n8n Code node cannot `require`
 *      builtins unless the box sets NODE_FUNCTION_ALLOW_BUILTIN, which is not set here and is not
 *      a change this seat gets to make to a live host. WebCrypto is present as a global and its
 *      digest list does not include MD5. So a pure JavaScript MD5 is the only honest option, and it
 *      is testable to the last byte, which is better than an unprovable dependency.
 *
 *   3. THE GOTENBERG FORM. The endpoint comes from config/lane.json through _lane.renderConfig()
 *      and is never retyped. The form FIELDS are here, once, with the reason for each, because two
 *      nodes must never send Chromium different print settings for two documents that have to look
 *      like they came from the same person.
 *
 *   4. THE FOUR FILE NAMES that make up one job folder. The two PDF names are the LAW and are read
 *      off the pair at run time (node 34 stamped them, validated against the regex in
 *      scripts/outputs-ledger.js). This file carries only the two markdown names, which no law
 *      governs, and it carries them so nodes 44 and 51 cannot disagree about what is in a folder.
 *
 * =============================================================================================
 * PRIVACY. This file is TRACKED and the repo is PUBLIC. It carries no spreadsheet id, no folder
 * id, no credential, no master text and no personal data. The Gotenberg host name is a docker
 * internal service name that resolves nowhere outside that network and it is read from lane.json,
 * not written here.
 */

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const LN = require('./_lane.js');

function rel(p) { return path.relative(REPO, p).replace(/\\/g, '/'); }

// ---------------------------------------------------------------------------------------------
// THE TWO MARKDOWN FILE NAMES.
//
// D12 and D15: one Drive folder per job, holding the two PDFs, a README and the saved posting. The
// PDF names are the law and come off the pair. These two are ours to choose, and they deliberately
// carry NO company name, for the same reason the law gives about the PDFs: the folder name and the
// ledger row carry the company, and neither of those ever leaves this machine.
// ---------------------------------------------------------------------------------------------
const README_FILENAME = 'README.md';
const JOB_AD_FILENAME = 'job-ad.md';

// ---------------------------------------------------------------------------------------------
// THE PAGE CSS.
//
// =============================================================================================
// THE RENDER SAFETY LAW (locked 2026-07-18, after a CV shipped with its last lines clipped off).
// =============================================================================================
//   .page { min-height: 296mm; overflow: visible }     ALWAYS
//   .page { height: ...; overflow: hidden }            NEVER
//
// The difference is the whole point. `height` plus `overflow: hidden` makes an over-long CV LOOK
// like it fits: the box stops at one page, the surplus is painted nowhere, the page count is 1, and
// every check downstream reports green. Worse, the clipped text STILL EXTRACTS from the PDF text
// layer, so a text based check cannot see it either. That is why R2 asserts the page count two
// independent ways and why this stylesheet can never grow a fixed height.
//
// `min-height` with `overflow: visible` fails the honest way instead: the box grows, Chromium
// paginates, a second page appears, and R2 refuses the pair. Fit by TIGHTENING, never by clipping.
//
// 296mm and not 297mm: A4 is 297mm and the page margin is zero, so 296 leaves a 1mm allowance for
// sub pixel rounding in Chromium's layout. A box declared at exactly 297mm can round to 297.02 and
// take a second page carrying nothing.
//
// =============================================================================================
// THE FONT, AND THE SUBSTITUTION THAT IS NOT A MISTAKE.
// =============================================================================================
// The brand type system (brand/config/brand-config.md, adopted 2026-07-06) sets generated documents
// in CALIBRI. Calibri is a Microsoft font and IT IS NOT ON THE GOTENBERG CONTAINER. Carlito is the
// metric compatible free substitute: same advance widths, same line breaks, same page fit, so a
// document laid out for Calibri renders identically in it. It is named FIRST so the container uses
// it, with Calibri behind it so a render on a Windows machine (which is how this stylesheet is
// measured offline) picks the real thing and produces the same geometry.
//
// Liberation Sans sits behind both as the floor. It is Arial metric rather than Calibri metric, so
// a page that falls through to it is WIDER and may take two pages, which R2 then refuses. That is
// the correct direction to fail in: a wrong font produces a visible refusal, never a silent reflow.
// Nobody should "fix" Carlito back to Calibri alone. The comment is in the stylesheet itself.
//
// =============================================================================================
// COLOUR, and the pre-flight gate applied rather than recited.
// =============================================================================================
// brand/config/color-system.md is the law and it wins. Read this session, not from memory:
//   body text      Ink Black    #001219   19.08:1 on white   (4.5:1 floor for normal text)
//   headings       Dark Teal    #005f73    7.28:1 on white
//   rule lines     Dark Cyan    #0a9396    3.73:1 on white   (3:1 floor for graphical objects,
//                                                             and it is a LINE, never text: at
//                                                             3.73 it fails the 4.5:1 text bar)
// No Golden Orange: the law allows at most one accent per page and an ATS document earns nothing
// from having one. No red family: it means alarm. No logo and no dark header bar, deliberately, and
// the reasoning is in the pre-flight line: this is Shaheen's own application document rather than
// an ALEX branded report, and a dark bar behind text is the single most reliable way to break the
// text extraction that R4 and R5 measure.
// ---------------------------------------------------------------------------------------------
const PAGE_MIN_HEIGHT_MM = 296;
const FONT_STACK = 'Carlito, Calibri, "Liberation Sans", Arial, Helvetica, sans-serif';

const CSS_BASE = [
  '/* GENERATED from work/36-job-application-writer/nodes/_render.js. Do not edit in the editor. */',
  '@page { size: A4; margin: 0; }',
  'html, body { margin: 0; padding: 0; background: #ffffff; }',
  '/* THE RENDER SAFETY LAW, locked 2026-07-18 after a clipped CV shipped.                     */',
  '/* min-height and overflow visible, NEVER height with overflow hidden. A clipped page counts */',
  '/* as one page and its lost text still extracts, so nothing downstream can see the loss.     */',
  '.page {',
  '  min-height: ' + PAGE_MIN_HEIGHT_MM + 'mm;',
  '  overflow: visible;',
  '  box-sizing: border-box;',
  '  padding: 13mm 14mm;',
  '  background: #ffffff;',
  '  color: #001219;',
  '  /* Carlito FIRST: Calibri is not on the Gotenberg container and Carlito is metric identical. */',
  '  /* Do not remove it. Liberation Sans behind them is Arial metric and will reflow wider.      */',
  '  font-family: ' + FONT_STACK + ';',
  '  text-align: left;',
  '  hyphens: none;',
  '  -webkit-hyphens: none;',
  '  overflow-wrap: break-word;',
  '}',
  'h1, h2, h3 { color: #005f73; margin: 0; font-weight: bold; page-break-after: avoid; break-after: avoid; }',
  'p, li { margin: 0; orphans: 2; widows: 2; }',
  'a { color: #001219; text-decoration: none; }',
].join('\n');

// The CV. Tight leading and a small type step, because D13 makes one page a hard refuse and the
// assembler is already dropping his own sentences to get under the 3760 character ceiling. Every
// millimetre this stylesheet saves is a sentence of his that survives the drop order.
//
// THE SIZE IS A MEASURED DEVIATION FROM THE BRAND SCALE, NOT A PREFERENCE, AND THE MEASUREMENTS ARE
// ON RECORD. brand-config.md sets generated documents at 11pt body with 20/16/13pt headings. A CV
// filled to the 3760 character ceiling, printed by a local Chromium, measured:
//
//   brand 11pt / 1.45 leading                                  TWO pages
//   9.4pt / 1.30 leading, brand heading margins                TWO pages
//   9.4pt / 1.26 leading, tightened heading margins            ONE page, with about 220 to 440
//                                                              characters of headroom past the ceiling
//
// So the brand body scale would make D13 refuse the very documents this lane exists to produce. The
// scale below is the largest BODY SIZE that fits: the savings come from leading and from the space
// around headings rather than from shrinking the type a reader has to read, which is the right place
// to take them from. Reproduce the measurement with test-stage-4.js section 8 on any machine with a
// Chromium.
//
// A WARNING WORTH LEAVING HERE. The 3760 character ceiling is a PROXY and it does not model heading
// count: a selection that spends its characters on many short headings is taller than one that
// spends them on prose, at the same character count. So a CV can pass the ceiling upstream and still
// come out two pages. That is not a defect in either place, it is why R2 exists and why D13 is
// enforced on the rendered page rather than on the estimate.
const CSS_CV = [
  CSS_BASE,
  '.page { font-size: 9.4pt; line-height: 1.26; }',
  'h1 { font-size: 16pt; margin: 0 0 1.4mm 0; }',
  'h2 { font-size: 11pt; margin: 2.8mm 0 1.0mm 0; letter-spacing: 0.3pt;',
  '     border-bottom: 0.5pt solid #0a9396; padding-bottom: 0.6mm; }',
  'h3 { font-size: 9.8pt; margin: 1.8mm 0 0.6mm 0; }',
  'p { margin: 0 0 1.0mm 0; }',
  'ul { margin: 0 0 1.0mm 0; padding-left: 4.6mm; }',
  'li { margin: 0 0 0.3mm 0; }',
  '.bridge { margin: 1.0mm 0; }',
  // The contact block. The master heads with a labelled bullet list and a CV does not want bullets
  // on its own phone number, so the FIRST list on the page is rendered as a run of lines. It is
  // positional rather than content matching on purpose: a rule keyed to the word HEADER would
  // silently stop applying the day a master renames that section.
  '.page > ul:first-of-type { list-style: none; padding-left: 0; margin-bottom: 2.2mm; }',
  '.page > ul:first-of-type li { margin: 0 0 0.3mm 0; }',
].join('\n');

// The letter. One page by construction (A3 bounds it at 100 to 280 words) and R3 asserts it anyway,
// because "by construction" is what everything says right up until it is not. Full brand body size
// here: there is no ceiling to fight and a letter a human reads should be comfortable.
const CSS_LETTER = [
  CSS_BASE,
  '.page { font-size: 11pt; line-height: 1.42; }',
  'p { margin: 0 0 4.2mm 0; }',
  'p:last-child { margin-bottom: 0; }',
].join('\n');

// ---------------------------------------------------------------------------------------------
// THE GUARD ON THE LAW. Exported so it can be shown FAILING.
//
// It refuses three things and each one is a real way the law gets broken by someone tidying up:
//   (a) `height:` and `overflow: hidden` together on the page rule. The named incident.
//   (b) `overflow: hidden` or `overflow: clip` ANYWHERE in the sheet. An inner container that hides
//       its overflow clips exactly as well as the page does, and the page count still reads 1.
//   (c) a page rule that has lost its `min-height` or its `overflow: visible`. Absence is how a law
//       stops applying without anybody deciding to stop applying it.
// ---------------------------------------------------------------------------------------------
function pageRuleOf(css) {
  const at = String(css).indexOf('.page {');
  if (at === -1) return null;
  const end = String(css).indexOf('}', at);
  if (end === -1) return null;
  return String(css).slice(at, end + 1);
}

function assertPageCssIsSafe(css, where) {
  const text = String(css);
  const w = where || 'the page stylesheet';

  // Every `.page { ... }` rule in the sheet, because the size step below the base adds a second one.
  const rules = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf('.page {', from);
    if (at === -1) break;
    const end = text.indexOf('}', at);
    if (end === -1) break;
    rules.push(text.slice(at, end + 1));
    from = end + 1;
  }
  if (!rules.length) {
    throw new Error(
      'render seat: ' + w + ' declares no `.page {` rule at all.\n' +
      '  The one page geometry, the safety law and the font stack all live on that rule. A stylesheet\n' +
      '  without it renders an unbounded document that nothing measures.'
    );
  }

  const joined = rules.join('\n');
  const hasFixedHeight = /(^|[;{\s])height\s*:/.test(joined);
  const hidesOverflow = /overflow\s*:\s*(hidden|clip)/.test(joined);
  if (hasFixedHeight && hidesOverflow) {
    throw new Error(
      'render seat: ' + w + ' sets `height` AND `overflow: hidden` on the page rule.\n' +
      '  THIS IS THE FORBIDDEN PAIRING, locked 2026-07-18 after a CV shipped with its last lines cut\n' +
      '  off and nothing noticed. It is not a style choice, it is the failure: the box stops at one\n' +
      '  page, the surplus is painted nowhere, the page count reads 1, AND THE LOST TEXT STILL\n' +
      '  EXTRACTS, so the text layer cannot see the loss either. Fit by tightening the type scale or\n' +
      '  by dropping a block upstream. Never by hiding what does not fit.'
    );
  }
  if (hidesOverflow) {
    throw new Error(
      'render seat: ' + w + ' hides overflow on the page rule.\n' +
      '  Without a fixed height that is usually harmless, and it is refused anyway because it is one\n' +
      '  edit away from the forbidden pairing and it reads to the next person as permission.'
    );
  }
  if (/overflow\s*:\s*(hidden|clip)/.test(text)) {
    throw new Error(
      'render seat: ' + w + ' hides overflow somewhere outside the page rule.\n' +
      '  An inner container that clips its own overflow loses text exactly as well as the page does,\n' +
      '  and the page count still reads 1. The law is about the document, not about one selector.'
    );
  }
  if (!/min-height\s*:\s*\d/.test(joined)) {
    throw new Error('render seat: ' + w + ' page rule has no `min-height`, so the page has no declared floor and a short document produces a short page that nothing can measure against A4.');
  }
  if (!/overflow\s*:\s*visible/.test(joined)) {
    throw new Error('render seat: ' + w + ' page rule no longer states `overflow: visible`. It is the default, and it is stated because the law is about what somebody reading this file is told, not only about what Chromium does.');
  }
  // The WHOLE sheet, not only the page rule. A dash in a comment is one edit away from a dash in a
  // content property, and a content property prints.
  if (text.indexOf(String.fromCharCode(8212)) !== -1 || text.indexOf(String.fromCharCode(8211)) !== -1) {
    throw new Error('render seat: ' + w + ' contains an em dash or an en dash. R6 scans the extracted PDF text and a stylesheet can put a character on the page through a content property, so the sheet is checked whole rather than only where the rule is.');
  }
  return true;
}

assertPageCssIsSafe(CSS_CV, 'the CV stylesheet');
assertPageCssIsSafe(CSS_LETTER, 'the letter stylesheet');

// ---------------------------------------------------------------------------------------------
// MD5, in plain JavaScript, so it runs inside an n8n Code node with no require and no WebCrypto.
//
// These two functions are baked into nodes 44 and 49 as the SAME BYTES by bakedFn() below.
// test-stage-4.js proves md5Utf8 and md5Bytes against node crypto on real strings and real PDF
// bytes, which is the only reason to trust a hand written hash at all.
//
// utf8Bytes matches Buffer.from(s, 'utf8') exactly, LONE SURROGATES INCLUDED: an unpaired surrogate
// becomes U+FFFD, three bytes, the same substitution node makes. That is not pedantry. Seat 7
// compares these digests against the md5Checksum Google Drive computes over the bytes it received,
// and those bytes are whatever n8n wrote, so this encoder has to agree with node or the read back
// fails on a document that uploaded perfectly.
// ---------------------------------------------------------------------------------------------
function utf8Bytes(str) {
  const s = String(str);
  const out = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    } else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        const cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        i += 1;
      } else {
        out.push(0xef, 0xbf, 0xbd);
      }
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out.push(0xef, 0xbf, 0xbd);
    } else {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return out;
}

function md5Bytes(input) {
  const n = input.length;
  const padLen = Math.ceil((n + 9) / 64) * 64;
  const msg = new Uint8Array(padLen);
  for (let i = 0; i < n; i += 1) msg[i] = input[i] & 0xff;
  msg[n] = 0x80;
  const bitLo = (n << 3) >>> 0;
  const bitHi = Math.floor(n / 536870912) >>> 0;
  msg[padLen - 8] = bitLo & 0xff;
  msg[padLen - 7] = (bitLo >>> 8) & 0xff;
  msg[padLen - 6] = (bitLo >>> 16) & 0xff;
  msg[padLen - 5] = (bitLo >>> 24) & 0xff;
  msg[padLen - 4] = bitHi & 0xff;
  msg[padLen - 3] = (bitHi >>> 8) & 0xff;
  msg[padLen - 2] = (bitHi >>> 16) & 0xff;
  msg[padLen - 1] = (bitHi >>> 24) & 0xff;

  const K = new Int32Array(64);
  for (let i = 0; i < 64; i += 1) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
  const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];

  let a0 = 0x67452301 | 0;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476 | 0;
  const M = new Int32Array(16);

  for (let off = 0; off < padLen; off += 64) {
    for (let j = 0; j < 16; j += 1) {
      const p = off + j * 4;
      M[j] = (msg[p] | (msg[p + 1] << 8) | (msg[p + 2] << 16) | (msg[p + 3] << 24)) | 0;
    }
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i += 1) {
      let F = 0;
      let g = 0;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  let hex = '';
  for (const v of [a0, b0, c0, d0]) {
    for (let i = 0; i < 4; i += 1) {
      const b = (v >>> (i * 8)) & 0xff;
      hex += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return hex;
}

function md5Utf8(str) { return md5Bytes(utf8Bytes(str)); }

// ---------------------------------------------------------------------------------------------
// BAKING A BUILD TIME FUNCTION INTO RUNTIME SOURCE.
//
// Same instinct as _stage2.bakedFunction() and node 34's bakedVoiceFunction(): the bytes that run
// on the box are the bytes that were tested here, and a proof needle makes a rename fail the BUILD
// rather than quietly baking a different function that happens to share a name.
// ---------------------------------------------------------------------------------------------
function bakedFn(fn, name, proofNeedle) {
  if (typeof fn !== 'function') {
    throw new Error('render seat: cannot bake ' + JSON.stringify(name) + ', it is not a function.');
  }
  const src = fn.toString();
  if (src.indexOf('function ' + name) !== 0) {
    throw new Error('render seat: the function baked as ' + JSON.stringify(name) + ' does not declare that name, so the runtime source would define something else.');
  }
  if (proofNeedle && src.indexOf(proofNeedle) === -1) {
    throw new Error('render seat: ' + name + '() no longer contains ' + JSON.stringify(proofNeedle) + '. That phrase is what proves the baked bytes are the function this seat meant to reuse.');
  }
  if (/[^\x00-\x7f]/.test(src)) {
    throw new Error('render seat: ' + name + '() contains a non ASCII character. It is baked into a node parameter that travels as JSON over REST, and the no dash law forbids exactly the characters most likely to appear.');
  }
  if (src.indexOf(String.fromCharCode(96)) !== -1) {
    throw new Error('render seat: ' + name + '() contains a backtick. The runtime templates in this project are template literals and a backtick terminates one mid function.');
  }
  return src + ';';
}

const MD5_RUNTIME = [
  bakedFn(utf8Bytes, 'utf8Bytes', '0xbd'),
  bakedFn(md5Bytes, 'md5Bytes', '0x67452301'),
  bakedFn(md5Utf8, 'md5Utf8', 'md5Bytes(utf8Bytes(str))'),
].join('\n');

// ---------------------------------------------------------------------------------------------
// THE GOTENBERG FORM.
//
// The endpoint is read from config/lane.json through _lane.renderConfig(). It is never typed here:
// the lane file is gitignored and this file is public, and more to the point one place owning a URL
// is the rule this whole project is built on.
//
// EVERY FIELD, AND WHY.
//   files                the HTML. Gotenberg keys the Chromium HTML route on the FILE NAME and it
//                        must be index.html. Node 46 sets that name; the form field is called files.
//   preferCssPageSize    true, so `@page { size: A4 }` in the stylesheet decides the paper and this
//                        seat has ONE place that owns geometry rather than two that can disagree.
//   marginTop/Bottom/    all zero, for the same reason: the margins are padding on `.page`, inside
//   Left/Right           the HTML, where the min-height that R2 depends on can account for them.
//                        Gotenberg defaults these to 0.39in, which would silently shrink the
//                        printable area under a box declared at 296mm and push every CV to page 2.
//   printBackground      false. An ATS document must not depend on a painted background, and
//                        Chromium not painting one is the cheapest way to be sure it does not.
//   emulatedMediaType    print, which is also the Gotenberg default. Stated because `@page` and
//                        `page-break-after` only apply under print emulation, and a default that
//                        moved would turn the pagination rules off with no error.
//   skipNetworkIdleEvent true. The document has no external resource of any kind: the stylesheet is
//                        inline, there is no image, no web font and no script. Waiting for network
//                        idle on a page that never opens a socket is dead time on every render.
//
// SINGLEPAGE IS NOT HERE AND MUST NEVER BE. Gotenberg's `singlePage` renders the whole document on
// one enormous page. It would make R2 pass on every CV ever produced, of any length, forever, while
// producing a PDF no printer and no recruiter can use. assertFormIsSafe() below refuses it by name.
// ---------------------------------------------------------------------------------------------
const FORM_BINARY_FIELD = 'files';
const FORM_FIELDS = [
  { name: 'preferCssPageSize', value: 'true' },
  { name: 'marginTop', value: '0' },
  { name: 'marginBottom', value: '0' },
  { name: 'marginLeft', value: '0' },
  { name: 'marginRight', value: '0' },
  { name: 'printBackground', value: 'false' },
  { name: 'emulatedMediaType', value: 'print' },
  { name: 'skipNetworkIdleEvent', value: 'true' },
];
const FORM_FORBIDDEN = {
  singlePage: 'it renders the whole document on one gigantic page, which makes the D13 one page assertion pass on a CV of any length at all',
  pdfa: 'PDF/A conversion runs the file through a second engine and the bytes R1 measured are no longer the bytes that ship',
  pdfua: 'the same, and neither is anything a recruiter asked for',
};

function assertFormIsSafe(fields) {
  const seen = {};
  for (const f of fields) {
    if (!f || typeof f.name !== 'string' || typeof f.value !== 'string') {
      throw new Error('render seat: a Gotenberg form field is not a { name, value } pair of strings: ' + JSON.stringify(f));
    }
    if (seen[f.name]) throw new Error('render seat: the Gotenberg form sets ' + JSON.stringify(f.name) + ' twice, and multipart order decides which one wins.');
    seen[f.name] = true;
    if (FORM_FORBIDDEN[f.name]) {
      throw new Error(
        'render seat: the Gotenberg form sets ' + JSON.stringify(f.name) + ', which is refused because ' + FORM_FORBIDDEN[f.name] + '.\n' +
        '  R2 exists to catch a CV that does not fit one page. A form field that makes it always fit is\n' +
        '  not a render setting, it is the check being switched off from the other end.'
      );
    }
  }
  for (const need of ['preferCssPageSize', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight']) {
    if (!seen[need]) {
      throw new Error(
        'render seat: the Gotenberg form does not set ' + JSON.stringify(need) + '.\n' +
        '  Geometry lives in the stylesheet and the form has to say so. Gotenberg defaults the four\n' +
        '  margins to 0.39in, which shrinks the printable area under a box declared at ' + PAGE_MIN_HEIGHT_MM + 'mm and\n' +
        '  pushes a CV that genuinely fits onto a second page that R2 then refuses.'
      );
    }
  }
  return true;
}
assertFormIsSafe(FORM_FIELDS);

// ---------------------------------------------------------------------------------------------
// THE ENDPOINT, read and sanity checked rather than trusted.
// ---------------------------------------------------------------------------------------------
function gotenberg() {
  const r = LN.renderConfig();
  if (typeof r.html_endpoint !== 'string' || !/^https?:\/\//.test(r.html_endpoint)) {
    throw new Error('render seat: lane.json render.gotenberg_html_endpoint is ' + JSON.stringify(r.html_endpoint) + ', which is not an absolute http url.');
  }
  if (r.html_endpoint.indexOf('/forms/chromium/convert/html') === -1) {
    throw new Error(
      'render seat: lane.json render.gotenberg_html_endpoint is ' + JSON.stringify(r.html_endpoint) + '.\n' +
      '  This seat posts a multipart form containing an index.html to the CHROMIUM HTML route. The\n' +
      '  markdown and url routes take different fields and the libreoffice route takes a different file\n' +
      '  entirely, so a changed path here is a changed node, not a changed string.'
    );
  }
  return r;
}

// ---------------------------------------------------------------------------------------------
// A last pass over any generated source this seat ships. Two characters and one marker.
// ---------------------------------------------------------------------------------------------
function assertGeneratedSourceIsClean(source, nodeName) {
  const src = String(source);
  if (src.indexOf(String.fromCharCode(8212)) !== -1 || src.indexOf(String.fromCharCode(8211)) !== -1) {
    throw new Error(nodeName + ': the generated source contains an em dash or an en dash, which is the exact character R6 exists to refuse in the rendered output.');
  }
  if (nodeName === 'Build Writer Request') {
    throw new Error(nodeName + ': no node in this seat may carry that name. It is the voice sync enrolment key and belongs to the letter writer alone.');
  }
  if (src.indexOf('SOUL_VOICE_START') !== -1) {
    throw new Error(nodeName + ': the generated source carries a soul voice block. Nothing in this seat writes prose in his voice; it renders prose that was already written and checked.');
  }
  return true;
}

module.exports = {
  REPO, rel,
  README_FILENAME, JOB_AD_FILENAME,
  PAGE_MIN_HEIGHT_MM, FONT_STACK,
  CSS_BASE, CSS_CV, CSS_LETTER,
  assertPageCssIsSafe, pageRuleOf,
  utf8Bytes, md5Bytes, md5Utf8, MD5_RUNTIME, bakedFn,
  FORM_BINARY_FIELD, FORM_FIELDS, FORM_FORBIDDEN, assertFormIsSafe,
  gotenberg,
  assertGeneratedSourceIsClean,
};

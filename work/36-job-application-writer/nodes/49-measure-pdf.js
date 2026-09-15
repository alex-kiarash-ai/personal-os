'use strict';
/*
 * 49-measure-pdf.js - "Measure PDF". Weighs and counts each rendered PDF, and pairs it back to the
 * document it was asked for.
 *
 * =============================================================================================
 * 1. THE SECOND PAGE COUNT, AND WHY THERE HAS TO BE ONE.
 * =============================================================================================
 * Extract PDF Text already reported `numpages` from the PDF parser. This node counts again, over
 * the raw bytes, with a regex for the `/Type /Page` object dictionaries a PDF page is made of. The
 * negative lookahead is the whole craft in it: `/Type /Pages` is the page TREE, exactly one per
 * document, and a regex that counted it would report two pages for every single page PDF ever made.
 *
 * Two counts, because the render safety law says a page count taken from the text layer alone cannot
 * be trusted. A document that hid its overflow reports one page and extracts perfectly while its
 * last third is painted nowhere. R2 asserts both counts AND asserts they agree, and treats a
 * disagreement as a failure rather than picking a winner, because a measurement two methods cannot
 * confirm is not a measurement this workflow will ship a document on.
 *
 * MEASURED, NOT ASSUMED: the regex was run against real Chromium output during this build (local
 * Chrome print-to-pdf, Producer Skia/PDF, which is the same writer Gotenberg drives) and returned 1
 * on a one page document and 2 on a two page one, with no object streams and no cross reference
 * streams in the file. That is the measurement that makes the method honest. What it does NOT prove
 * is the Gotenberg container specifically, and if a future Chromium starts writing compressed object
 * streams the page dictionaries stop being visible as plain bytes and this count goes to zero. That
 * failure is LOUD by construction: zero against a healthy numpages is a disagreement, R2 refuses the
 * pair, and the reason names both numbers. It is not a case to loosen. It is a case to replace the
 * method.
 *
 * =============================================================================================
 * 2. THE PAIRING. THE WORST FAILURE THIS LANE CAN PRODUCE IS A CV ATTACHED TO THE WRONG JOB.
 * =============================================================================================
 * The responses coming back from an HTTP node are a flat list, and nothing in them says which
 * document they are. So the authoritative order is READ from Render Route output 0, exactly the way
 * Build Research Request reads Site Route, and it is cross checked three ways before a single byte
 * is attributed to a document:
 *
 *   the count Build Documents queued   equals   what Render Route sent
 *   what Render Route sent             equals   what came back
 *   every response pairedItem index    equals   its position in the list
 *
 * Any one of those failing refuses the WHOLE batch. Nothing is guessed, nothing is matched on a
 * best effort, and every render in a refused batch is marked so Check Renders holds its pair. A
 * cover letter for one company attached to another company job is not a bug somebody notices later,
 * it is a letter that has already been sent.
 *
 * =============================================================================================
 * 3. THE BINARY IS CARRIED THROUGH, BECAUSE SEAT 7 UPLOADS BYTES AND NOT A PATH.
 * =============================================================================================
 * A Code node returning `{ json, binary }` passes the binary descriptor along untouched. That is how
 * the PDF reaches Check Renders and then the Drive upload. Nothing here rewrites the descriptor: the
 * shipping file name is applied at the LAST possible moment, by Check Renders, from the pair, so
 * exactly one node in this workflow decides what a recruiter sees a file called.
 *
 * =============================================================================================
 * 4. MD5 HERE AND MD5 IN NODE 44 ARE THE SAME BYTES.
 * =============================================================================================
 * Both are baked from nodes/_render.js. Seat 7 compares all four digests against what Google Drive
 * reports back, and two implementations of MD5 would be two chances to disagree with Drive about a
 * file that uploaded perfectly. test-stage-4.js proves the baked function against node crypto on
 * real PDF bytes, which is the only reason to trust a hand written hash at all.
 *
 * It is hand written because an n8n Code node cannot require a builtin unless the box sets
 * NODE_FUNCTION_ALLOW_BUILTIN, which it does not, and WebCrypto does not offer MD5.
 */

const RN = require('./_render');

const NODE_NAME = 'Measure PDF';
const BINARY_PROPERTY = 'data';

// The page dictionary pattern. Written here as a SOURCE string rather than a literal so the exact
// characters are visible in one place and so the test can assert the shipped node carries this and
// not something a tidy-up rewrote.
//   \/Type\s*\/Page      the object dictionary every page carries
//   (?![s\w])            and NOT /Pages, which is the page tree, one per document
const PAGE_RE_SOURCE = '\\/Type\\s*\\/Page(?![s\\w])';
const PAGE_RE_FLAGS = 'g';

function assertAgainstUpstream() {
  const extract = require('./48-extract-pdf-text.js');
  const route = require('./45-render-route.js');
  const build = require('./44-build-documents.js');
  if (extract.name !== 'Extract PDF Text') {
    throw new Error('Measure PDF: node 48 is named ' + JSON.stringify(extract.name) + ' and this node connects from "Extract PDF Text" and reads its numpages.');
  }
  if (route.name !== 'Render Route') {
    throw new Error('Measure PDF: node 45 is named ' + JSON.stringify(route.name) + ' and this node reads $(\'Render Route\') output 0 for the authoritative sent order.');
  }
  if (extract.parameters.binaryPropertyName !== BINARY_PROPERTY) {
    throw new Error('Measure PDF: Extract PDF Text reads binary property ' + JSON.stringify(extract.parameters.binaryPropertyName) + ' and this node asks the helper for ' + JSON.stringify(BINARY_PROPERTY) + '.');
  }
  if (extract.onError !== 'continueRegularOutput') {
    throw new Error('Measure PDF: Extract PDF Text no longer continues on error, so a failed render would stop the workflow before this node and the sent order this node pairs on would never be checked.');
  }
  const bc = String(build.parameters.jsCode || '');
  for (const needle of ['render_key: pairId +', 'pair_id: pairId,', "doc: 'cv',", "doc: 'letter',"]) {
    if (bc.indexOf(needle) === -1) {
      throw new Error(
        'Measure PDF: Build Documents no longer stamps ' + JSON.stringify(needle) + ' on its render items.\n' +
        '  pair_id and doc are how a measured PDF finds its way back to the application it belongs to.\n' +
        '  Without them the only thing left is position, and position alone is how a cover letter for\n' +
        '  one company ends up attached to another company job.'
      );
    }
  }

  // The regex, proved on the two cases that matter, here, at build time. A page counter that counts
  // the page TREE reports two for every one page document, and it would do it silently.
  const re = new RegExp(PAGE_RE_SOURCE, PAGE_RE_FLAGS);
  const onePage = '<< /Type /Pages /Kids [ 3 0 R ] /Count 1 >> << /Type /Page /Parent 2 0 R >>';
  const twoPage = onePage + ' << /Type /Page /Parent 2 0 R >>';
  const count = (s) => (String(s).match(new RegExp(PAGE_RE_SOURCE, PAGE_RE_FLAGS)) || []).length;
  if (count(onePage) !== 1) {
    throw new Error('Measure PDF: the page regex counts ' + count(onePage) + ' on a synthetic one page document. It is either matching the page tree or missing the page.');
  }
  if (count(twoPage) !== 2) {
    throw new Error('Measure PDF: the page regex counts ' + count(twoPage) + ' on a synthetic two page document.');
  }
  if (!re.test('/Type/Page ')) {
    throw new Error('Measure PDF: the page regex does not match the unspaced form /Type/Page, which is what a PDF writer that omits the optional whitespace produces.');
  }

  const generated = renderJsCode();
  RN.assertGeneratedSourceIsClean(generated, NODE_NAME);
}

const LOGIC = `
// ---------------------------------------------------------------------------
// Measure PDF. Bytes, md5, and a second page count, paired back by sent order.
// ---------------------------------------------------------------------------
const NL = String.fromCharCode(10);

${RN.MD5_RUNTIME}

// The raw bytes as a latin1 string, so a regex can be run over the PDF structure. Chunked because
// String.fromCharCode.apply over a whole buffer overflows the argument stack on anything large, and
// a CV PDF is tens of kilobytes rather than tens of bytes.
function bytesToLatin1(buf) {
  if (buf && typeof buf.toString === 'function' && buf.constructor && buf.constructor.name === 'Buffer') {
    return buf.toString('latin1');
  }
  let s = '';
  const CHUNK = 8192;
  for (let i = 0; i < buf.length; i += CHUNK) {
    const part = [];
    const end = Math.min(i + CHUNK, buf.length);
    for (let k = i; k < end; k += 1) part.push(buf[k] & 255);
    s += String.fromCharCode.apply(null, part);
  }
  return s;
}

function countPagesInBytes(latin1) {
  const re = new RegExp(PAGE_RE_SOURCE, PAGE_RE_FLAGS);
  const m = String(latin1).match(re);
  return m ? m.length : 0;
}

// ---------------------------------------------------------------------------
// EVERYTHING BELOW RUNS INSIDE AN ASYNC ARROW, AND RETURNS ITS PROMISE.
//
// Reading binary out of an n8n Code node is asynchronous: getBinaryDataBuffer fetches from wherever
// the instance actually keeps binary data, which is the filesystem or S3 rather than the item,
// unless the box is in memory mode. So this node needs await, and n8n supports await at the top
// level of a Code node because it runs the body as an async function.
//
// It is NOT written that way here, deliberately. build.js assertCodeParses checks every generated
// body with new Function(code), and that parses a body as a plain function, where a top level await
// is a SyntaxError. A node that cannot pass that guard would have to be exempted from it, and that
// guard is the one thing standing between a typo in generated source and a two minute failure on
// the box with no file name attached.
//
// Returning the promise costs nothing and keeps the guard. The Code node body is an async function,
// so a returned promise is awaited before the items are read. The arrow matters: this inside an
// arrow is the node context, which is where the binary helper lives. A plain function expression
// would rebind it and getBinaryDataBuffer would be undefined.
// ---------------------------------------------------------------------------
return (async () => {

// --- 1. the three views of what was rendered ---------------------------------
let sent = null;
try {
  sent = $('Render Route').all(0).map((i) => i.json);
} catch (e) {
  sent = null;
}
let expectedCalls = null;
try {
  expectedCalls = $('Build Documents').all().map((i) => i.json).filter((j) => j && j._kind === 'render').length;
} catch (e) {
  expectedCalls = null;
}
if (sent === null) sent = [];

const responses = $input.all();
const warnings = [];
let pairing = 'ok';
let pairingWhy = null;

if (expectedCalls !== null && sent.length !== expectedCalls) {
  pairing = 'mismatch';
  pairingWhy = 'Build Documents queued ' + expectedCalls + ' render item(s) and Render Route sent ' + sent.length +
    ' down the render branch. The route and the stamp have come apart, so nothing here can say which PDF belongs to which document.';
} else if (responses.length !== sent.length) {
  pairing = 'mismatch';
  pairingWhy = 'Render Route sent ' + sent.length + ' document(s) and ' + responses.length + ' came back. Refusing to guess an alignment: a cover letter attached to another company job is a letter that has already been sent.';
}
if (pairing === 'ok') {
  for (let i = 0; i < responses.length; i += 1) {
    const pi = responses[i] && responses[i].pairedItem;
    const idx = pi && typeof pi === 'object' && !Array.isArray(pi) ? pi.item : (Array.isArray(pi) && pi.length ? pi[0].item : undefined);
    if (idx !== undefined && Number(idx) !== i) {
      pairing = 'mismatch';
      pairingWhy = 'response ' + i + ' carries pairedItem ' + JSON.stringify(idx) + ', so the PDFs are not in the order the documents were sent. Refusing to guess an alignment.';
      break;
    }
  }
}

// --- 2. per document -----------------------------------------------------------
const out = [];
const stats = { documents: 0, measured: 0, failed_render: 0, no_binary: 0, pairing_refused: 0, disagreements: 0 };
const errorSamples = [];

function unmeasurable(r, state, why) {
  r.render_state = state;
  r.render_why = why;
  r.pdf_bytes = 0;
  r.pdf_md5 = null;
  r.pages_bytes = null;
  r.pages_numpages = null;
  r.pages_agree = false;
  r.pdf_text = '';
  r.pdf_text_chars = 0;
  r._call_now = false;
  if (errorSamples.length < 6) errorSamples.push({ render_key: r.render_key, state: state, why: String(why).slice(0, 200) });
}

for (let i = 0; i < sent.length; i += 1) {
  const r = Object.assign({}, sent[i]);
  delete r.html;   // the document has been rendered; carrying it further doubles every item for nothing
  stats.documents += 1;

  if (pairing === 'mismatch') {
    stats.pairing_refused += 1;
    unmeasurable(r, 'error:pairing', pairingWhy);
    out.push({ json: r, binary: undefined });
    continue;
  }

  const item = responses[i] || {};
  const j = item.json || {};

  // Render PDF exhausted its retries, or Extract PDF Text threw on an item with no binary. Either
  // way the item carries an error field instead of a document.
  if (j.error !== undefined) {
    stats.failed_render += 1;
    const msg = String(typeof j.error === 'string' ? j.error : (j.error && j.error.message) || JSON.stringify(j.error)).slice(0, 300);
    unmeasurable(r, 'error:render', 'the render or the extraction failed after every retry (' + msg + ').');
    out.push({ json: r, binary: undefined });
    continue;
  }

  let buf = null;
  let bufWhy = null;
  try {
    buf = await this.helpers.getBinaryDataBuffer(i, BINARY_PROPERTY);
  } catch (e) {
    buf = null;
    bufWhy = e && e.message ? e.message : String(e);
  }
  if (!buf || !buf.length) {
    stats.no_binary += 1;
    unmeasurable(r, 'error:render',
      'no PDF bytes are on this item under the binary property ' + BINARY_PROPERTY + (bufWhy ? ' (' + bufWhy + ')' : '') +
      '. Either the render returned nothing, or the node before this one did not carry the binary through. If every document in the run says this while the extraction reported a healthy page count, it is the SECOND case: move the measurement ahead of the extraction, or join the two branches, rather than loosening this check.');
    out.push({ json: r, binary: undefined });
    continue;
  }

  const latin1 = bytesToLatin1(buf);
  const pagesBytes = countPagesInBytes(latin1);
  const rawNumPages = j.numpages;
  const pagesNum = (rawNumPages === undefined || rawNumPages === null || !isFinite(Number(rawNumPages))) ? null : Number(rawNumPages);
  const agree = pagesNum !== null && pagesNum === pagesBytes;

  r.pdf_bytes = buf.length;
  r.pdf_md5 = md5Bytes(buf);
  r.pages_bytes = pagesBytes;
  r.pages_numpages = pagesNum;
  r.pages_agree = agree;
  r.pdf_text = typeof j.text === 'string' ? j.text : '';
  r.pdf_text_chars = r.pdf_text.length;
  r.pdf_info = (j.info && typeof j.info === 'object') ? { Producer: j.info.Producer || null, Title: j.info.Title || null, Creator: j.info.Creator || null } : null;
  r.render_state = 'measured';
  r.render_why = buf.length + ' bytes, ' + pagesBytes + ' page(s) by the byte scan and ' + (pagesNum === null ? 'no count' : pagesNum + ' page(s)') + ' by the pdf parser, ' + r.pdf_text_chars + ' characters of text.';
  r._call_now = false;
  stats.measured += 1;
  if (!agree) {
    stats.disagreements += 1;
    if (errorSamples.length < 6) errorSamples.push({ render_key: r.render_key, state: 'page_count_disagreement', why: 'bytes say ' + pagesBytes + ', the parser says ' + JSON.stringify(pagesNum) });
  }
  out.push({ json: r, binary: item.binary });
}

// --- 3. everything else passes through untouched --------------------------------
// Nothing does: this node sits on the render branch only, and the carried branch rejoins at Render
// Results. Stated rather than left as an absence, because every other Code node in this workflow
// carries a stream through and a reader who does not find that here should know it is deliberate.

// --- 4. the stage report ----------------------------------------------------------
if (pairing === 'mismatch') {
  warnings.push('RENDER PAIRING REFUSED, and no PDF was attributed to any document because of it: ' + pairingWhy + ' Every pair in this batch is held rather than shipped, because the alternative to guessing is refusing.');
}
if (stats.failed_render > 0) {
  warnings.push(stats.failed_render + ' document(s) did not render after four tries. That is SYSTEMIC: the affected sheet rows stay at new so tomorrow offers the job again, because a container that was down must never look like a job that was considered and rejected.');
}
if (stats.disagreements > 0) {
  warnings.push(stats.disagreements + ' document(s) got two DIFFERENT page counts from the two independent methods. That is refused rather than resolved. If the byte scan says zero while the parser looks healthy, the PDF writer has started compressing its object dictionaries and the byte method needs replacing, not loosening.');
}

const report = {
  _kind: 'stage_report',
  stage: 'measure_pdf',
  counts: stats,
  pairing: { state: pairing, why: pairingWhy, sent: sent.length, responses: responses.length, expected: expectedCalls },
  errors: errorSamples,
  page_count_methods: 'two, independent: a regex for /Type /Page over the raw bytes, and the numpages the pdf parser reported. R2 requires both to say one AND requires them to agree, because the render safety law is explicit that a count taken from the text layer alone cannot be trusted: clipped text still extracts.',
  md5_note: 'the digest is over the exact PDF bytes measured here, computed with the same function that hashed the two markdown files, so seat 7 can compare all four against what Drive reports back.',
  warnings: warnings,
  _call_now: false,
  site_fetch_url: '',
  ad_fetch_url: '',
};
out.push({ json: report, binary: undefined });

return out.map((o) => (o.binary ? { json: o.json, binary: o.binary, pairedItem: { item: 0 } } : { json: o.json, pairedItem: { item: 0 } }));

})();
`;

function renderJsCode() {
  return [
    '// GENERATED at build time from work/36-job-application-writer/nodes/49-measure-pdf.js.',
    '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
    'const BINARY_PROPERTY = ' + JSON.stringify(BINARY_PROPERTY) + ';',
    'const PAGE_RE_SOURCE = ' + JSON.stringify(PAGE_RE_SOURCE) + ';',
    'const PAGE_RE_FLAGS = ' + JSON.stringify(PAGE_RE_FLAGS) + ';',
    LOGIC,
  ].join('\n');
}

assertAgainstUpstream();

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [12220, 0],
  connectFrom: 'Extract PDF Text',
  notes: 'Weighs each rendered PDF, hashes it with the same MD5 that hashed the two markdown files, and counts its pages a SECOND and independent way with a regex over the raw bytes. Two counts because the render safety law says a page count from the text layer alone cannot be trusted: clipped text still extracts. The PDFs are paired back to the documents they were asked for by reading the authoritative sent order off Render Route output 0 and cross checking it three ways; any mismatch refuses the whole batch rather than guessing, because a cover letter attached to another company job is a letter that has already been sent. The binary is carried through untouched, because seat 7 uploads bytes.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: renderJsCode(),
  },
};

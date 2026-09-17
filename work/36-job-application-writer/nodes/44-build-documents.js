'use strict';
/*
 * 44-build-documents.js - "Build Documents". The first node of the render half.
 *
 * It turns a graded, ready to ship pair into the TWO files that make up one job folder, and it
 * emits TWO items per pair, one per document, which are the only things that get rendered.
 *
 *     Shaheen_Kiarash_CV.pdf            rendered from cv_html, built here
 *     Shaheen_Kiarash_Cover_Letter.pdf  rendered from letter_html, built here
 *
 * IT USED TO BUILD FOUR. README.md and job-ad.md were removed on 2026-09-17 on Shaheen's
 * instruction: printing the CV and the cover letter should not produce any md file. Notes 3 and 4
 * below are the record of what they were for, kept because the reasoning is the thing that gets
 * lost, and because the next person to want an audit trail in the folder should read the argument
 * that already happened rather than reinventing it.
 *
 * =============================================================================================
 * 1. THE FILENAMES ARE READ OFF THE PAIR. THIS FILE DOES NOT KNOW THE LAW AND MUST NOT LEARN IT.
 * =============================================================================================
 * Shaheen, 2026-08-20: a CV or cover letter filename carries his name and nothing else, because the
 * filename travels WITH the attachment and a per company name tells a recruiter, on a forward,
 * exactly who else he applied to. That law is enforced as CODE in scripts/outputs-ledger.js, node
 * 34 validated the two names against that regex at build time and stamped them on the pair as
 * `_filenames`, and A17 asserted them at run time.
 *
 * So this node READS `pair._filenames` and refuses a pair that does not carry it. A third copy of
 * the law here would be a third thing to keep in step with a rule that changed once already.
 *
 * THE PDF TITLE IS DERIVED FROM THE SAME PLACE, AND THAT IS NOT DECORATION. Chromium writes the
 * HTML `<title>` into the PDF as its /Title metadata, which is what a recruiter sees in the window
 * title and in a file manager preview. That is a second surface the filename travels on, and the
 * 2026-08-20 order never mentions it because nobody in this system was generating PDFs out of HTML
 * then. Deriving the title from `_filenames` rather than writing one makes it obey the same law by
 * construction: Shaheen_Kiarash_CV.pdf becomes the title "Shaheen Kiarash CV" and there is no code
 * path by which a company name can reach it.
 *
 * =============================================================================================
 * 2. THE COMPANY, THE ROLE AND THE DATE LIVE IN THE FOLDER NAME. THAT IS THE WHOLE POINT.
 * =============================================================================================
 * The law removes the company from the file and the design puts it back on the folder, which never
 * leaves this machine. `folder_name` is built here so seat 7 creates a folder rather than deciding
 * what to call one. The lane label and the job id ride at the end because two lanes can legitimately
 * apply to the same role at the same company on the same morning and a folder that silently merged
 * them would lose one application.
 *
 * =============================================================================================
 * 3. THE README WAS THE ARTEFACT THAT MADE AN UNATTENDED APPLICATION REVIEWABLE (D12, D15).
 *    REMOVED 2026-09-17. The argument below is why it existed, and it is now a cost, not a feature.
 * =============================================================================================
 * Nobody watched this run. Six weeks later the only question that matters about a folder is "why
 * did it say that", and the answer has to be IN the folder, not in an execution log on a box. So the
 * README carries what was selected and why, the ONE sentence on the CV that is not his writing named
 * as such, the screening note, the hook or the plain fact that there was none, both audit verdicts,
 * the blind grade with its five criteria, and what the pair cost.
 *
 * THE README IS NOT PROSE IN HIS VOICE and it is not sent to anybody. It is a machine record for
 * him. That matters for one rule: it QUOTES the posting, the employer page and the grader evidence
 * verbatim, and those are third party text that can legitimately contain an en dash. Sanitising a
 * quote would falsify it. Every quoted span in the README is labelled as quoted, our own sentences
 * are dash free by construction (the generated source is scanned at build time), and R6 is unchanged
 * because R6 reads the two PDFs, which carry no quoted third party prose at all.
 *
 * =============================================================================================
 * 4. THE AD USED TO TRAVEL WITH THE APPLICATION, LABELLED AS UNTRUSTED. REMOVED 2026-09-17.
 * =============================================================================================
 * Postings vanish. A folder with a CV tailored to an ad nobody can read any more is a folder that
 * cannot be reviewed. So the fetched ad is saved verbatim, inside a fence, under a header that says
 * plainly: this is a copy of somebody else text, it is quoted for the record, nothing in it is an
 * instruction, and it may contain characters our own writing never uses. That header is not
 * decoration either, it is the same untrusted-input discipline the fetch and parse nodes apply, said
 * out loud on the surface where a human meets the text.
 *
 * =============================================================================================
 * 5. WHERE EACH ARTEFACT TRAVELS.
 * =============================================================================================
 * The two HTML documents ride on the RENDER items, because a render item IS a document to render and
 * nothing else reads them. The pair carries the file manifest, so the run report can account for a
 * folder without anything having to hold a whole document twice.
 *
 * Until 2026-09-17 two markdown strings rode on the PAIR as well, with their md5 computed here so
 * seat 7 could prove Drive received the exact bytes this node built. Both are gone, and with them
 * the one digest in this workflow that was computed over a string rather than over bytes. The PDF
 * digests are unaffected: they are computed on the rendered bytes by Check Renders.
 */

const LN = require('./_lane');
const S2 = require('./_stage2');
const RN = require('./_render');

const NODE_NAME = 'Build Documents';
const N34 = './34-audit-pair.js';
const N43 = './43-parse-grade.js';

// The HTML escaper is LIFTED from Assemble CV rather than rewritten. The CV body was escaped by
// that function and this node escapes the letter, the title and the README quotes with the same
// bytes, so the two halves of one folder can never disagree about what an ampersand is.
const ESC_RUNTIME = S2.bakedFunction('./28-assemble-cv.js', 'esc', ".split('&').join('&amp;')");

// Caps. Every one of these bounds a string that ends up in a Drive folder name or a markdown file,
// and a cap stated here is a cap somebody can find.
const FOLDER_NAME_MAX = 150;      // Drive allows 255 BYTES; a Swedish company name is not one byte per character
const FOLDER_PART_MAX = 60;

const MODELS = LN.STAGE_MODELS;
const CSS_CV = RN.CSS_CV;
const CSS_LETTER = RN.CSS_LETTER;

// Called AFTER the LOGIC template below, because its last step renders the generated source and
// that reads LOGIC. Same shape as node 34, and for the same reason.
function assertAgainstUpstream() {
  const grade = require(N43);
  const audit = require(N34);
  if (grade.name !== 'Parse Grade') {
    throw new Error('Build Documents: node 43 is named ' + JSON.stringify(grade.name) + ' and this node connects from "Parse Grade". Rename both in the same edit.');
  }
  const gc = String(grade.parameters.jsCode || '');
  if (gc.indexOf('pair._ready_to_ship = true;') === -1) {
    throw new Error(
      'Build Documents: Parse Grade no longer stamps _ready_to_ship.\n' +
      '  That flag is the ONLY thing separating a pair that passed the blind grade from one that was\n' +
      '  held on D16, and this node reads it to decide what gets rendered. Without it every held pair\n' +
      '  would be built into documents and uploaded, which is the exact outcome D16 forbids.'
    );
  }
  const ac = String(audit.parameters.jsCode || '');
  if (ac.indexOf('j._filenames = {') === -1) {
    throw new Error(
      'Build Documents: Audit Pair no longer stamps _filenames on the pair.\n' +
      '  This node reads the two shipping names off the pair rather than carrying a third copy of the\n' +
      '  2026-08-20 filename law. If that stamp moved, move this reader in the same edit. Do NOT write\n' +
      '  the two names into this file to make it pass.'
    );
  }

  // The stylesheets, under the render safety law, re-checked here rather than trusted. _render.js
  // already ran this over both at load time; running it again on the exact strings that are BAKED
  // is the difference between checking the source and checking what ships.
  RN.assertPageCssIsSafe(CSS_CV, 'the baked CV stylesheet');
  RN.assertPageCssIsSafe(CSS_LETTER, 'the baked letter stylesheet');

  if (typeof RN.MD5_RUNTIME !== 'string' || RN.MD5_RUNTIME.indexOf('function md5Utf8') === -1) {
    throw new Error('Build Documents: the baked MD5 runtime does not declare md5Utf8(), which is what stamps html_md5 on each render item so a render can be tied back to the exact HTML it came from. It also hashed the two markdown files until 2026-09-17, when they were removed.');
  }

  const generated = renderJsCode();
  RN.assertGeneratedSourceIsClean(generated, NODE_NAME);
  if (generated.indexOf(String.fromCharCode(96)) !== -1) {
    throw new Error('Build Documents: the generated source contains a backtick outside a fromCharCode call, which means a template literal was closed early somewhere in the build half.');
  }
}

const LOGIC = `
// ---------------------------------------------------------------------------
// Build Documents. Four files per shipped pair, two render items per shipped pair.
// ---------------------------------------------------------------------------
const NL = String.fromCharCode(10);
const TICK = String.fromCharCode(96);
const DQ = String.fromCharCode(34);

${ESC_RUNTIME}
${RN.MD5_RUNTIME}

function clip(s, max) {
  const t = String(s === undefined || s === null ? '' : s).replace(/\\s+/g, ' ').trim();
  return t.length <= max ? t : t.slice(0, max - 1) + '...';
}
function present(v) { return v !== undefined && v !== null && String(v).trim() !== ''; }
// A table cell that never comes out blank. An empty cell in a cost table reads as a zero, and a
// stage that was not priced is not a stage that was free. Say which one it is.

// ---------------------------------------------------------------------------
// THE FOLDER NAME. The company, the role and the date the filename law removed from the file.
// Drive is not a filesystem but it renders in one, so the characters a filesystem cannot take are
// replaced rather than dropped: a dropped slash silently joins two words.
// ---------------------------------------------------------------------------
function folderPart(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/[\\\\/:*?"<>|\\u0000-\\u001f]/g, ' ')
    .replace(/\\s+/g, ' ')
    .trim()
    .slice(0, FOLDER_PART_MAX)
    .trim();
}
function folderNameFor(p) {
  const b = p.brief || {};
  const date = folderPart(p.run_date) || 'undated';
  const company = folderPart(b.employer || p.company) || 'unknown company';
  const role = folderPart(b.role_title || p.title) || 'unknown role';
  const tag = folderPart((p.label || p.lane_key || '') + ' ' + (p.job_id || ''));
  let name = date + ' ' + company + ' ' + role;
  if (tag) name = name + ' (' + tag + ')';
  name = name.replace(/\\s+/g, ' ').trim();
  if (name.length > FOLDER_NAME_MAX) name = name.slice(0, FOLDER_NAME_MAX).trim();
  return { name: name, parts: { date: date, company: company, role: role, tag: tag } };
}

// ---------------------------------------------------------------------------
// THE HTML DOCUMENT. One wrapper, two stylesheets, and the title derived from the shipping
// filename so the PDF metadata obeys the same law the filename does.
// ---------------------------------------------------------------------------
function titleFromFilename(filename) {
  return String(filename).replace(/\\.pdf$/i, '').split('_').join(' ').replace(/\\s+/g, ' ').trim();
}
function htmlDocument(css, title, bodyHtml) {
  return [
    '<!doctype html>',
    '<html lang=' + DQ + 'en' + DQ + '>',
    '<head>',
    '<meta charset=' + DQ + 'utf-8' + DQ + '>',
    '<meta name=' + DQ + 'viewport' + DQ + ' content=' + DQ + 'width=device-width' + DQ + '>',
    '<title>' + esc(title) + '</title>',
    '<style>',
    css,
    '</style>',
    '</head>',
    '<body>',
    '<div class=' + DQ + 'page' + DQ + '>',
    bodyHtml,
    '</div>',
    '</body>',
    '</html>',
    '',
  ].join(NL);
}

// The letter is plain text and becomes plain paragraphs. A blank line starts a new paragraph; a
// single newline inside one becomes a line break, because the writer uses one to put the signature
// under the last sentence and a paragraph joiner would run them together.
function letterBodyHtml(letterText) {
  const paras = String(letterText).split(/\\n\\s*\\n/).map((x) => x.trim()).filter((x) => x.length > 0);
  return paras.map((x) => '<p>' + esc(x).split(NL).join('<br>') + '</p>').join(NL);
}

// ---------------------------------------------------------------------------
// THE TWO MARKDOWN BUILDERS WERE HERE, AND THEY ARE GONE (2026-09-17).
//
// fenceFor() measured a safe fence for an ad containing backticks, jobAdMarkdown() saved the fetched
// posting verbatim inside it under an untrusted-input header, and readmeMarkdown() built the audit
// record: the selected blocks and why, the one bridge sentence that is not his own writing, the
// screening objections and what answered them, the employer hook or the plain fact that there was
// none, both audit verdicts, the blind grade with its five criteria, and what the pair cost.
//
// Roughly 280 lines of prose assembly, all of it for two files Shaheen does not want in the folder.
// Recover them from git rather than rebuilding them from memory if an audit trail is ever wanted
// again: the reasoning that shaped them is in notes 3 and 4 of this header.
// ---------------------------------------------------------------------------

// --- the run ---------------------------------------------------------------------
const items = $input.all().map((i) => i.json);
if (!items.length) {
  throw new Error('Build Documents: Parse Grade delivered no items at all. It emits at least its own stage report on every path, so an empty input means that node did not run.');
}

const out = [];
const renders = [];
const stats = { pairs: 0, built: 0, skipped: 0, held_contract: 0, renders_queued: 0 };
const skipReasons = {};
const warnings = [];
const folders = [];

function hold(j, why) {
  j._status = 'needs_review';
  j._status_class = 'hold';
  j._sheet_action = 'write_status';
  j._status_why = why;
  j._call_now = false;
  stats.held_contract += 1;
}

for (const raw of items) {
  const j = Object.assign({}, raw);

  if (j._kind !== 'pair') {
    j._call_now = false;
    out.push(j);
    continue;
  }
  stats.pairs += 1;
  if (j._status) {
    j._call_now = false;
    stats.skipped += 1;
    skipReasons[j._status] = (skipReasons[j._status] || 0) + 1;
    out.push(j);
    continue;
  }
  if (j._ready_to_ship !== true) {
    hold(j, 'the pair reached the render half with no status and no _ready_to_ship flag. Parse Grade stamps that flag on exactly the pairs that passed the blind grade, so a pair here without it went round a path nobody built. Nothing is rendered and nothing is uploaded for it.');
    out.push(j);
    continue;
  }

  // The two shipping names, read off the pair. See header note 1.
  const fn = j._filenames || null;
  const cvName = fn && typeof fn.cv === 'string' ? fn.cv.trim() : '';
  const letterName = fn && typeof fn.letter === 'string' ? fn.letter.trim() : '';
  if (!cvName || !letterName) {
    hold(j, 'the pair carries no usable _filenames (' + JSON.stringify(fn) + '). Audit Pair stamps the two shipping names after validating them against the filename law in scripts/outputs-ledger.js, and this node reads them rather than holding a third copy of that law. Refusing rather than inventing a pair of names.');
    out.push(j);
    continue;
  }
  if (!present(j.cv_html_body) || !present(j.cv_text)) {
    hold(j, 'the pair has no assembled CV body, so there is nothing to render. Assemble CV emits cv_text and cv_html_body together, so a pair with a grade and no CV did not come through it.');
    out.push(j);
    continue;
  }
  if (!present(j.letter_text)) {
    hold(j, 'the pair has no letter_text, so there is nothing to render. Parse Letter stamps it from the raw extraction and every downstream check reads it, so a graded pair without one is a contract break upstream.');
    out.push(j);
    continue;
  }

  const folder = folderNameFor(j);
  const cvHtml = htmlDocument(CSS_CV, titleFromFilename(cvName), String(j.cv_html_body));
  const letterHtml = htmlDocument(CSS_LETTER, titleFromFilename(letterName), letterBodyHtml(j.letter_text));

  const pairId = String(j.lane_key || 'lane') + ':' + String(j.job_id || 'job');

  j.pair_id = pairId;
  j.folder_name = folder.name;
  j.folder_parts = folder.parts;
  j._documents = {
    folder_name: folder.name,
    files: [
      { name: cvName, kind: 'cv', from: 'render', md5: null },
      { name: letterName, kind: 'letter', from: 'render', md5: null },
    ],
    cv_html_chars: cvHtml.length,
    letter_html_chars: letterHtml.length,
    page_min_height_mm: PAGE_MIN_HEIGHT_MM,
    manifest_note: 'TWO files per folder since 2026-09-17, both PDFs. README.md and job-ad.md were built here until then and Shaheen removed them: printing the CV and the letter should not produce any md file. Their md5 was computed here over a string; the PDF digests are computed by Check Renders over the rendered bytes, which is unchanged.',
    rule: 'the two PDF names came off the pair, where Audit Pair put them after checking them against the filename law. The company, the role and the date are in the FOLDER name, which never leaves this machine.',
  };
  j._call_now = false;
  stats.built += 1;
  folders.push({ pair_id: pairId, folder: folder.name });
  out.push(j);

  const common = {
    _kind: 'render',
    _call_now: true,
    pair_id: pairId,
    lane_key: j.lane_key,
    master_key: j.master_key,
    job_id: j.job_id,
    company: (j.brief && j.brief.employer) || j.company || null,
    folder_name: folder.name,
  };
  renders.push(Object.assign({}, common, {
    doc: 'cv',
    render_key: pairId + '|cv',
    filename: cvName,
    html: cvHtml,
    html_chars: cvHtml.length,
    html_md5: md5Utf8(cvHtml),
    source_chars: String(j.cv_text).length,
  }));
  renders.push(Object.assign({}, common, {
    doc: 'letter',
    render_key: pairId + '|letter',
    filename: letterName,
    html: letterHtml,
    html_chars: letterHtml.length,
    html_md5: md5Utf8(letterHtml),
    source_chars: String(j.letter_text).length,
  }));
  stats.renders_queued += 2;
}

if (stats.held_contract > 0) {
  warnings.push(stats.held_contract + ' pair(s) reached the render half missing a field the stages before it always stamp. That is a contract break upstream rather than a bad application, and nothing was rendered or uploaded for them.');
}
if (stats.built > 0 && stats.renders_queued !== stats.built * 2) {
  warnings.push('THE RENDER QUEUE DOES NOT MATCH THE PAIR COUNT: ' + stats.built + ' pair(s) built and ' + stats.renders_queued + ' render item(s) queued. Two per pair is the contract every node after this one pairs on.');
}

const report = {
  _kind: 'stage_report',
  stage: 'build_documents',
  counts: stats,
  skipped_by_status: skipReasons,
  folders: folders,
  files_per_folder: ['the CV pdf', 'the cover letter pdf'],
  page_min_height_mm: PAGE_MIN_HEIGHT_MM,
  render_safety: 'min-height with overflow visible, never height with overflow hidden. A clipped page still counts as one page and its lost text still extracts, so nothing downstream could see the loss. An over long CV grows a second page and is refused instead.',
  filename_rule: 'the two PDF names are read off the pair, where Audit Pair stamped them after validating them against the regex in scripts/outputs-ledger.js. The PDF /Title metadata is derived from the same two names, because that string travels with the file exactly as the filename does.',
  warnings: warnings,
  _call_now: false,
  site_fetch_url: '',
  ad_fetch_url: '',
};

return out.concat(renders).concat([report]).map((j) => ({ json: j, pairedItem: { item: 0 } }));
`;

function renderJsCode() {
  return [
    '// GENERATED at build time from work/36-job-application-writer/nodes/44-build-documents.js.',
    '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
    'const CSS_CV = ' + JSON.stringify(CSS_CV) + ';',
    'const CSS_LETTER = ' + JSON.stringify(CSS_LETTER) + ';',
    'const PAGE_MIN_HEIGHT_MM = ' + JSON.stringify(RN.PAGE_MIN_HEIGHT_MM) + ';',
    'const FOLDER_NAME_MAX = ' + JSON.stringify(FOLDER_NAME_MAX) + ';',
    'const FOLDER_PART_MAX = ' + JSON.stringify(FOLDER_PART_MAX) + ';',
    'const MODELS = ' + JSON.stringify(MODELS) + ';',
    LOGIC,
  ].join('\n');
}

assertAgainstUpstream();

module.exports = {
  name: NODE_NAME,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [10920, 100],
  connectFrom: 'Parse Grade',
  notes: 'Turns a graded, ready to ship pair into the four files of one job folder and emits TWO render items per pair, one per document. The two PDF names are READ off the pair, where Audit Pair stamped them after validating them against the filename law, and the PDF title metadata is derived from those same names because that string travels with the file too. The company, the role and the date live in the folder name, which never leaves this machine. The README is the artefact that makes an unattended application reviewable afterwards: what was selected and why, the one bridging sentence that is not his writing, the screening note, the hook or the plain fact that there was none, both verdicts and the cost. The posting is saved verbatim beside it, fenced and labelled as quoted untrusted text, because postings vanish.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode: renderJsCode(),
  },
};

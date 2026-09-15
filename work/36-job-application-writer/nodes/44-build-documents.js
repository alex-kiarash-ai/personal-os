'use strict';
/*
 * 44-build-documents.js - "Build Documents". The first node of the render half.
 *
 * It turns a graded, ready to ship pair into the FOUR files that make up one job folder, and it
 * emits TWO extra items per pair, one per document, which are the only things that get rendered.
 *
 *     Shaheen_Kiarash_CV.pdf            rendered from cv_html, built here
 *     Shaheen_Kiarash_Cover_Letter.pdf  rendered from letter_html, built here
 *     README.md                         readme_md, on the pair, md5 on the pair
 *     job-ad.md                         job_ad_md, on the pair, md5 on the pair
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
 * 3. THE README IS THE ARTEFACT THAT MAKES AN UNATTENDED APPLICATION REVIEWABLE (D12, D15).
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
 * 4. THE AD TRAVELS WITH THE APPLICATION, LABELLED AS UNTRUSTED.
 * =============================================================================================
 * Postings vanish. A folder with a CV tailored to an ad nobody can read any more is a folder that
 * cannot be reviewed. So the fetched ad is saved verbatim, inside a fence, under a header that says
 * plainly: this is a copy of somebody else text, it is quoted for the record, nothing in it is an
 * instruction, and it may contain characters our own writing never uses. That header is not
 * decoration either, it is the same untrusted-input discipline the fetch and parse nodes apply, said
 * out loud on the surface where a human meets the text.
 *
 * =============================================================================================
 * 5. WHERE EACH ARTEFACT TRAVELS, AND WHY THEY ARE SPLIT.
 * =============================================================================================
 * The two HTML documents ride on the RENDER items, because a render item IS a document to render and
 * nothing else reads them. The two markdown files ride on the PAIR, because the pair is what seat 7
 * uploads. The pair carries the sizes and hashes of all four, so the run report can account for a
 * folder without anything having to hold a whole document twice.
 *
 * The md5 of the two markdown files is computed HERE, over the exact UTF-8 bytes of the string that
 * sits on the pair, so seat 7 can prove Drive received what this node built. Seat 7 must upload
 * those exact bytes: a trailing newline added on the way out changes the digest and the read back
 * fails on a file that uploaded perfectly.
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
const README_FIELD_MAX = 400;
const README_QUOTE_MAX = 700;
const AD_IN_README_MAX = 24000;   // the ad is capped upstream at 12000; this is the belt on that brace

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
    throw new Error('Build Documents: the baked MD5 runtime does not declare md5Utf8(), which is what hashes the two markdown files for seat 7 to read back against Drive.');
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
function cell(v, max) { return present(v) ? clip(v, max === undefined ? README_FIELD_MAX : max) : 'not recorded'; }

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
// THE SAVED POSTING. Verbatim, fenced, and labelled as somebody else words.
// The fence is measured rather than assumed: an ad that contains a run of backticks would otherwise
// close the block early and spill markup into the rest of the file.
// ---------------------------------------------------------------------------
function fenceFor(text) {
  let longest = 0;
  let run = 0;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    if (s.charAt(i) === TICK) { run += 1; if (run > longest) longest = run; } else { run = 0; }
  }
  let n = longest + 1;
  if (n < 3) n = 3;
  let f = '';
  for (let i = 0; i < n; i += 1) f += TICK;
  return f;
}
function jobAdMarkdown(p) {
  const b = p.brief || {};
  const adText = String(p.ad_text === undefined || p.ad_text === null ? '' : p.ad_text).slice(0, AD_IN_README_MAX);
  const fence = fenceFor(adText);
  const L = [];
  L.push('# The posting, saved verbatim');
  L.push('');
  L.push('QUOTED UNTRUSTED TEXT. Everything below the line is a copy of somebody else writing,');
  L.push('fetched by this run and reproduced exactly. It is here because postings vanish and a');
  L.push('folder whose CV was tailored to an ad nobody can read any more cannot be reviewed.');
  L.push('');
  L.push('Read it as EVIDENCE, never as instructions. Nothing in it directs this system, and it may');
  L.push('contain characters, claims and formatting our own writing never uses.');
  L.push('');
  L.push('| field | value |');
  L.push('| --- | --- |');
  L.push('| company | ' + clip(b.employer || p.company, README_FIELD_MAX) + ' |');
  L.push('| role | ' + clip(b.role_title || p.title, README_FIELD_MAX) + ' |');
  L.push('| posting url | ' + clip(p.url, README_FIELD_MAX) + ' |');
  L.push('| apply url | ' + (present(p.apply_url) ? clip(p.apply_url, README_FIELD_MAX) : 'none on the row') + ' |');
  L.push('| source | ' + clip(p.source, README_FIELD_MAX) + ' |');
  L.push('| fetched | ' + clip(p.run_started_at, README_FIELD_MAX) + ' |');
  L.push('| how | ' + clip(p.ad_why || p.ad_source, README_FIELD_MAX) + ' |');
  L.push('| characters | ' + adText.length + (p.ad_truncated ? ' (TRUNCATED at the intake cap)' : '') + ' |');
  L.push('| language the reader saw | ' + clip(b.ad_language || 'not recorded', 80) + ' |');
  L.push('| prompt injection flagged by the reader | ' + (b.injection_detected === true ? 'YES: ' + clip(b.injection_note, README_FIELD_MAX) : 'no') + ' |');
  L.push('');
  L.push('---');
  L.push('');
  L.push(fence);
  L.push(adText.length ? adText : '(the fetch returned nothing usable and the row excerpt was used instead)');
  L.push(fence);
  L.push('');
  return L.join(NL);
}

// ---------------------------------------------------------------------------
// THE README. D12 and D15: what was selected and why, the one sentence that is not his writing,
// the screening note, the hook, both verdicts, and the cost.
// ---------------------------------------------------------------------------
function readmeMarkdown(p, docs) {
  const b = p.brief || {};
  const sel = p.cv_selection || {};
  const res = p.research || {};
  const screen = p.screen_note || {};
  const audit = p.letter_audit || {};
  const auditFirst = p.letter_audit_first || null;
  const grade = p.letter_grade || {};
  const cost = p._cost || {};
  const L = [];

  L.push('# ' + clip(b.employer || p.company, 120) + ', ' + clip(b.role_title || p.title, 120));
  L.push('');
  L.push('Written and rendered unattended by the Job Application Writer. Nobody read this before it');
  L.push('was produced, so this file is the record of why it says what it says.');
  L.push('');

  L.push('## The job');
  L.push('');
  L.push('| field | value |');
  L.push('| --- | --- |');
  L.push('| company | ' + clip(b.employer || p.company, README_FIELD_MAX) + ' |');
  L.push('| role | ' + clip(b.role_title || p.title, README_FIELD_MAX) + ' |');
  L.push('| posting | ' + clip(p.url, README_FIELD_MAX) + ' |');
  L.push('| apply here | ' + (present(p.apply_url) ? clip(p.apply_url, README_FIELD_MAX) : clip(p.url, README_FIELD_MAX)) + ' |');
  L.push('| location on the row | ' + clip(p.location, README_FIELD_MAX) + ' |');
  L.push('| work type the reader found | ' + (present(b.work_type) ? clip(b.work_type, 60) : 'not stated in the posting') + ' |');
  L.push('| scope it was admitted under | ' + clip((p._scope || {}).scope, 80) + ' (' + clip((p._scope || {}).scope_source, 80) + ') |');
  L.push('| collector score | ' + clip(p.fit_score, 40) + ' |');
  L.push('| lane | ' + clip(p.label || p.lane_key, 80) + ', CV master ' + clip(p.master_key, 40) + ' |');
  L.push('| job id | ' + clip(p.job_id, 80) + ' |');
  L.push('| run | ' + clip(p.run_date, 40) + ', execution ' + clip(p.exec_id, 40) + ' |');
  L.push('');

  L.push('## What is in this folder');
  L.push('');
  L.push('| file | what it is | bytes | md5 |');
  L.push('| --- | --- | --- | --- |');
  L.push('| ' + docs.cv_filename + ' | the CV, one page, rendered from the frozen master by block id | see the run report | see the run report |');
  L.push('| ' + docs.letter_filename + ' | the cover letter, written for this posting and graded blind | see the run report | see the run report |');
  L.push('| ' + docs.readme_filename + ' | this file | | |');
  L.push('| ' + docs.job_ad_filename + ' | the posting, saved verbatim, quoted untrusted text | | ' + docs.job_ad_md5 + ' |');
  L.push('');
  L.push('The two PDF byte counts and hashes are measured after the render and live in the run row,');
  L.push('because this file is written before the PDFs exist.');
  L.push('');

  L.push('## The CV: what was selected, and why');
  L.push('');
  L.push('Every sentence on the CV came out of the frozen master by content hashed block id. The');
  L.push('selector chose ids; the assembler emitted the master strings those ids resolve to. There is');
  L.push('no code path by which a rewritten sentence can be on that page.');
  L.push('');
  L.push('| field | value |');
  L.push('| --- | --- |');
  L.push('| master | ' + clip(sel.master_key, 40) + ', sha256 ' + clip(String(sel.master_sha256 || '').slice(0, 16), 40) + ' |');
  L.push('| blocks the selector asked for | ' + ((sel.requested_ids || []).length) + ' |');
  L.push('| blocks that shipped | ' + ((sel.emitted_ids || []).length) + ' |');
  L.push('| forced because they are mandatory | ' + ((sel.mandatory_forced || []).length) + ' |');
  L.push('| dropped to fit one page | ' + ((sel.dropped || []).length) + ' |');
  L.push('| page fill | ' + clip(sel.para_chars, 20) + ' of ' + clip(sel.ceiling_chars, 20) + ' characters, ' + clip(sel.headroom_chars, 20) + ' spare |');
  L.push('');
  if (present(sel.why)) {
    L.push('The selector reason, in its own words:');
    L.push('');
    L.push('> ' + clip(sel.why, README_QUOTE_MAX));
    L.push('');
  }
  if ((sel.dropped || []).length) {
    L.push('Dropped to fit the page, in the order the selector said to drop them:');
    L.push('');
    for (const d of (sel.dropped || []).slice(0, 20)) {
      L.push('- ' + clip(d.id, 80) + ' (recovered ' + clip(d.recovered_chars, 20) + ' characters)');
    }
    L.push('');
  }
  const coverage = Array.isArray(sel.objection_coverage) ? sel.objection_coverage : [];
  if (coverage.length) {
    L.push('How the selector says the CV answers the screening objections:');
    L.push('');
    for (const c of coverage.slice(0, 12)) {
      L.push('- ' + clip(c.objection, 240) + ' -> ' + clip(c.state, 60) + (present(c.block_id) ? ' via ' + clip(c.block_id, 80) : '') + (present(c.note) ? '. ' + clip(c.note, 240) : ''));
    }
    L.push('');
  }

  L.push('## The one sentence on the CV that is not his writing');
  L.push('');
  if (present(sel.bridge_line)) {
    L.push('The CV carries ONE bridging line that the master does not contain. It was generated for');
    L.push('this application, it was checked against the shared voice rules before it was allowed on');
    L.push('the page, and it is the only sentence on the CV he has not personally written:');
    L.push('');
    L.push('> ' + clip(sel.bridge_line, README_QUOTE_MAX));
    L.push('');
    L.push('State: ' + clip(sel.bridge_state, 60) + '. ' + clip(sel.bridge_why, README_QUOTE_MAX));
  } else {
    L.push('None. The CV is master text end to end for this application. State: ' + clip(sel.bridge_state, 60) + '.');
    if (present(sel.bridge_why)) { L.push(''); L.push(clip(sel.bridge_why, README_QUOTE_MAX)); }
  }
  L.push('');

  L.push('## The hook');
  L.push('');
  if (res.hook && present(res.hook.quote)) {
    L.push('One sentence from the employer own page, quoted back to them. It was proved to be a real');
    L.push('substring of a page this run actually fetched, never recalled and never invented.');
    L.push('');
    L.push('> ' + clip(res.hook.quote, README_QUOTE_MAX));
    L.push('');
    L.push('| field | value |');
    L.push('| --- | --- |');
    L.push('| from | ' + clip(res.hook.url || res.site_url, README_FIELD_MAX) + ' |');
    L.push('| why the research call picked it | ' + clip(res.hook.why, README_FIELD_MAX) + ' |');
    L.push('| page kind | ' + clip(res.page_kind, 80) + ' |');
  } else {
    L.push('THERE WAS NO HOOK, and that is a real outcome rather than a missing step. D6 says a letter');
    L.push('with no hook is correct and a letter with an invented one is not.');
    L.push('');
    L.push('Why: ' + clip(res.why || res.hook_why_dropped || 'no employer page could be read this run', README_QUOTE_MAX));
    L.push('');
    L.push('Research state: ' + clip(res.state, 80) + '.');
  }
  L.push('');

  L.push('## What a screener would object to, and where the letter answers it');
  L.push('');
  const objections = Array.isArray(b.objections) ? b.objections : [];
  const lines = Array.isArray(screen.lines) ? screen.lines : [];
  if (!objections.length) {
    L.push('The recruiter seat returned no objections for this posting.');
  } else {
    L.push('A senior recruiter seat read the posting against his CV and named the reasons it would be');
    L.push('screened out. The writer then had to answer each one with a sentence IN the letter, and the');
    L.push('audit checked that the named sentence really is in there, character for character.');
    L.push('');
    for (let i = 0; i < objections.length; i += 1) {
      const o = objections[i] || {};
      const named = lines.filter((x) => x && x.kind === 'objection' && Number(x.index) === (i + 1))[0] || null;
      L.push((i + 1) + '. **' + clip(o.objection, 300) + '**');
      if (present(o.evidence)) L.push('   Evidence in the posting: ' + clip(o.evidence, README_QUOTE_MAX));
      L.push('   Answered by: ' + (named ? clip(named.sentence, README_QUOTE_MAX) : 'NOTHING NAMED. The audit would have held this pair.'));
      L.push('');
    }
  }
  const gapLine = lines.filter((x) => x && x.kind === 'gap')[0] || null;
  L.push('The honest gap, in the letter, in his own words:');
  L.push('');
  L.push(gapLine ? '> ' + clip(gapLine.sentence, README_QUOTE_MAX) : '> none named, which the audit treats as a failure.');
  L.push('');
  L.push('The screening note never goes into the letter. It is the writer working, not the writer');
  L.push('writing, and it lives here so a person can check the answer rather than take it on trust.');
  L.push('');

  L.push('## The checks');
  L.push('');
  L.push('| check | verdict |');
  L.push('| --- | --- |');
  L.push('| deterministic audit A1 to A18 | ' + (audit.pass === true ? 'PASS' : 'see below') + ', ' + ((audit.checks || []).length) + ' checks, ' + clip(audit.words, 20) + ' words |');
  L.push('| rewrite | ' + (p._rewrite_attempted === true ? 'one reasoned rewrite, then re-audited' : 'not needed, the first draft passed') + ' |');
  L.push('| blind voice grade | ' + clip(grade.verdict, 40) + ' |');
  L.push('| voice rules | sha ' + clip(String(audit.voice_rules_sha || '').slice(0, 16), 40) + ', the same file the CLI and the live eval use |');
  L.push('| his voice block was in the writer node | ' + (p.voice_block_present === true ? 'yes' : 'NO, and the pair should have been held') + ' |');
  L.push('');
  if (auditFirst && Array.isArray(auditFirst.failed_letter) && auditFirst.failed_letter.length) {
    L.push('The first draft failed ' + auditFirst.failed_letter.join(', ') + ' and was rewritten once, on the same');
    L.push('request object, with those checks named. Nothing was repaired silently.');
    L.push('');
  }
  const criteria = (grade.criteria && typeof grade.criteria === 'object') ? grade.criteria : {};
  const critIds = Object.keys(criteria);
  if (critIds.length) {
    L.push('The blind grade. A separate call saw the letter and the rubric, and nothing else: not the');
    L.push('posting, not the CV, not the screening note, not the audit result, none of the reasoning.');
    L.push('');
    L.push('| criterion | verdict | evidence |');
    L.push('| --- | --- | --- |');
    for (const id of critIds) {
      const c = criteria[id] || {};
      L.push('| ' + clip(id, 20) + ' | ' + clip(c.verdict, 20) + ' | ' + clip(c.evidence, README_FIELD_MAX) + ' |');
    }
    L.push('');
    if (grade.contradiction === true) {
      L.push('Note: the grader own summary verdict said ' + clip(grade.claimed_verdict, 20) + ', which contradicts its own five');
      L.push('criteria. The verdict above is RECOMPUTED from the criteria, which is what decides.');
      L.push('');
    }
  }

  L.push('## What this cost');
  L.push('');
  L.push('| stage | model | in | out | cached read | usd |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  let unpriced = 0;
  for (const c of (Array.isArray(cost.calls) ? cost.calls : [])) {
    const u = c.usage || {};
    if (!present(c.usd)) unpriced += 1;
    L.push('| ' + cell(c.stage, 40) + ' | ' + cell(c.model, 40) + ' | ' + cell(u.input_tokens, 20) + ' | ' + cell(u.output_tokens, 20) + ' | ' + cell(u.cache_read_input_tokens, 20) + ' | ' + cell(c.usd, 20) + ' |');
  }
  L.push('');
  L.push('Pair total: ' + cell(cost.usd, 20) + ' USD.');
  if (unpriced) {
    L.push('');
    L.push(unpriced + ' stage(s) above say not recorded in the usd column. That means the stage did not price');
    L.push('its own call row, NOT that the call was free. The pair total is the authority and it already');
    L.push('includes them. A blank cell there would have read as a zero, which is why it says this instead.');
  }
  L.push('');

  L.push('## Provenance');
  L.push('');
  L.push('| stage | model |');
  L.push('| --- | --- |');
  for (const k of Object.keys(MODELS)) L.push('| ' + k + ' | ' + MODELS[k] + ' |');
  L.push('');
  L.push('The CV and the letter were rendered from HTML by Chromium, on the box, at ' + PAGE_MIN_HEIGHT_MM + 'mm of');
  L.push('page height with overflow VISIBLE. Nothing that did not fit was hidden: an over long CV grows');
  L.push('a second page and is refused, which is the point. Both PDFs were then read back and checked:');
  L.push('both rendered, the CV is exactly one page counted two independent ways, the letter is one');
  L.push('page, the text layer parses and carries his name, the terms an applicant tracking system');
  L.push('greps for survived the round trip, and no en dash or em dash is in either.');
  L.push('');
  return L.join(NL);
}

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

  const jobAd = jobAdMarkdown(j);
  const docs = {
    cv_filename: cvName,
    letter_filename: letterName,
    readme_filename: README_FILENAME,
    job_ad_filename: JOB_AD_FILENAME,
    job_ad_md5: md5Utf8(jobAd),
  };
  const readme = readmeMarkdown(j, docs);

  j.pair_id = pairId;
  j.folder_name = folder.name;
  j.folder_parts = folder.parts;
  j.readme_md = readme;
  j.job_ad_md = jobAd;
  j.readme_md5 = md5Utf8(readme);
  j.job_ad_md5 = docs.job_ad_md5;
  j._documents = {
    folder_name: folder.name,
    files: [
      { name: cvName, kind: 'cv', from: 'render', md5: null },
      { name: letterName, kind: 'letter', from: 'render', md5: null },
      { name: README_FILENAME, kind: 'readme', from: 'this node', md5: j.readme_md5, bytes: utf8Bytes(readme).length },
      { name: JOB_AD_FILENAME, kind: 'job_ad', from: 'this node', md5: j.job_ad_md5, bytes: utf8Bytes(jobAd).length },
    ],
    cv_html_chars: cvHtml.length,
    letter_html_chars: letterHtml.length,
    page_min_height_mm: PAGE_MIN_HEIGHT_MM,
    md5_note: 'the two markdown digests are over the exact UTF-8 bytes of readme_md and job_ad_md as they sit on this pair. Upload those bytes unchanged: a trailing newline added on the way out changes the digest and the Drive read back fails on a file that uploaded perfectly.',
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
  files_per_folder: ['the CV pdf', 'the cover letter pdf', README_FILENAME, JOB_AD_FILENAME],
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
    'const README_FILENAME = ' + JSON.stringify(RN.README_FILENAME) + ';',
    'const JOB_AD_FILENAME = ' + JSON.stringify(RN.JOB_AD_FILENAME) + ';',
    'const PAGE_MIN_HEIGHT_MM = ' + JSON.stringify(RN.PAGE_MIN_HEIGHT_MM) + ';',
    'const FOLDER_NAME_MAX = ' + JSON.stringify(FOLDER_NAME_MAX) + ';',
    'const FOLDER_PART_MAX = ' + JSON.stringify(FOLDER_PART_MAX) + ';',
    'const README_FIELD_MAX = ' + JSON.stringify(README_FIELD_MAX) + ';',
    'const README_QUOTE_MAX = ' + JSON.stringify(README_QUOTE_MAX) + ';',
    'const AD_IN_README_MAX = ' + JSON.stringify(AD_IN_README_MAX) + ';',
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

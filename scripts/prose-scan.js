#!/usr/bin/env node
'use strict';
/*
 * prose-scan.js - the zero-token prose gate. Reads a file (or stdin) and reports PASS or FAIL per
 * check with the offending text quoted.
 *
 *   node scripts/prose-scan.js outputs/.../letter.txt --profile letter
 *   cat letter.txt | node scripts/prose-scan.js --profile letter --json
 *   node scripts/prose-scan.js cv.txt --profile cv
 *   node scripts/prose-scan.js letter.txt --profile letter --numbers approved-numbers.json
 *
 * WHY IT EXISTS. #36 writes a cover letter under Shaheen's name and files it in Drive with no human
 * in the loop. Every voice rule this repo owns was, until now, enforced either by a model being
 * asked nicely or by a human reading the output. Neither is available at 06:45 on a Tuesday. This
 * is the deterministic half: it costs no tokens, it never has an opinion, and it quotes the exact
 * offending string so the rewrite turn has something to act on.
 *
 * WHERE THE RULES LIVE. Not here. scripts/lib/voice-rules.js is the one definition, shared with
 * work/36-job-application-writer/nodes/_master.js and baked into the lane's audit node at build
 * time. This file is a CLI over that engine and holds no rule of its own, so the CLI and the box
 * cannot disagree about what a tell is.
 *
 * EXIT CODES, because callers depend on them:
 *   0  every blocking check passed
 *   1  at least one blocking check FAILED
 *   2  usage error (no input, unknown flag, unreadable file)
 * ADVISORY findings are printed and NEVER change the exit code. That is the contract: advisory
 * means the grader still has to look, not that the run stops.
 *
 * No dash character appears in this file. The scanner's needles are built from escapes in
 * voice-rules.js, for the same reason: a guard written with the character it bans cannot ship.
 */

const fs = require('fs');
const path = require('path');
const VR = require(path.join(__dirname, 'lib', 'voice-rules.js'));

const USAGE = [
  'usage: node scripts/prose-scan.js [file] [options]',
  '',
  '  file                 path to scan. Omit (or pass -) to read stdin.',
  '',
  '  --profile <name>     letter | cv | text        (default: text)',
  '                         letter  dashes, tells, word band 100..280, pronouns, banned claims',
  '                         cv      dashes, tells, pronouns, banned claims (no word band: the CV',
  '                                 is governed by the one-page render check, not a word count)',
  '                         text    as cv, plus a band only if --min/--max are given',
  '  --min <n> --max <n>  override the word band for any profile',
  '  --numbers <file>     JSON array (or {"numbers":[...]}) of approved bare numbers. Turns on the',
  '                       A8 check: every number in the text must appear in that list.',
  '  --json               machine-readable output on stdout, nothing else',
  '  --quiet              print only the verdict line',
  '  --rules              print the reconciled rule tables and exit 0',
  '  -h, --help           this text',
].join('\n');

function die(msg) {
  process.stderr.write('prose-scan: ' + msg + '\n\n' + USAGE + '\n');
  process.exit(2);
}

function parseArgs(argv) {
  const o = { file: null, profile: 'text', min: null, max: null, json: false, quiet: false, numbers: null, rules: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { process.stdout.write(USAGE + '\n'); process.exit(0); }
    else if (a === '--json') o.json = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a === '--rules') o.rules = true;
    else if (a === '--profile') { o.profile = argv[++i]; if (!o.profile) die('--profile needs a value'); }
    else if (a === '--min') { o.min = Number(argv[++i]); if (!Number.isFinite(o.min)) die('--min needs a number'); }
    else if (a === '--max') { o.max = Number(argv[++i]); if (!Number.isFinite(o.max)) die('--max needs a number'); }
    else if (a === '--numbers') { o.numbers = argv[++i]; if (!o.numbers) die('--numbers needs a file path'); }
    else if (a === '-') o.file = null;
    else if (a.startsWith('--')) die('unknown flag ' + JSON.stringify(a));
    else if (o.file === null) o.file = a;
    else die('more than one input file: ' + JSON.stringify(a));
  }
  if (!Object.prototype.hasOwnProperty.call(VR.PROFILES, o.profile)) {
    die('unknown profile ' + JSON.stringify(o.profile) + '. Known: ' + Object.keys(VR.PROFILES).join(', '));
  }
  return o;
}

function readInput(file) {
  if (file) {
    if (!fs.existsSync(file)) die('no such file: ' + file);
    try { return fs.readFileSync(file, 'utf8'); }
    catch (e) { die('cannot read ' + file + ': ' + e.message); }
  }
  try { return fs.readFileSync(0, 'utf8'); }
  catch (e) { die('nothing on stdin and no file given'); }
  return '';
}

function readNumbers(file) {
  if (!fs.existsSync(file)) die('no such approved-numbers file: ' + file);
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { die('approved-numbers file is not JSON: ' + e.message); }
  const list = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.numbers) ? parsed.numbers : null);
  if (!list) die('approved-numbers file must be a JSON array, or an object with a "numbers" array');
  return list.map(String);
}

function printRules() {
  const out = [];
  out.push('RECONCILED TELLS (' + VR.TELLS.length + ')');
  out.push('  from the live Writer Voice Eval (grMqmGzzbTXTEdKr): ' + VR.TELLS_LIVE_EVAL.length);
  out.push('  from the grader rubric PV2:                        ' + VR.TELLS_RUBRIC_PV2.length + ' (a strict subset of the eval list)');
  out.push('  added here from soul.md rules 3 and 6:             ' + (VR.TELLS.length - VR.TELLS_LIVE_EVAL.length));
  out.push('  dropped:                                           0');
  out.push('');
  for (const t of VR.TELLS) {
    const src = VR.TELLS_RUBRIC_PV2.includes(t) ? 'rubric+eval' : (VR.TELLS_LIVE_EVAL.includes(t) ? 'eval only ' : 'soul.md    ');
    out.push('  [' + src + '] ' + t);
  }
  out.push('');
  out.push('BANNED CLAIMS');
  for (const c of VR.CLAIMS) out.push('  claim:' + c.id + '\n      ' + c.why);
  out.push('');
  out.push('ADVISORY (reported, never blocking)');
  for (const h of VR.STRUCTURAL_HINTS) out.push('  ' + h.id + '\n      ' + h.why);
  out.push('');
  out.push('STILL A JUDGEMENT CALL (no string scan can reach these)');
  for (const j of VR.STRUCTURAL_JUDGEMENT) out.push('  - ' + j);
  out.push('');
  out.push('RULES_SHA ' + VR.RULES_SHA);
  process.stdout.write(out.join('\n') + '\n');
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.rules) { printRules(); return 0; }

  const text = readInput(o.file);
  const approvedNumbers = o.numbers ? readNumbers(o.numbers) : undefined;
  const r = VR.scan(text, { profile: o.profile, min: o.min, max: o.max, approvedNumbers });

  const label = o.file ? o.file.replace(/\\/g, '/') : '<stdin>';

  if (o.json) {
    process.stdout.write(JSON.stringify({
      file: label,
      profile: r.profile,
      pass: r.pass,
      failed: r.failed,
      words: r.words,
      rules_sha: VR.RULES_SHA,
      checks: r.checks,
      advisory: r.advisory,
      judgement_still_required: r.judgement_still_required,
    }, null, 2) + '\n');
    return r.pass ? 0 : 1;
  }

  const out = [];
  if (!o.quiet) {
    out.push('prose-scan ' + label + '  [profile ' + r.profile + ', ' + r.words + ' words]');
    for (const c of r.checks) {
      out.push('  ' + c.status.padEnd(4) + '  ' + c.id.padEnd(24) + c.detail);
      for (const h of c.hits.slice(0, 6)) {
        out.push('          ' + JSON.stringify(h.what) + '  ->  ' + JSON.stringify(h.quote));
      }
      if (c.hits.length > 6) out.push('          ... and ' + (c.hits.length - 6) + ' more');
    }
    const noted = r.advisory.filter(a => a.status === 'NOTE');
    if (noted.length) {
      out.push('  ADVISORY (does not affect the verdict)');
      for (const a of noted) {
        out.push('    NOTE  ' + a.id.padEnd(24) + a.hits.length + ' hit(s): ' + a.hits.slice(0, 3).map(h => JSON.stringify(h.what)).join(', '));
      }
    }
  }
  out.push('VERDICT: ' + (r.pass ? 'PASS' : 'FAIL (' + r.failed.join(', ') + ')'));
  process.stdout.write(out.join('\n') + '\n');
  return r.pass ? 0 : 1;
}

process.exit(main());

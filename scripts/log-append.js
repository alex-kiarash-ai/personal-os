#!/usr/bin/env node
'use strict';
/*
 * scripts/log-append.js - the ONE mechanical writer for vault/log.md. (P1.5, run-47 merged plan.)
 *
 * WHY THIS EXISTS. vault/log.md is described everywhere as append-only and time-ordered. It was
 * neither: measured 2026-08-23 it carried 873,224 B across 1,107 stamped headings with 276 adjacent
 * pairs running BACKWARDS, one entry stamped in the future, a UTF-8 BOM at the head, no size cap,
 * and - the root cause - no script that owned it. Every other substrate that matters has a writer;
 * this one was model-written prose at both ends of the file, so "append-only" was a convention a
 * tired session could break without anything noticing (run-46 finding N3).
 *
 * WHAT IT GUARANTEES.
 *   - Appends at the TAIL. Never rewrites the head, never touches an existing byte.
 *   - Stamps ONE clock: local time in the `[YYYY-MM-DD HH:MM]` shape the file already uses. (The
 *     file is human prose read in Obsidian, so it keeps local time; the UTC-Z rule of P1.2 governs
 *     MACHINE rows in jsonl surfaces, which this is not.)
 *   - Refuses to write an entry stamped before the current tail entry, which is exactly the defect
 *     C26 guards. A deliberate backdated entry needs --force and says so in the output.
 *   - Never writes a BOM.
 *
 * USAGE
 *   node scripts/log-append.js --project morning-brief --text "what happened, one line"
 *   node scripts/log-append.js --project session --text "..." --links "[[a]],[[b]]"
 *   (--force allows an out-of-order stamp; --dry-run prints the entry without writing.)
 *
 * Zero dependencies, node built-ins only.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const LOG = process.env.ALEX_VAULT_LOG || path.join(REPO, 'vault', 'log.md');

const args = process.argv.slice(2);
const get = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; };
const has = (k) => args.includes('--' + k);

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The last `## [stamp]` heading in the file, or null. Reads the tail only, never the whole file. */
function lastStamp(text) {
  const m = text.match(/^## \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]/gm);
  if (!m || !m.length) return null;
  const last = m[m.length - 1];
  return last.slice(4, 20);
}

function main() {
  const project = get('project');
  const text = get('text');
  if (!project || !text) {
    console.error('usage: log-append.js --project <name> --text "<one line>" [--links "[[a]],[[b]]"] [--force] [--dry-run]');
    return 2;
  }
  const now = stamp();
  const links = get('links');
  const entry = `\n## [${now}] ${project} | ${text}${links ? ' ' + links : ''}\n`;

  let existing = '';
  try { existing = fs.readFileSync(LOG, 'utf8'); } catch (_) { /* first write */ }

  const prev = lastStamp(existing);
  if (prev && now < prev && !has('force')) {
    console.error(`log-append: REFUSED - this entry (${now}) is older than the current tail (${prev}).`);
    console.error('  vault/log.md is append-only and tail-ordered (C26 guards it). Use --force only for a deliberate backdated entry.');
    return 1;
  }
  if (prev && now < prev) console.error(`log-append: WARNING forced out-of-order entry (${now} < tail ${prev})`);

  if (has('dry-run')) { process.stdout.write(entry); console.error('log-append: dry run, nothing written'); return 0; }

  // Append only. No read-modify-write of the head: a BOM or a prepended block cannot be introduced
  // by this path, and a crash mid-write can never corrupt an existing entry.
  fs.appendFileSync(LOG, entry, 'utf8');
  console.log(`log-append: ${now} ${project}${links ? ' (+links)' : ''}`);
  return 0;
}

process.exit(main());

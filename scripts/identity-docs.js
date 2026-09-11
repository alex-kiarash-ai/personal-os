#!/usr/bin/env node
'use strict';
/*
 * identity-docs.js - the ONE writer for the two identity documents that live outside the repo.
 *
 * WHY (A17-T-07, A01-T-07, A02-T-06). Change Propagation items 7 and 8 require that any
 * system-changing session updates the plain-English guide (its home section plus a dated row in
 * the section-12 running-changes table) and the technical master (its numbered section plus a
 * dated section-11 line). Both instructions said "edit via python-docx", which means every session
 * writes its own ad-hoc script against a .docx, and:
 *
 *   - there was NO writer to take the shared write lock, so P-56's "third lock caller" had nothing
 *     to attach to and two sessions could save the same document over each other,
 *   - the running-changes row was appended by hand every time, so its shape drifted,
 *   - and a session that edited the guide while another had it open simply won.
 *
 * This is that writer. It takes `alex-surfaces` on the same cross-process mutex the generator and
 * the skills installer use, appends the row, and releases.
 *
 * IT DOES NOT WRITE THE PROSE. Both documents carry a voice (the guide plain-English, the master
 * verified-ground-truth) and the Brand + Soul Pre-Flight Gate applies to every write into either.
 * This tool takes text that a gated session has already composed and puts it in the right place
 * atomically. It refuses to invent a summary.
 *
 * Usage:
 *   node scripts/identity-docs.js add-row --doc guide  --date 2026-09-11 --text "What changed."
 *   node scripts/identity-docs.js add-row --doc master --date 2026-09-11 --text "What changed."
 *   node scripts/identity-docs.js status        # where both files are, mtimes, last row date
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  'Desktop', '01 Projects', 'Alex', 'Story & Guides'
);
const GUIDE = path.join(DOCS_DIR, 'Alex-Plain-English-Guide.docx');
const MASTER = path.join(DOCS_DIR, 'ALEX-OS-master.md');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

/** The master is markdown: append one bullet directly under the section-11 heading. */
function addMasterRow(date, text) {
  const heading = '## 11. Running changes (kept current on every system change)';
  let s = fs.readFileSync(MASTER, 'utf8');
  if (!s.includes(heading)) throw new Error(`section 11 heading not found in ${MASTER}`);
  const row = `\n- **${date}.** ${text}\n`;
  s = s.replace(heading + '\n', heading + '\n' + row);
  fs.writeFileSync(MASTER, s, 'utf8');
  return 'section 11 line appended';
}

/*
 * The guide is a .docx, so the actual table append runs in Python (python-docx). Kept as a here-doc
 * rather than a second file so the lock, the validation and the write stay in ONE place a reader
 * can follow; splitting them is how the last writer ended up being "whatever the session wrote".
 */
const PY_APPEND = `
import sys, copy, io
import docx
path, date, text = sys.argv[1], sys.argv[2], sys.argv[3]
d = docx.Document(path)
target = None
for t in d.tables:
    hdr = [c.text.strip() for c in t.rows[0].cells]
    if hdr[:2] == ['Date', 'What changed']:
        target = t
        break
if target is None:
    print('ERROR: no running-changes table (header Date | What changed) found', file=sys.stderr)
    sys.exit(2)
row = copy.deepcopy(target.rows[-1]._tr)
target._tbl.append(row)
cells = target.rows[-1].cells
def setcell(c, txt):
    p = c.paragraphs[0]
    for r in list(p.runs):
        r._r.getparent().remove(r._r)
    p.add_run(txt)
    for extra in c.paragraphs[1:]:
        extra._p.getparent().remove(extra._p)
setcell(cells[0], date)
setcell(cells[1], text)
d.save(path)
print('rows now: %d' % len(target.rows))
`;

function addGuideRow(date, text) {
  const out = execFileSync('python', ['-c', PY_APPEND, GUIDE, date, text], { encoding: 'utf8' });
  return `section 12 row appended (${out.trim()})`;
}

function main() {
  const cmd = process.argv[2];

  if (cmd === 'status') {
    for (const [label, p] of [['guide', GUIDE], ['master', MASTER]]) {
      if (!fs.existsSync(p)) { console.log(`  ${label.padEnd(7)} MISSING at ${p}`); continue; }
      console.log(`  ${label.padEnd(7)} ${new Date(fs.statSync(p).mtime).toISOString().slice(0, 16)}  ${p}`);
    }
    return 0;
  }

  if (cmd !== 'add-row') {
    console.error('usage: identity-docs.js add-row --doc <guide|master> --date YYYY-MM-DD --text "..."');
    console.error('       identity-docs.js status');
    return 2;
  }

  const doc = arg('doc');
  const date = arg('date') || new Date().toLocaleDateString('sv-SE');
  const text = arg('text');
  if (!/^(guide|master)$/.test(doc || '')) { console.error('--doc must be guide or master'); return 2; }
  if (!text) { console.error('--text is required: this tool places prose, it never invents it'); return 2; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error(`--date must be YYYY-MM-DD (got ${date})`); return 2; }

  const target = doc === 'guide' ? GUIDE : MASTER;
  if (!fs.existsSync(target)) {
    console.error(`identity-docs: ${doc} not found at ${target}`);
    console.error('Both identity docs moved 2026-08-21; if neither is here, search for the filename before assuming it is gone.');
    return 2;
  }

  // The third lock caller P-56 asked for. Same mutex as the generator and the skills installer, so
  // a session appending a row and a generator rewriting a surface cannot interleave.
  const { acquire } = require('./lib/write-lock.js');
  const held = acquire({ name: 'alex-surfaces', label: `identity-docs:${doc}`, log: (m) => console.log(`  ${m}`) });
  if (!held.ok) {
    console.error(`identity-docs: could not take the alex-surfaces lock (${held.reason}). Another writer holds it; try again.`);
    return 2;
  }
  try {
    console.log(`  ${doc === 'guide' ? addGuideRow(date, text) : addMasterRow(date, text)}`);
    console.log(`  wrote ${date} into ${path.basename(target)}`);
    return 0;
  } catch (e) {
    console.error(`identity-docs: write FAILED (${e.message})`);
    return 2;
  } finally {
    held.release();
  }
}

process.exit(main());

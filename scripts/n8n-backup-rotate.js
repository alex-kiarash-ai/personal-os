'use strict';
/*
 * scripts/n8n-backup-rotate.js - S1 Compiled Surfaces P2 (2026-08-16): the n8n workflow-backup
 * packer. scripts/n8n-backups/ held 257 loose JSONs / 38MB and only ever grows (every REST
 * mutation writes a backup-first copy, correctly). Loose files stay useful ~forever as the last
 * few per workflow; the long tail belongs in monthly packs.
 *
 * KEEP (loose): the newest 5 backups per workflow id + EVERYTHING younger than 30 days.
 * PACK (the rest): scripts/n8n-backups/archive/YYYY-MM.tar.gz by each file's own month
 *   (name collision -> YYYY-MM.2.tar.gz; gz tars cannot append), via the PINNED System32
 *   bsdtar with an LF-terminated list file (CRLF in -T lists breaks bsdtar member lookup).
 * NOTHING IS LOST: ledger row per member (system/archive-ledger.jsonl) written BEFORE originals
 *   are removed; MANIFEST.tsv beside each pack (member, bytes, mtime, workflow id); originals
 *   removed ONLY after `tar -tzf` lists every expected member back. Restore any time:
 *     node scripts/n8n-backup-rotate.js --restore scripts/n8n-backups/archive/2026-07.tar.gz
 *   (extracts the pack back into scripts/n8n-backups/, byte-identical).
 *
 * Cadence: wired into the nightly 21:35 chain; self-gates to ONE run per calendar month via
 * system/n8n-backup-rotate-state.json. --force runs now; --dry reports only.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const DIR = path.join(REPO, 'scripts', 'n8n-backups');
const ARCHIVE = path.join(DIR, 'archive');
const LEDGER = path.join(REPO, 'system', 'archive-ledger.jsonl');
const STATE = path.join(REPO, 'system', 'n8n-backup-rotate-state.json');
// tar from PATH (GNU and bsdtar both handle the -czf/-tzf used here); ALEX_TAR overrides.
// The hardcoded System32 literal is gone with the platform (portability P5, 2026-08-25).
const TAR = process.env.ALEX_TAR || 'tar';
const KEEP_PER_WF = 5;
const KEEP_DAYS = 30;
const DRY = process.argv.includes('--dry');
const FORCE = process.argv.includes('--force');

function restore(pack) {
  const out = execFileSync(TAR, ['-xzf', pack, '-C', DIR], { encoding: 'utf8' });
  console.log(`restored pack ${pack} into ${DIR}`);
  if (out.trim()) console.log(out.trim());
}

function fileTs(name, full) {
  const m = name.match(/-(\d{13})\.json$/);
  if (m) return Number(m[1]);
  return fs.statSync(full).mtimeMs;
}

function main() {
  const ri = process.argv.indexOf('--restore');
  if (ri !== -1) return restore(process.argv[ri + 1]);

  // monthly self-gate (the nightly chain calls daily)
  const month = new Date().toISOString().slice(0, 7);
  if (!FORCE && !DRY && fs.existsSync(STATE)) {
    const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    if (st.last_month === month) { console.log(`n8n-backup-rotate: already ran for ${month} - no-op`); return; }
  }

  const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
  const byWf = new Map();
  const infos = files.map(f => {
    const full = path.join(DIR, f);
    const wf = (f.match(/^([A-Za-z0-9]{10,20})-/) || [, '_unknown'])[1];
    const ts = fileTs(f, full);
    const info = { f, full, wf, ts, size: fs.statSync(full).size };
    if (!byWf.has(wf)) byWf.set(wf, []);
    byWf.get(wf).push(info);
    return info;
  });
  const cutoff = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
  const keep = new Set();
  for (const list of byWf.values()) {
    list.sort((a, b) => b.ts - a.ts);
    list.slice(0, KEEP_PER_WF).forEach(i => keep.add(i.f));
    list.forEach(i => { if (i.ts >= cutoff) keep.add(i.f); });
  }
  const pack = infos.filter(i => !keep.has(i.f));
  console.log(`n8n-backup-rotate: ${files.length} loose, keeping ${keep.size}, packing ${pack.length}`);
  if (pack.length === 0) { if (!DRY) fs.writeFileSync(STATE, JSON.stringify({ last_month: month, packed: 0 })); return; }

  // group by the FILE's month
  const byMonth = new Map();
  for (const i of pack) {
    const m = new Date(i.ts).toISOString().slice(0, 7);
    if (!byMonth.has(m)) byMonth.set(m, []);
    byMonth.get(m).push(i);
  }
  if (DRY) {
    for (const [m, list] of byMonth) console.log(`  would pack ${list.length} file(s) (${(list.reduce((s, i) => s + i.size, 0) / 1048576).toFixed(1)}MB) -> archive/${m}.tar.gz`);
    return;
  }

  fs.mkdirSync(ARCHIVE, { recursive: true });
  let packed = 0;
  for (const [m, list] of byMonth) {
    let packPath = path.join(ARCHIVE, `${m}.tar.gz`);
    for (let n = 2; fs.existsSync(packPath); n++) packPath = path.join(ARCHIVE, `${m}.${n}.tar.gz`);
    const listFile = path.join(ARCHIVE, `_list-${m}.txt`);
    fs.writeFileSync(listFile, list.map(i => i.f).join('\n') + '\n', 'utf8'); // LF, never CRLF

    // 1. ledger rows BEFORE any removal (journal-before-move)
    for (const i of list) {
      fs.appendFileSync(LEDGER, JSON.stringify({
        ts: new Date().toISOString(), kind: 'n8n-backup', pack: path.relative(REPO, packPath).replace(/\\/g, '/'),
        member: i.f, bytes: i.size, workflow: i.wf, member_mtime: new Date(i.ts).toISOString(),
      }) + '\n', 'utf8');
    }
    // 2. pack (cwd = DIR so members carry bare names)
    execFileSync(TAR, ['-czf', packPath, '-C', DIR, '-T', listFile]);
    // 3. verify the pack lists every member back
    const listed = execFileSync(TAR, ['-tzf', packPath], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
    const missing = list.filter(i => !listed.includes(i.f));
    if (missing.length) throw new Error(`pack verify FAILED for ${packPath}: ${missing.length} member(s) missing (${missing[0].f}) - originals NOT removed`);
    // 4. MANIFEST.tsv beside the pack
    const manifest = packPath.replace(/\.tar\.gz$/, '.MANIFEST.tsv');
    fs.writeFileSync(manifest, 'member\tbytes\tmtime\tworkflow\n' +
      list.map(i => `${i.f}\t${i.size}\t${new Date(i.ts).toISOString()}\t${i.wf}`).join('\n') + '\n', 'utf8');
    // 5. only now remove the originals
    for (const i of list) fs.unlinkSync(i.full);
    fs.unlinkSync(listFile);
    packed += list.length;
    console.log(`  packed ${list.length} -> ${path.basename(packPath)} (verified ${listed.length} members) + MANIFEST`);
  }
  fs.writeFileSync(STATE, JSON.stringify({ last_month: month, packed, at: new Date().toISOString() }, null, 2));
  console.log(`n8n-backup-rotate: packed ${packed}, loose now ${fs.readdirSync(DIR).filter(f => f.endsWith('.json')).length}`);
}

try { main(); } catch (e) { console.error(`n8n-backup-rotate FAILED: ${e.message}`); process.exit(1); }

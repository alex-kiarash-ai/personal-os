#!/usr/bin/env node
'use strict';
/*
 * scripts/lesson-harvest.js - Recall Spine Phase 3: harvest Close-Out L-lines into the lessons table.
 *
 * Runs nightly (beside the fact harvest). Zero LLM tokens. The Close-Out Report already emits an
 * L-line - `L: class=<..> lesson="<one sentence>" evidence=<file:line|runid>` (or `L: none`) - this
 * turns that text into structured, dedup'd, hit-counted rows that the next session reads (Phase 2
 * Query 3) and that Sunday's /self-review clusters with a SELECT instead of an excavation.
 *
 * IDEMPOTENCY: a per-log byte cursor (system/recall/lesson-cursors.json, gitignored) means each L-line
 * is processed exactly once - re-scanning the same growing log every night can never re-inflate a hit
 * counter. A truncated/rotated log (cursor > size) resets to 0. This is the discipline that keeps
 * "seen 4x" a true signal.
 *
 * On the 3rd hit of a lesson, one promotion candidate is queued to system/recall/lesson-promotions.jsonl
 * (gitignored) for the weekly /self-review to consider as a Standing Order / CLAUDE.md edit - behind
 * the EXISTING human gate; this never auto-edits the constitution.
 */
const fs = require('fs');
const path = require('path');
const { openDb, REPO } = require('../system/recall/lib/db');
const { upsertLesson, parseLLine } = require('../system/recall/lib/lessons');

// Paths are env-overridable so the dedup/promotion logic can be exercised in a sandbox (matching
// vault_search.py's freshness-test design) without touching real cursors or the real ledger.
const LOG_DIR = process.env.ALEX_LOG_DIR || path.join(REPO, 'outputs', 'logs');
const CURSORS = process.env.ALEX_LESSON_CURSORS || path.join(REPO, 'system', 'recall', 'lesson-cursors.json');
const PROMOTIONS = process.env.ALEX_LESSON_PROMOTIONS || path.join(REPO, 'system', 'recall', 'lesson-promotions.jsonl');
const HARVEST_LOG = path.join(LOG_DIR, 'lesson-harvest.log');

function log(m) {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); fs.appendFileSync(HARVEST_LOG, m + '\n', 'utf8'); } catch (_) {}
  process.stdout.write(m + '\n');
}

function loadCursors() {
  try { return JSON.parse(fs.readFileSync(CURSORS, 'utf8')); } catch (_) { return {}; }
}
function saveCursors(c) {
  try { fs.writeFileSync(CURSORS, JSON.stringify(c, null, 2), 'utf8'); } catch (e) { log(`cursor save failed: ${e.message}`); }
}

function main() {
  const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
  log(`=== lesson harvest ${stamp} ===`);
  if (!fs.existsSync(LOG_DIR)) { log('no outputs/logs yet - nothing to harvest'); return 0; }

  const cursors = loadCursors();
  const db = openDb();
  let processed = 0; let inserted = 0; let bumped = 0; let promoted = 0;
  let merged = 0; let quarantined = 0;

  const files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith('.log'));
  for (const f of files) {
    if (f === 'lesson-harvest.log') continue; // never harvest our own log
    const fp = path.join(LOG_DIR, f);
    let size = 0;
    try { size = fs.statSync(fp).size; } catch (_) { continue; }
    let start = Number(cursors[f] || 0);
    if (start > size) start = 0; // log rotated/truncated
    if (start >= size) continue;
    let chunk = '';
    try {
      const fd = fs.openSync(fp, 'r');
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      fs.closeSync(fd);
      chunk = buf.toString('utf8');
    } catch (e) { log(`read failed ${f}: ${e.message}`); continue; }

    // P1.4 (2026-08-23): the cursor advances AFTER this file's lines are committed, never before.
    // The old order advanced first, so any upsert failure (a locked DB threw instantly before the
    // P1.3 busy_timeout) permanently skipped those L-lines on the next run: at-most-once semantics
    // on the one substrate where a lost line is the only copy. Re-reading a span is harmless
    // (upsert dedups), so at-least-once is the correct trade here.
    let fileOk = true;
    const lines = chunk.split(/\r?\n/);
    // P1.8*: an L-line is TRUSTED only inside a Close-Out report context. Scheduled automations emit
    // the whole report as one middle-dot line, interactive sessions may span a few lines, so the gate
    // is "same line as `Close-Out [`, or within CTX lines after one". Everything else is an L-shaped
    // string of unknown origin (harvested logs carry inbound email text verbatim: run-46 N6) and is
    // recorded QUARANTINED rather than dropped - inert to injection, still auditable.
    const CTX = 5;
    let lastCloseOut = -Infinity;

    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      if (/Close-Out\s*\[/i.test(line)) lastCloseOut = li;
      // Cheap screen only; parseLLine does the real work and owns the shape contract.
      // NOT line-anchored, and the colon is optional: every scheduled automation emits its
      // Close-Out Report as ONE middle-dot-separated line, so the L segment sits mid-line, and
      // email-triage writes `L class=`. The old `^\s*L:` screen here was the SECOND of two
      // line-anchored gates (the other was in parseLLine) that between them kept the lessons
      // table at 0 rows for four days while this harvester reported success nightly. Fixed
      // 2026-07-29; pinned by scripts/tests/test-lesson-parse.js.
      if (!/(?:^|[^A-Za-z0-9])L:?\s*(?:class=|none\b)/i.test(line)) continue;
      const parsed = parseLLine(line.trim());
      if (!parsed) continue; // `L: none` or malformed
      processed++;
      const trusted = (li - lastCloseOut) <= CTX;
      if (!trusted) quarantined++;
      try {
        const res = upsertLesson(db, {
          cls: parsed.cls, lesson: parsed.lesson, evidence: parsed.evidence, source_runid: f,
          quarantined: trusted ? 0 : 1,
          source_file: f, source_line: li + 1,
          origin: trusted ? 'close-out' : 'log-context-unverified',
        });
        if (res.action === 'insert') inserted++;
        else if (res.action === 'merge') { bumped++; merged++; }
        else bumped++;
        // PROMOTION AT 2 (was 3): the fuzzy key (P1.7*) makes the bar reachable at all. Gated on
        // promoted_at rather than an exact hit count, so a row already sitting above the line when
        // the line moved is not stranded, and a promotion can never be queued twice. Quarantined
        // rows never queue: an untrusted line must not reach the human gate wearing a lesson's face.
        if (trusted && res.hits >= 2) {
          const already = db.prepare('SELECT promoted_at FROM lessons WHERE id=?').get(res.id);
          if (already && !already.promoted_at) {
            promoted++;
            try {
              fs.appendFileSync(PROMOTIONS, JSON.stringify({
                ts: stamp, class: parsed.cls, lesson: parsed.lesson, hits: res.hits, evidence: parsed.evidence,
                source_file: f, source_line: li + 1, merged_by: res.action,
              }) + '\n', 'utf8');
              db.prepare('UPDATE lessons SET promoted_at=? WHERE id=?').run(stamp, res.id);
            } catch (e) { log(`promotion queue write failed: ${e.message}`); }
          }
        }
      } catch (e) { fileOk = false; log(`upsert failed (${f}:${li + 1}): ${e.message}`); }
    }
    if (fileOk) cursors[f] = size; // P1.4: only a clean pass advances the cursor
    else log(`cursor HELD for ${f} - a failed upsert must not skip those lines next run`);
  }

  // P1.7* HEARTBEAT: "no promotions" and "promotions are impossible" looked identical for the whole
  // life of this loop (92 lessons, zero promotions, an unreachable threshold, and a nightly OK).
  // Reporting how close the table actually gets makes an unreachable trigger look different from a
  // quiet one - the dead-but-green class, named in the H-case list, applied to the memory organ.
  let hb = 'n/a';
  try {
    const dist = db.prepare('SELECT hits, COUNT(*) c FROM lessons WHERE t_invalid IS NULL AND quarantined=0 GROUP BY hits ORDER BY hits').all();
    const top = db.prepare('SELECT MAX(hits) m FROM lessons WHERE t_invalid IS NULL AND quarantined=0').get();
    hb = `dist=${dist.map((r) => `${r.hits}x${r.c}`).join(',')} max_hits=${top && top.m ? top.m : 0} threshold=2`;
  } catch (_) {}

  db.close();
  saveCursors(cursors);
  log(`processed=${processed} inserted=${inserted} bumped=${bumped} merged=${merged} quarantined=${quarantined} promoted=${promoted}`);
  log(`heartbeat: ${hb}`);
  log('OK');
  return 0;
}

process.exit(main());

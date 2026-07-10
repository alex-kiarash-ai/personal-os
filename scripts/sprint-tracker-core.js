#!/usr/bin/env node
// scripts/sprint-tracker-core.js
// The zero-token deterministic core of the sprint tracker.
//
// WHY: the tracker's history is dominated by 9:00 quota/auth blackouts (06-26/29/30, the 07-06
// quad-fail) because a mostly-deterministic data job ran inside a fragile LLM session. ~90% of the
// work (read board, diff, count, velocity, stale, missed-run, contract, HQ push) needs zero tokens.
// This core always runs and can't be quota-killed; the standup PROSE + "one thing" lever stay an
// optional Claude pass on top (see run-sprint-tracker.ps1). If the prose pass dies on the cap, the
// numbers are already written and HQ is already green: degraded, never dark.
//
// STATE LEDGER: vault/projects/sprint-tracker/board-state.json holds {pageId: {status, since, task}}.
// It is the machine Since-ledger, replacing the page-ID table that was hand-maintained in status.md.
// The human status.md stays a prose summary owned by the (optional) LLM pass, so this core never
// does risky markdown surgery.
//
// READ PATH: live Notion data-source query (paginated, needs the integration token) when
// work/01-sprint-tracker/config/notion-token.txt exists; otherwise a CACHE fallback that parses the
// board snapshot table out of status.md so the core still runs (degraded: no honest velocity split).
//
// Usage:  node scripts/sprint-tracker-core.js [--dry-run]
//   --dry-run : compute + print everything (incl. the would-be HQ payload), write nothing, push nothing.

const fs = require('fs');
const path = require('path');
const board = require('./lib/notion-board');

const ROOT = path.resolve(__dirname, '..');
const P = {
  status:    path.join(ROOT, 'vault/projects/sprint-tracker/status.md'),
  velocity:  path.join(ROOT, 'vault/projects/sprint-tracker/velocity.md'),
  ledger:    path.join(ROOT, 'vault/projects/sprint-tracker/board-state.json'),
  lastrun:   path.join(ROOT, 'vault/projects/sprint-tracker/last-run.json'),
  decisions: path.join(ROOT, 'vault/projects/sprint-tracker/decisions-pending.md'),
  manifest:  path.join(ROOT, 'system/manifest.json'),
  token:     path.join(ROOT, 'work/01-sprint-tracker/config/notion-token.txt'),
  hqToken:   path.join(ROOT, 'work/16-alex-hq/config/alex-hq-token.txt'),
};
const HQ_URL = 'https://n8n.shaheenkiarash.com/webhook/alex-push';
const NON_TERMINAL = ['In Progress', 'Next', 'Blocked'];
const STALE_WD = 5;         // weekdays in a non-terminal status before it is flagged
const AUTODROP_WD = 15;     // weekdays before a stale "waiting" row becomes an auto-drop candidate

const DRY = process.argv.includes('--dry-run');
const SEED = process.argv.includes('--seed');   // write ledger + decisions only; no velocity append, no HQ push

// ---------- date helpers (UTC, weekday-aware) ----------
function today() { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
function parseDate(s) { const m = /(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; }
function iso(d) { return d.toISOString().slice(0, 10); }
function isWeekday(d) { const g = d.getUTCDay(); return g >= 1 && g <= 5; }
// weekdays in (a, b]  -- exclusive of a, inclusive of b
function weekdaysBetween(a, b) {
  if (!a || !b) return 0;
  let n = 0; const d = new Date(a);
  while (d < b) { d.setUTCDate(d.getUTCDate() + 1); if (d <= b && isWeekday(d)) n++; }
  return n;
}

// ---------- status.md frontmatter (for the Notion ids) ----------
function readFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const fm = {};
  if (m) for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_]+):\s*(.+)$/.exec(line.trim());
    if (kv) fm[kv[1]] = kv[2].trim();
  }
  return fm;
}

// ---------- load the board (live or cache) ----------
async function loadBoard(statusText, fm) {
  const token = board.readToken(P.token);
  if (token) {
    try {
      const rows = await board.readBoardLive({ token, dataSourceId: fm.data_source_id, dbId: fm.db_id });
      if (rows.length) return { mode: 'live', rows };
      // empty live read is suspicious; fall through to cache rather than report 0 rows
    } catch (e) {
      console.error(`live read failed (${e.message}); falling back to cache`);
    }
  }
  const rows = board.parseSnapshotCache(statusText);
  return { mode: 'cache', rows };
}

// ---------- the compute ----------
function computeCounts(rows) {
  const c = { Done: 0, 'In Progress': 0, Next: 0, Planned: 0, Blocked: 0 };
  for (const r of rows) if (c[r.status] !== undefined) c[r.status]++;
  return c;
}

function lastVelocityRow(velText) {
  const rows = velText.split(/\r?\n/).filter(l => /^\|\s*\d{4}-\d{2}-\d{2}\s*\|/.test(l));
  if (!rows.length) return null;
  const cells = rows[rows.length - 1].split('|').map(s => s.trim());
  // | Date | Done | In Progress | Next | Planned | Blocked | Total | Velocity |
  return { date: cells[1], done: parseInt(cells[2], 10) };
}

// expected titles: strip the trailing "(BI)" style qualifier. board tasks: keep paren CONTENT
// (the "(Modeling)"/"(Personal OS)" suffix carries the match), just drop the paren chars.
const normKey = s => s.toLowerCase().replace(/\s*\(.*$/, '').replace(/[-/]/g, ' ').replace(/\s+/g, ' ').trim();
const normHay = s => s.toLowerCase().replace(/[()]/g, ' ').replace(/[-/]/g, ' ').replace(/\s+/g, ' ').trim();
function contractCheck(rows, manifest) {
  // Expected board rows = every non-retired numbered project + the unnumbered projects.
  // (known_extra_projects_no_work_folder is about status.md existence for the recovery checker,
  //  not board rows, and it duplicates the unnumbered/numbered entries, so it's excluded here.)
  const expected = [];
  for (const p of manifest.projects) if (p.state !== 'RETIRED') expected.push(p.title);
  for (const u of (manifest.meta.unnumbered || [])) expected.push(u.title);
  const hay = rows.map(r => normHay(r.task));
  const missing = [];
  for (const title of expected) {
    const key = normKey(title);
    const first = key.split(' ')[0];
    const hit = hay.some(t => t.includes(key) || (first.length > 3 && t.includes(first)));
    if (!hit) missing.push(title);
  }
  return missing; // advisory: freeform board titles => match is fuzzy; never auto-creates here
}

async function main() {
  const now = today();
  const statusText = fs.readFileSync(P.status, 'utf8');
  const velText = fs.readFileSync(P.velocity, 'utf8');
  const manifest = JSON.parse(fs.readFileSync(P.manifest, 'utf8'));
  const fm = readFrontmatter(statusText);

  const prevLedger = fs.existsSync(P.ledger) ? JSON.parse(fs.readFileSync(P.ledger, 'utf8')) : {};
  // seed the ledger from the status.md snapshot table on first run (before board-state.json exists)
  if (!Object.keys(prevLedger).length) {
    for (const r of board.parseSnapshotCache(statusText)) {
      prevLedger[r.pageId] = { status: r.status, since: (parseDate(r.since) ? r.since : iso(now)), task: r.task };
    }
  }

  const { mode, rows } = await loadBoard(statusText, fm);
  const counts = computeCounts(rows);
  const total = rows.length;

  // --- Since ledger + shipped/reconciled velocity ---
  const newLedger = {};
  let shipped = 0, reconciled = 0;
  const staleRows = [];
  for (const r of rows) {
    const prev = prevLedger[r.pageId];
    const changed = !prev || prev.status !== r.status;
    const since = changed ? iso(now) : prev.since;
    newLedger[r.pageId] = { status: r.status, since, task: r.task };

    if (r.status === 'Done') {
      if (prev && prev.status && prev.status !== 'Done') shipped++;     // real transition into Done
      else if (!prev) reconciled++;                                     // new row created straight to Done (backfill)
    }
    if (NON_TERMINAL.includes(r.status)) {
      const age = weekdaysBetween(parseDate(since), now);
      if (age >= STALE_WD) staleRows.push({ task: r.task, status: r.status, since, age });
    }
  }

  // --- velocity delta vs the last velocity.md row (works in both modes) ---
  const lastVel = lastVelocityRow(velText);
  const donePrev = lastVel ? lastVel.done : counts.Done;
  const delta = counts.Done - donePrev;
  // HQ tile: honest shipped count in live mode; raw delta in cache mode (can't split without live diff)
  const hqVelocity = mode === 'live' ? shipped : delta;

  // --- missed-run detection ---
  const lastDate = lastVel ? parseDate(lastVel.date) : null;
  const missed = lastDate ? weekdaysBetween(lastDate, now) : 0;

  // --- contract sweep (advisory) ---
  const missingRows = contractCheck(rows, manifest);

  staleRows.sort((a, b) => b.age - a.age);

  const summary = {
    date: iso(now), mode, total, counts,
    velocity: { done_prev: donePrev, done_now: counts.Done, delta, shipped, reconciled, hq_value: hqVelocity },
    missed_runs: missed, last_run: lastVel ? lastVel.date : null,
    stale: staleRows, contract_missing: missingRows,
  };

  // ---------- outputs ----------
  const velRow = `| ${iso(now)} | ${counts.Done} | ${counts['In Progress']} | ${counts.Next} | ${counts.Planned} | ${counts.Blocked} | ${total} | ${hqVelocity >= 0 ? '+' : ''}${hqVelocity}${mode === 'live' ? ` (shipped ${shipped}, reconciled ${reconciled})` : ' (cache mode: split unavailable)'}${missed > 0 ? ` (covers ${missed} missed day${missed > 1 ? 's' : ''})` : ''} |`;

  const decisionsMd = renderDecisions(staleRows, iso(now));

  const hqPayload = [
    { project: 'sprint', metric_key: 'velocity', value_num: hqVelocity,
      headline: `Done ${counts.Done} of ${total} · velocity ${hqVelocity >= 0 ? '+' : ''}${hqVelocity}`,
      status: missed > 0 ? 'amber' : 'green' },
    { project: 'sprint', metric_key: 'run_status', value_num: 1,
      headline: `run clean ${iso(now)}`, status: 'green' },
  ];

  // ---------- print (always) ----------
  console.log(`sprint-tracker-core [${mode} mode]${DRY ? ' (dry-run)' : ''}`);
  console.log(`  counts: Done ${counts.Done} · In Progress ${counts['In Progress']} · Next ${counts.Next} · Planned ${counts.Planned} · Blocked ${counts.Blocked} · total ${total}`);
  console.log(`  velocity: Done ${donePrev} -> ${counts.Done} (delta ${delta >= 0 ? '+' : ''}${delta})` + (mode === 'live' ? ` | shipped ${shipped}, reconciled ${reconciled}` : ' | split n/a in cache mode'));
  console.log(`  missed runs since ${summary.last_run}: ${missed}`);
  console.log(`  stale (>=${STALE_WD}wd): ${staleRows.length}` + (staleRows.length ? ' -> ' + staleRows.map(s => `${s.task} [${s.status} ${s.age}wd]`).join('; ') : ''));
  console.log(`  contract missing (advisory): ${missingRows.length ? missingRows.join(', ') : 'none'}`);
  console.log(`  velocity row: ${velRow}`);
  console.log(`  HQ payload: ${JSON.stringify(hqPayload)}`);

  if (DRY) { console.log('  DRY-RUN: no files written, no HQ push.'); return summary; }

  // ---------- write ----------
  fs.writeFileSync(P.ledger, JSON.stringify(newLedger, null, 2), 'utf8');
  fs.writeFileSync(P.lastrun, JSON.stringify({ ...summary, velocity_row: velRow, hq_payload: hqPayload }, null, 2), 'utf8');
  fs.writeFileSync(P.decisions, decisionsMd, 'utf8');
  if (SEED) { console.log('  SEED: wrote board-state.json + decisions-pending.md (no velocity append, no HQ push).'); return summary; }

  fs.appendFileSync(P.velocity, (velText.endsWith('\n') ? '' : '\n') + velRow + '\n', 'utf8');
  console.log('  wrote board-state.json, appended velocity.md, wrote decisions-pending.md');

  await pushHQ(hqPayload);
  return summary;
}

function renderDecisions(staleRows, dateStr) {
  const lines = [
    '---', 'tags: [sprint-tracker, decisions-pending]', `date_updated: ${dateStr}`, '---', '',
    '# Decisions Pending (stale board rows)', '',
    'Written by `scripts/sprint-tracker-core.js` each run. The morning brief surfaces these as one-tap',
    'keep/drop decisions. A row past ' + AUTODROP_WD + ' weekdays with no decision is an auto-drop candidate.', '',
  ];
  if (!staleRows.length) { lines.push('_None. Every non-terminal row is under ' + STALE_WD + ' weekdays old._'); }
  else for (const s of staleRows) {
    const flag = s.age >= AUTODROP_WD ? ' **[auto-drop candidate]**' : '';
    lines.push(`- **${s.task}** - ${s.status}, ${s.age} weekdays (since ${s.since}). Keep or drop?${flag}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function pushHQ(payload) {
  const token = board.readToken(P.hqToken);
  if (!token) { console.log('  HQ push skipped: token file missing'); return; }
  try {
    const res = await fetch(HQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Alex-Token': token },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });
    console.log(`  HQ push ${res.ok ? 'ok' : 'failed ' + res.status}`);
  } catch (e) {
    console.log(`  HQ push error (non-fatal): ${e.message}`);
  }
}

main().catch(e => { console.error('sprint-tracker-core FAILED:', e.message); process.exit(1); });

#!/usr/bin/env node
/**
 * daily-plan-core.js - the zero-token read half of the Daily Plan board.
 *
 * The Daily Plan lives in Notion (see vault/projects/daily-plan/status.md for the ids;
 * they are NOT hard-coded here because this file is tracked in a PUBLIC repo).
 *
 * Read path, in order, the same three-leg pattern #01 uses:
 *   1. Scoped Notion REST token  -> deterministic, works headless, refreshes the mirror.
 *   2. (Claude sessions only)    -> the Notion MCP, driven by .claude/commands/today.md.
 *   3. Local mirror              -> board-state.json, when neither of the above is reachable.
 *
 * THE STALENESS GUARD IS THE POINT OF THIS FILE.
 * Serving a three-day-old task list as "today" is worse than serving nothing, because the
 * failure is invisible: the list looks right and is wrong. Every surface that renders mirror
 * data MUST say so and MUST name the age. `isStale()` decides; nothing else may.
 *
 * Commands:
 *   node scripts/daily-plan-core.js sync              refresh the mirror from Notion
 *   node scripts/daily-plan-core.js today [--date D]  print the day's rows
 *   node scripts/daily-plan-core.js briefline         ONE line for morning-brief slot 7 (silent if none)
 *   node scripts/daily-plan-core.js overdue           To Do rows dated before today
 *
 * Exit codes: 0 ok · 3 no source reachable and no mirror · 4 mirror is stale (data still printed,
 * clearly labelled). Never exits 0 while presenting stale data as fresh.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { readToken, readBoardLive } = require('./lib/notion-board');

const ROOT = path.resolve(__dirname, '..');
const STATUS_MD = path.join(ROOT, 'vault/projects/daily-plan/status.md');
const MIRROR = path.join(ROOT, 'vault/projects/daily-plan/board-state.json');
const TOKEN_PATH = path.join(ROOT, 'work/01-sprint-tracker/config/notion-token.txt');

function todayISO(d) { return (d || new Date()).toISOString().slice(0, 10); }

function daysBetween(aISO, bISO) {
  const a = Date.parse(aISO + 'T00:00:00Z');
  const b = Date.parse(bISO + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

/** IDs live in the gitignored status.md, never in this tracked file. */
function readIds() {
  let txt = '';
  try { txt = fs.readFileSync(STATUS_MD, 'utf8'); } catch { return {}; }
  const grab = (k) => {
    const m = txt.match(new RegExp('^' + k + ':\\s*(\\S+)\\s*$', 'm'));
    return m ? m[1] : null;
  };
  return { dbId: grab('db_id'), dataSourceId: grab('data_source_id') };
}

// ---- property extraction for THIS schema ----
const txt = (p) => {
  if (!p) return '';
  if (Array.isArray(p.title)) return p.title.map((t) => t.plain_text).join('').trim();
  if (Array.isArray(p.rich_text)) return p.rich_text.map((t) => t.plain_text).join('').trim();
  return '';
};
const choice = (p) => (p && ((p.select && p.select.name) || (p.status && p.status.name))) || '';
const dateStart = (p) => (p && p.date && p.date.start ? String(p.date.start).slice(0, 10) : null);

function normalizeDailyPlanRow(page) {
  const p = page.properties || {};
  return {
    pageId: page.id,
    task: txt(p.Task) || '(untitled)',
    date: dateStart(p.Date),
    status: choice(p.Status),
    block: choice(p.Block),
    week: choice(p.Week),
    outcome: txt(p.Outcome),
    doneOn: dateStart(p['Done On']),
    notes: txt(p.Notes),
  };
}

// ---- mirror ----
function writeMirror(rows) {
  fs.mkdirSync(path.dirname(MIRROR), { recursive: true });
  const payload = { synced_at: todayISO(), synced_at_iso: new Date().toISOString(), count: rows.length, rows };
  fs.writeFileSync(MIRROR, JSON.stringify(payload, null, 1));
  return payload;
}

function readMirror() {
  try { return JSON.parse(fs.readFileSync(MIRROR, 'utf8')); } catch { return null; }
}

/**
 * The guard. Mirror data is stale unless it was synced today.
 * Returns {stale:boolean, ageDays:number|null, since:string|null}.
 */
function isStale(mirror, now) {
  if (!mirror || !mirror.synced_at) return { stale: true, ageDays: null, since: null };
  const age = daysBetween(mirror.synced_at, todayISO(now));
  return { stale: age === null || age > 0, ageDays: age, since: mirror.synced_at };
}

function staleBanner(s) {
  if (!s.since) return 'CACHED, and the mirror carries no sync date. Treat every row as unverified.';
  const n = s.ageDays;
  return `CACHED, Notion unreachable. Last synced ${s.since}` +
         (n === null ? '.' : ` (${n} day${n === 1 ? '' : 's'} ago).`) +
         ' Rows may have changed since. NOT today\'s verified list.';
}

/** Load rows. Prefers live, falls back to mirror, and always reports which it used. */
async function load() {
  const { dbId, dataSourceId } = readIds();
  const token = readToken(TOKEN_PATH);
  if (token && (dataSourceId || dbId)) {
    try {
      const rows = await readBoardLive({ token, dataSourceId, dbId, normalize: normalizeDailyPlanRow });
      const m = writeMirror(rows);
      return { rows, source: 'live', stale: { stale: false, ageDays: 0, since: m.synced_at } };
    } catch (e) {
      process.stderr.write(`daily-plan: live read failed (${e.message}), falling back to mirror\n`);
    }
  }
  const mirror = readMirror();
  if (!mirror) return { rows: null, source: 'none', stale: { stale: true, ageDays: null, since: null } };
  return { rows: mirror.rows || [], source: 'mirror', stale: isStale(mirror) };
}

const OPEN = (r) => r.status === 'To Do' || r.status === 'Doing';
const byBlock = (a, b) => (a.block || '').localeCompare(b.block || '') || a.task.localeCompare(b.task);

async function main() {
  const cmd = (process.argv[2] || 'today').toLowerCase();
  const dArg = process.argv.indexOf('--date');
  const day = dArg > -1 ? process.argv[dArg + 1] : todayISO();

  const { rows, source, stale } = await load();
  if (!rows) {
    process.stdout.write('Daily Plan: NO SOURCE. Notion unreachable and no local mirror exists. Nothing shown, nothing guessed.\n');
    process.exit(3);
  }
  if (stale.stale) process.stdout.write(`[!] ${staleBanner(stale)}\n`);

  const todays = rows.filter((r) => r.date === day).sort(byBlock);
  const overdue = rows.filter((r) => OPEN(r) && r.date && r.date < day).sort((a, b) => a.date.localeCompare(b.date));

  if (cmd === 'sync') {
    process.stdout.write(`Daily Plan: ${rows.length} rows, source=${source}, synced_at=${stale.since || 'n/a'}\n`);
  } else if (cmd === 'briefline') {
    // slot 7 of the morning brief. SILENT when the day is empty, per the 7-line cap rules.
    const open = todays.filter(OPEN);
    if (open.length || overdue.length) {
      const bits = [];
      if (open.length) bits.push(`${open.length} task${open.length === 1 ? '' : 's'}, first: ${open[0].task}`);
      if (overdue.length) bits.push(`${overdue.length} overdue`);
      process.stdout.write(`Today: ${bits.join(' · ')}${stale.stale ? ' [CACHED]' : ''}\n`);
    }
  } else if (cmd === 'overdue') {
    if (!overdue.length) process.stdout.write('Nothing overdue.\n');
    overdue.forEach((r) => process.stdout.write(`  ${r.date}  [${r.block}] ${r.task}\n`));
  } else {
    const outcome = todays.length ? todays[0].outcome : '';
    const wk = todays.length ? todays[0].week : '';
    process.stdout.write(`\nDaily Plan, ${day}${wk ? ` (${wk})` : ''}${source === 'mirror' ? ' [from mirror]' : ''}\n`);
    if (outcome) process.stdout.write(`Week outcome: ${outcome}\n`);
    if (!todays.length) process.stdout.write('\nNo rows for this day.\n');
    let i = 0;
    for (const r of todays) {
      i += 1;
      const mark = r.status === 'Done' ? 'x' : r.status === 'Skipped' ? '-' : r.status === 'Moved' ? '>' : ' ';
      process.stdout.write(`\n ${String(i).padStart(2)}. [${mark}] ${r.task}\n     ${r.block} · ${r.status}${r.doneOn ? ` · done ${r.doneOn}` : ''}\n`);
      if (r.notes) process.stdout.write(`     ${r.notes}\n`);
    }
    if (overdue.length) {
      process.stdout.write(`\nOverdue (${overdue.length}):\n`);
      overdue.forEach((r) => process.stdout.write(`   ${r.date}  [${r.block}] ${r.task}\n`));
    }
    process.stdout.write('\n');
  }

  process.exit(stale.stale ? 4 : 0);
}

module.exports = { isStale, staleBanner, normalizeDailyPlanRow, readIds, daysBetween };

if (require.main === module) {
  main().catch((e) => { process.stderr.write(`daily-plan-core: ${e.stack || e.message}\n`); process.exit(1); });
}

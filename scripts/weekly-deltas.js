#!/usr/bin/env node
/*
 * weekly-deltas.js - deltas-first rendering for the weekly exec report (#10 upgrade, 2026-07-25).
 *
 * A weekly exec review exists to answer "what CHANGED", not "what is". So every metric is rendered
 * value + direction + vs-4-week-baseline, computed DETERMINISTICALLY here (zero Claude calls) BEFORE
 * the prose pass, and the prose pass is told to comment only on the TOP 3 deltas by |z-score| - so it
 * writes 3 sharp paragraphs, not 12 flat ones (cheaper AND more useful).
 *
 * SOURCE: vault/projects/weekly-exec-report/metrics-history.jsonl (under vault/, local-only). One row
 * per week: { "week_ending": "YYYY-MM-DD", "metrics": { "<name>": <number>, ... } }. The #10 run appends
 * one structured row each week beside the human-readable metrics-history/YYYY-MM-DD.md table.
 *
 * OUTPUT: vault/projects/weekly-exec-report/deltas-latest.md - a full deltas table + a TOP-3 section the
 * prose pass consumes. The z-score uses the up-to-4 prior weeks as the baseline (mean + sample std);
 * when std is 0 or history is thin, direction still renders and z is reported as n/a (not a fake number).
 *
 * Usage:  node scripts/weekly-deltas.js            # compute latest week's deltas -> deltas-latest.md
 *         node scripts/weekly-deltas.js --json      # print the top-3 as JSON (for the run to read)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const HIST = path.join(REPO, 'vault', 'projects', 'weekly-exec-report', 'metrics-history.jsonl');
const OUT = path.join(REPO, 'vault', 'projects', 'weekly-exec-report', 'deltas-latest.md');
const BASELINE_WEEKS = 4;

function readHistory() {
  if (!fs.existsSync(HIST)) return [];
  return fs.readFileSync(HIST, 'utf8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean).sort((a, b) => a.week_ending.localeCompare(b.week_ending));
}

function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function stdev(a) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2)) * a.length / (a.length - 1)); }
function arrow(v, base) { const d = v - base; return d > 1e-9 ? '▲' : d < -1e-9 ? '▼' : '—'; }

function computeDeltas(history) {
  if (!history.length) return { week: null, rows: [], top3: [] };
  const latest = history[history.length - 1];
  const prior = history.slice(0, -1).slice(-BASELINE_WEEKS); // up to 4 weeks before the latest
  const prev = history.length >= 2 ? history[history.length - 2] : null;
  const rows = [];
  for (const [name, value] of Object.entries(latest.metrics || {})) {
    if (typeof value !== 'number') continue;
    const baseVals = prior.map(w => w.metrics && w.metrics[name]).filter(v => typeof v === 'number');
    const base = mean(baseVals);
    const sd = stdev(baseVals);
    const prevVal = prev && prev.metrics && typeof prev.metrics[name] === 'number' ? prev.metrics[name] : null;
    const z = baseVals.length >= 2 && sd > 1e-9 ? (value - base) / sd : null;
    rows.push({ name, value, prev: prevVal, base: baseVals.length ? +base.toFixed(1) : null,
      dir: prevVal != null ? arrow(value, prevVal) : arrow(value, base),
      delta_vs_base: baseVals.length ? +(value - base).toFixed(1) : null,
      z: z == null ? null : +z.toFixed(2), n_base: baseVals.length });
  }
  const top3 = rows.filter(r => r.z != null).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 3);
  return { week: latest.week_ending, rows, top3 };
}

function render({ week, rows, top3 }) {
  if (!week) return '# Weekly deltas\n\nNo metrics history yet - the first #10 run seeds it.\n';
  let md = `# Weekly deltas - week ending ${week}\n\n`;
  md += `_Deterministic (zero-token). Direction is vs last week; baseline is the mean of up to ${BASELINE_WEEKS} prior weeks; z-score is vs that baseline's spread. The prose pass comments ONLY on the top 3 by |z|._\n\n`;
  md += `## Top 3 deltas (what the report should lead on)\n\n`;
  if (!top3.length) md += `Not enough history for z-scores yet (need >= 2 baseline weeks). Directions render below.\n\n`;
  for (const r of top3) md += `- **${r.name}**: ${r.value} ${r.dir} (baseline ${r.base}, ${r.delta_vs_base >= 0 ? '+' : ''}${r.delta_vs_base}, z=${r.z}).\n`;
  md += `\n## All metrics (value · direction · vs-4wk-baseline)\n\n`;
  md += `| Metric | Value | Dir | Baseline(${BASELINE_WEEKS}wk) | Δ vs base | z |\n|---|--:|:--:|--:|--:|--:|\n`;
  for (const r of rows) md += `| ${r.name} | ${r.value} | ${r.dir} | ${r.base ?? 'n/a'} | ${r.delta_vs_base ?? 'n/a'} | ${r.z ?? 'n/a'} |\n`;
  return md + '\n';
}

const history = readHistory();
const deltas = computeDeltas(history);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ week: deltas.week, top3: deltas.top3 }, null, 2));
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, render(deltas), 'utf8');
  console.log(`weekly-deltas: week ${deltas.week || '(none)'}, ${deltas.rows.length} metrics, top-3 by |z|: ${deltas.top3.map(r => r.name).join(', ') || '(insufficient history)'} -> ${path.relative(REPO, OUT)}`);
}

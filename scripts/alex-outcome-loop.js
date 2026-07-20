#!/usr/bin/env node
/*
 * alex-outcome-loop.js - the OUTCOME loop v1 (agent-architecture decision run 2026-07-20, item 6.3).
 *
 * The gap it closes (doc 1's Data Analyst, rebuilt the Alex way): today Alex remembers what it DID
 * (run_log, deliverables ledger) but nothing resolves which outputs WORKED. No link from a CV/cover
 * variant to whether it drew a response or an interview. This collector is the missing half of the
 * memory thesis: results write back so the next cycle's writers can read the winners.
 *
 * Built exactly like the cost-attribution sibling: DETERMINISTIC, ZERO Claude calls (so the cap it
 * could measure can never stop it), rule-based joins only, no model in the loop. Model commentary, if
 * ever, is optional and downstream (core-first).
 *
 * SCOPE (v1, per the plan): the APPLICATION PIPELINE ONLY, where event volume actually exists
 * (#03 BI + #14 AI). LinkedIn episodes (#12) come later and ONLY if v2's 60-day measurement shows the
 * loop is read and acted on (6.4). This answers "which variant families earned responses", NOT a
 * dashboard: #10 surfaces it as DECISIONS.
 *
 * SOURCE TABLE (the Tier 2 outcome table, append-only):
 *   vault/projects/job-pipeline/outcomes/outcomes.jsonl
 * One row per application. Row schema (see outcomes/README.md):
 *   { app_id, date_applied, engine:"03"|"14", track:"powerbi"|"ai",
 *     variant:{ cv_set, letter_pattern, fit_band, city },
 *     outcome:"pending"|"response"|"rejection"|"interview"|"offer"|"silence",
 *     outcome_date, source:"email-triage"|"notion"|"manual"|"sheet-export", note }
 * Rows are fed by: the pipeline (variant features, at draft time), email-triage classifications and
 * Notion rows (outcome states), or Shaheen reporting an outcome interactively. All rule-based.
 *
 * GENERATED (into the same Tier 2 folder, never hand-edited):
 *   winners.json         - machine-readable current winning patterns (feeds the writer block, 6.3.4)
 *   report-section.md    - the #10 weekly-exec-report "Outcomes" section, written as decisions
 *
 * HONESTY RAIL (the 60-day measurement, mirroring the 8.3 vault-read experiment): a winner is only
 * declared when a variant value has >= MIN_RESOLVED resolved outcomes. Below that the loop reports
 * "accumulating - insufficient signal" and declares NO winner. The loop must earn its place; if after
 * 60 days it only accumulates and never changes a selection, shrink it.
 *
 * Usage:
 *   node scripts/alex-outcome-loop.js                       # aggregate -> winners.json + report-section.md (+ stdout)
 *   node scripts/alex-outcome-loop.js add --app-id X --engine 03 --track powerbi \
 *        --cv-set bi-core --letter neutral --fit-band 80-89 --city London \
 *        --outcome response --note "..."                    # append/update one outcome row (manual/email-triage)
 *   node scripts/alex-outcome-loop.js ingest-sheet <path.json>   # seed pending rows from a run_log export (csv->json or xlsx->json)
 *   node scripts/alex-outcome-loop.js status                # window + counts, no write
 *
 * Zero external calls. Zero Claude calls. Safe to run headless in the nightly chain.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO, 'vault', 'projects', 'job-pipeline', 'outcomes');
const TABLE = path.join(OUT_DIR, 'outcomes.jsonl');
const WINNERS = path.join(OUT_DIR, 'winners.json');
const SECTION = path.join(OUT_DIR, 'report-section.md');
const READY_BLOCK = path.join(REPO, 'work', '03-application-engine', 'outcome-winners.block.md');

const MIN_RESOLVED = 5;          // a variant value needs this many RESOLVED outcomes before it can be a winner
const MEASURE_DAYS = 60;         // the honesty-rail measurement window
const POSITIVE = new Set(['response', 'interview', 'offer']);   // "worked" outcomes
const RESOLVED = new Set(['response', 'rejection', 'interview', 'offer', 'silence']); // not pending
const today = () => new Date().toISOString().slice(0, 10);

function ensureDir() { fs.mkdirSync(OUT_DIR, { recursive: true }); }

function readTable() {
  if (!fs.existsSync(TABLE)) return [];
  return fs.readFileSync(TABLE, 'utf8').split('\n').filter(Boolean).map((l, i) => {
    try { return JSON.parse(l); } catch { console.error(`  skipping malformed row ${i + 1}`); return null; }
  }).filter(Boolean);
}

// --- add / update one outcome row (last write wins per app_id for the outcome field) ---------------
function cmdAdd(args) {
  ensureDir();
  const get = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
  const appId = get('app-id');
  if (!appId) { console.error('add: --app-id is required'); process.exit(1); }
  const rows = readTable();
  const existing = rows.find((r) => r.app_id === appId);
  const outcome = get('outcome') || (existing && existing.outcome) || 'pending';
  const row = {
    app_id: appId,
    date_applied: get('date-applied') || (existing && existing.date_applied) || today(),
    engine: get('engine') || (existing && existing.engine) || '03',
    track: get('track') || (existing && existing.track) || 'powerbi',
    variant: {
      cv_set: get('cv-set') || (existing && existing.variant && existing.variant.cv_set) || 'unknown',
      letter_pattern: get('letter') || (existing && existing.variant && existing.variant.letter_pattern) || 'unknown',
      fit_band: get('fit-band') || (existing && existing.variant && existing.variant.fit_band) || 'unknown',
      city: get('city') || (existing && existing.variant && existing.variant.city) || 'unknown',
    },
    outcome,
    outcome_date: RESOLVED.has(outcome) ? (get('outcome-date') || today()) : null,
    source: get('source') || 'manual',
    note: get('note') || (existing && existing.note) || '',
  };
  // append-only table: write the new/updated row; aggregation uses the LAST row per app_id.
  fs.appendFileSync(TABLE, JSON.stringify(row) + '\n', 'utf8');
  console.log(`outcome row ${existing ? 'updated' : 'added'}: ${appId} -> ${outcome}`);
  aggregate();
}

// --- seed pending rows from a run_log export (array of {app_id, track, cv_set, letter, fit, city, date}) ---
function cmdIngestSheet(file) {
  if (!file || !fs.existsSync(file)) { console.error(`ingest-sheet: file not found: ${file}`); process.exit(1); }
  ensureDir();
  let recs; try { recs = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error('ingest-sheet: not valid JSON: ' + e.message); process.exit(1); }
  if (!Array.isArray(recs)) { console.error('ingest-sheet: expected a JSON array of run_log rows'); process.exit(1); }
  const have = new Set(readTable().map((r) => r.app_id));
  const band = (f) => { const n = Number(f); if (!Number.isFinite(n)) return 'unknown'; if (n >= 90) return '90+'; if (n >= 80) return '80-89'; if (n >= 70) return '70-79'; return '<70'; };
  let added = 0;
  for (const rec of recs) {
    const id = rec.app_id || rec.id || rec.job_id;
    if (!id || have.has(id)) continue;
    const row = {
      app_id: id, date_applied: rec.date || rec.date_applied || today(),
      engine: String(rec.engine || (rec.track === 'ai' ? '14' : '03')),
      track: rec.track || 'powerbi',
      variant: { cv_set: rec.cv_set || 'unknown', letter_pattern: rec.letter || rec.letter_pattern || 'unknown', fit_band: rec.fit_band || band(rec.fit), city: rec.city || 'unknown' },
      outcome: 'pending', outcome_date: null, source: 'sheet-export', note: rec.note || '',
    };
    fs.appendFileSync(TABLE, JSON.stringify(row) + '\n', 'utf8'); added++;
  }
  console.log(`ingest-sheet: ${added} new pending application(s) seeded from ${path.basename(file)}`);
  aggregate();
}

// --- the deterministic aggregation: variant value -> outcome rates, winners behind the sample gate ---
function collapse(rows) {
  // last row per app_id wins (append-only updates)
  const byId = new Map();
  for (const r of rows) byId.set(r.app_id, r);
  return [...byId.values()];
}

function tallyBy(apps, keyFn) {
  const t = {};
  for (const a of apps) {
    const key = keyFn(a);
    if (key == null || key === 'unknown') continue;
    const b = (t[key] = t[key] || { applied: 0, resolved: 0, positive: 0, response: 0, interview: 0, silence: 0 });
    b.applied++;
    if (RESOLVED.has(a.outcome)) b.resolved++;
    if (POSITIVE.has(a.outcome)) b.positive++;
    if (a.outcome === 'response') b.response++;
    if (a.outcome === 'interview' || a.outcome === 'offer') b.interview++;
    if (a.outcome === 'silence') b.silence++;
  }
  return t;
}

function pickWinner(tally) {
  // winner = highest positive-rate value with resolved >= MIN_RESOLVED; else null (accumulating).
  const eligible = Object.entries(tally).filter(([, b]) => b.resolved >= MIN_RESOLVED);
  if (!eligible.length) return null;
  eligible.sort((a, b) => (b[1].positive / b[1].resolved) - (a[1].positive / a[1].resolved));
  const [value, b] = eligible[0];
  return { value, resolved: b.resolved, positive: b.positive, rate: +(b.positive / b.resolved).toFixed(3) };
}

function aggregate() {
  ensureDir();
  const apps = collapse(readTable());
  const resolvedCount = apps.filter((a) => RESOLVED.has(a.outcome)).length;
  const dims = {
    track: tallyBy(apps, (a) => a.track),
    cv_set: tallyBy(apps, (a) => a.variant && a.variant.cv_set),
    letter_pattern: tallyBy(apps, (a) => a.variant && a.variant.letter_pattern),
    fit_band: tallyBy(apps, (a) => a.variant && a.variant.fit_band),
    city: tallyBy(apps, (a) => a.variant && a.variant.city),
  };
  const winners = {};
  for (const [dim, tally] of Object.entries(dims)) winners[dim] = pickWinner(tally);
  const anyWinner = Object.values(winners).some(Boolean);

  // 60-day window status (honesty rail)
  const firstDate = apps.map((a) => a.date_applied).filter(Boolean).sort()[0] || today();
  const daysIn = Math.round((Date.parse(today()) - Date.parse(firstDate)) / 86400000);
  const windowStatus = daysIn >= MEASURE_DAYS
    ? (anyWinner ? 'measured: winner(s) declared' : `measured: ${MEASURE_DAYS}d elapsed, still no variant hit ${MIN_RESOLVED} resolved -> SHRINK candidate`)
    : (anyWinner ? `early winner(s) present; 60-day measurement continues (day ${daysIn}/${MEASURE_DAYS})` : `accumulating: day ${daysIn}/${MEASURE_DAYS}`);

  const meta = { generated: new Date().toISOString(), applications: apps.length, resolved: resolvedCount, min_resolved: MIN_RESOLVED, first_application: firstDate, days_in_window: daysIn, window_status: windowStatus };
  fs.writeFileSync(WINNERS, JSON.stringify({ meta, winners, dims }, null, 2), 'utf8');
  fs.writeFileSync(SECTION, renderSection(meta, winners, dims), 'utf8');
  writeReadyBlock(meta, winners);

  console.log(`outcome-loop: ${apps.length} applications, ${resolvedCount} resolved. ${windowStatus}.`);
  if (anyWinner) for (const [dim, w] of Object.entries(winners)) if (w) console.log(`  winner[${dim}] = ${w.value} (${w.positive}/${w.resolved} = ${(w.rate * 100).toFixed(0)}%)`);
  else console.log('  no winner yet - insufficient signal (loop accumulating, fabricating nothing).');
  console.log(`  -> ${path.relative(REPO, WINNERS)} , ${path.relative(REPO, SECTION)}`);
}

// --- the #10 "Outcomes" section, written as DECISIONS not a dashboard --------------------------------
function renderSection(meta, winners, dims) {
  let md = `## Outcomes (what actually worked)\n\n`;
  md += `_Generated ${meta.generated.slice(0, 16).replace('T', ' ')} by the zero-token outcome loop from ${meta.applications} applications (${meta.resolved} resolved). ${meta.window_status}._\n\n`;
  if (meta.resolved < MIN_RESOLVED) {
    md += `**No decisions yet — the loop is accumulating.** ${meta.resolved} of ${meta.applications} applications have a resolved outcome; a variant needs ${MIN_RESOLVED} resolved before it earns a call. Fabricating a winner from thin signal is exactly what this loop refuses to do. Day ${meta.days_in_window}/${MEASURE_DAYS} of the measurement window.\n`;
    return md;
  }
  const anyWinner = Object.values(winners).some(Boolean);
  if (!anyWinner) {
    md += `${meta.resolved} resolved outcomes, but no single variant value has cleared ${MIN_RESOLVED} resolved yet. No decision this week; keep applying, keep resolving.\n`;
    return md;
  }
  md += `**Decisions (what the writers should lean into next cycle):**\n`;
  const label = { track: 'Track', cv_set: 'CV set', letter_pattern: 'Letter pattern', fit_band: 'Fit band', city: 'City' };
  for (const [dim, w] of Object.entries(winners)) {
    if (!w) continue;
    md += `- **${label[dim] || dim}: \`${w.value}\`** earned responses at ${(w.rate * 100).toFixed(0)}% (${w.positive}/${w.resolved} resolved). Favor it.\n`;
  }
  // name the clear silences too (a value with resolved>=MIN and zero positives)
  const silences = [];
  for (const [dim, tally] of Object.entries(dims)) for (const [val, b] of Object.entries(tally)) if (b.resolved >= MIN_RESOLVED && b.positive === 0) silences.push(`\`${val}\` (${label[dim] || dim})`);
  if (silences.length) md += `- **Silence:** ${silences.join(', ')} drew nothing across ${MIN_RESOLVED}+ resolved. Stop spending variants there or change the approach.\n`;
  return md;
}

// --- the built-ready writer block (component 6.3.4), OFF until the 60-day gate + a real winner -------
// Renders the block the generator would inject into the n8n Build Writer Request nodes (mirrors the
// SOUL_VOICE marker + read-back pattern of sync-n8n-voice.js). It is written to a file, NOT pushed to
// live n8n here: with zero winners today, injecting an empty block into production is pointless and
// risky. Activation trigger is documented in the plan and the #03 spec.
function writeReadyBlock(meta, winners) {
  const day = today();
  const lines = [`<<<OUTCOME_WINNERS_START synced ${day} from the outcome loop - do not hand-edit, re-run scripts/alex-outcome-loop.js>>>`];
  const active = Object.entries(winners).filter(([, w]) => w);
  if (meta.resolved < MIN_RESOLVED || !active.length) {
    lines.push('# (no winning patterns yet - outcome loop still accumulating; this block is intentionally empty)');
  } else {
    lines.push('# Outcome-proven patterns (from real application results, favor these where truthful):');
    for (const [dim, w] of active) lines.push(`# - ${dim}: ${w.value} (${(w.rate * 100).toFixed(0)}% response across ${w.resolved} resolved)`);
    lines.push('# Guidance stays truthful: lean toward proven patterns, never fabricate to match one.');
  }
  lines.push('<<<OUTCOME_WINNERS_END>>>');
  fs.mkdirSync(path.dirname(READY_BLOCK), { recursive: true });
  fs.writeFileSync(READY_BLOCK, lines.join('\n') + '\n', 'utf8');
}

function cmdStatus() {
  const apps = collapse(readTable());
  const resolved = apps.filter((a) => RESOLVED.has(a.outcome)).length;
  const first = apps.map((a) => a.date_applied).filter(Boolean).sort()[0] || '(none)';
  console.log(`outcome-loop status: ${apps.length} applications, ${resolved} resolved, first ${first}.`);
  console.log(`table: ${fs.existsSync(TABLE) ? path.relative(REPO, TABLE) : '(not created yet)'}`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'add') return cmdAdd(rest);
  if (cmd === 'ingest-sheet') return cmdIngestSheet(rest[0]);
  if (cmd === 'status') return cmdStatus();
  if (cmd && cmd !== 'aggregate') { console.error(`unknown command '${cmd}' (add | ingest-sheet | status | <none>)`); process.exit(1); }
  aggregate();
}

main();

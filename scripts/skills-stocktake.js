#!/usr/bin/env node
'use strict';
/*
 * scripts/skills-stocktake.js - the deterministic half of the quarterly skill review. (P5.2, run-47.)
 *
 * SPLIT ON PURPOSE. This script COUNTS and never judges: it assembles every fact about the 85
 * installed skills (binding strength, parked state, provenance anchor, size, age, and now real usage
 * from P5.1's telemetry) into one table. The judging half is ONE model pass over that table,
 * returning Keep / Improve / Retire / Merge-into per skill. Splitting them means the expensive half
 * reads a small table instead of 85 files, and the cheap half is reproducible and free.
 *
 * ECC's skill-stocktake supplied two ideas worth taking. Its VERDICT SET (Keep/Improve/Update/Retire/
 * Merge) and, better, its REASON-QUALITY RULE: a bare label like "unchanged" or "superseded" is
 * banned, every verdict must restate the evidence it rests on. That rule is worth more than the
 * verdicts, and it generalizes to any checker that writes a human-read reason field.
 * Its Quick-Scan cache (re-evaluate only what changed since last time) is implemented here as
 * --since, comparing against the previous results file.
 *
 * REMOVAL IS NEVER AUTOMATIC. Auto-install was approved 2026-07-11; auto-REMOVE never was. This
 * prints proposals. Zero dependencies, zero model tokens.
 *
 *   node scripts/skills-stocktake.js            # the table
 *   node scripts/skills-stocktake.js --json     # machine-readable, for the judging pass
 *   node scripts/skills-stocktake.js --since    # only rows that changed since the last run
 */
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const LOCK = path.join(REPO, 'skills-lock.json');
const SKILLS_DIR = path.join(REPO, '.agents', 'skills');
const USAGE = path.join(REPO, 'system', 'skill-usage.jsonl');
const CLAUDE_MD = path.join(REPO, 'CLAUDE.md');
const RESULTS = path.join(REPO, 'system', 'skills-stocktake.json');

const JSON_OUT = process.argv.includes('--json');
const SINCE = process.argv.includes('--since');

const splitLines = (text) => String(text).split(/\r?\n/);

function usageCounts() {
  const counts = new Map();
  if (!fs.existsSync(USAGE)) return counts;
  const cutoff90 = Date.now() - 90 * 864e5;
  for (const line of fs.readFileSync(USAGE, 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      if (!r.skill) continue;
      const t = Date.parse(r.ts);
      const c = counts.get(r.skill) || { total: 0, d90: 0, last: null };
      c.total++;
      if (t >= cutoff90) c.d90++;
      if (!c.last || t > Date.parse(c.last)) c.last = r.ts;
      counts.set(r.skill, c);
    } catch (_) { /* skip a bad row */ }
  }
  return counts;
}

/* MANDATORY bindings are the one class that must never be retired on usage grounds: a skill bound
 * MANDATORY is consulted because a rule says so, and low usage means the task type was rare, not that
 * the binding is wrong. V17 already fails the build if a MANDATORY skill is parked; this keeps the
 * stocktake from proposing what V17 would then reject. */
function mandatorySkills() {
  const set = new Set();
  try {
    const md = fs.readFileSync(CLAUDE_MD, 'utf8');
    for (const line of md.split('\n')) {
      if (!/\|\s*MANDATORY\s*\|?\s*$/i.test(line)) continue;
      for (const m of line.matchAll(/`?\b([a-z0-9][a-z0-9-]{2,})\b`?/gi)) {
        const w = m[1].toLowerCase();
        if (fs.existsSync(path.join(SKILLS_DIR, w))) set.add(w);
      }
    }
  } catch (_) { /* no CLAUDE.md is not fatal here */ }
  return set;
}

/*
 * How many days of usage data actually exist. This guards the single most dangerous number in the
 * table: "never used" means "never MEASURED" until the telemetry has run for a real period, and
 * those are different claims. Retiring a skill because a five-minute-old counter says zero would be
 * the file-bloat lesson repeated - a decision made against an unmeasured set, wearing a number.
 */
function telemetryAgeDays() {
  if (!fs.existsSync(USAGE)) return 0;
  let oldest = null;
  try {
    for (const line of splitLines(fs.readFileSync(USAGE, 'utf8'))) {
      if (!line) continue;
      const t2 = Date.parse(JSON.parse(line).ts);
      if (!Number.isNaN(t2) && (oldest === null || t2 < oldest)) oldest = t2;
    }
  } catch (_) { return 0; }
  if (oldest === null) return 0;
  return Math.floor((Date.now() - oldest) / 864e5);
}

function main() {
  const lock = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
  const skills = lock.skills || {};
  const usage = usageCounts();
  const mandatory = mandatorySkills();
  const rows = [];

  for (const name of Object.keys(skills).sort()) {
    const e = skills[name];
    const dir = path.join(SKILLS_DIR, name);
    let bytes = 0; let mtime = null;
    try {
      const sk = path.join(dir, 'SKILL.md');
      if (fs.existsSync(sk)) { const st = fs.statSync(sk); bytes = st.size; mtime = st.mtime.toISOString().slice(0, 10); }
    } catch (_) { /* missing on disk is itself a finding, recorded below */ }
    const u = usage.get(name) || { total: 0, d90: 0, last: null };
    rows.push({
      name,
      source: e.source || null,
      binding: mandatory.has(name) ? 'MANDATORY' : 'advisory',
      parked: !!e.parked,
      onDisk: fs.existsSync(dir),
      provenance: e.sourceCommit ? 'audited-pin' : (e.sourceCommitBackfilled ? 'backfilled' : 'none'),
      bytes,
      mtime,
      uses_total: u.total,
      uses_90d: u.d90,
      last_used: u.last,
    });
  }

  // Quick Scan: only what moved since the last stocktake.
  let out = rows;
  if (SINCE && fs.existsSync(RESULTS)) {
    try {
      const prev = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
      const byName = new Map((prev.rows || []).map((r) => [r.name, r]));
      out = rows.filter((r) => JSON.stringify(r) !== JSON.stringify(byName.get(r.name)));
    } catch (_) { /* unreadable cache = full scan, never a silent empty one */ }
  }

  const summary = {
    generated: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    total: rows.length,
    parked: rows.filter((r) => r.parked).length,
    mandatory: rows.filter((r) => r.binding === 'MANDATORY').length,
    never_used: rows.filter((r) => r.uses_total === 0).length,
    missing_on_disk: rows.filter((r) => !r.onDisk).length,
    no_provenance: rows.filter((r) => r.provenance === 'none').length,
    usage_data_days: telemetryAgeDays(),
    rows,
  };

  try {
    fs.mkdirSync(path.dirname(RESULTS), { recursive: true });
    fs.writeFileSync(RESULTS, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  } catch (_) { /* cache write is best-effort */ }

  if (JSON_OUT) { console.log(JSON.stringify({ ...summary, rows: out }, null, 2)); return 0; }

  console.log(`skills stocktake: ${summary.total} installed, ${summary.parked} parked, ${summary.mandatory} MANDATORY-bound`);
  console.log(`  never used: ${summary.never_used}   no provenance anchor: ${summary.no_provenance}   missing on disk: ${summary.missing_on_disk}`);
  const MIN_WINDOW_DAYS = 30;
  if (summary.usage_data_days < MIN_WINDOW_DAYS) {
    console.log(`  USAGE TELEMETRY IS ${summary.usage_data_days} DAY(S) OLD (needs ${MIN_WINDOW_DAYS}+ to mean anything).`);
    console.log('  So "never used" here means "never MEASURED", not "unused". Do NOT retire or park on');
    console.log('  usage grounds from this run: that would be a decision against an unmeasured set,');
    console.log('  wearing a number. Every other column is valid today.');
  }
  console.log(`\n  ${'skill'.padEnd(28)} ${'bind'.padEnd(10)} ${'park'.padEnd(5)} ${'prov'.padEnd(11)} ${'90d'.padEnd(4)} bytes`);
  for (const r of out) {
    console.log(`  ${r.name.padEnd(28)} ${r.binding.padEnd(10)} ${(r.parked ? 'yes' : 'no').padEnd(5)} ${r.provenance.padEnd(11)} ${String(r.uses_90d).padEnd(4)} ${r.bytes}`);
  }
  console.log(`\n${out.length} row(s) shown${SINCE ? ' (changed since last run)' : ''}. Cache: ${path.relative(REPO, RESULTS)}`);
  console.log('Judging pass (one model call) returns Keep / Improve / Retire / Merge-into per row.');
  console.log('REASON-QUALITY RULE: a bare label is not a verdict. Every verdict restates the evidence it rests on.');
  console.log('Removal is never automatic: this proposes, Shaheen decides.');
  return 0;
}

process.exit(main());

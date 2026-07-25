#!/usr/bin/env node
/*
 * health-grade.js - per-stream data-quality grading for the health tracker (#17 Phase 1, 2026-07-25).
 *
 * The lesson it generalizes: the ingest once fabricated a 38/100 sleep score from empty HealthKit data
 * (the phantom-reading bug). The fix was a per-metric phantom guard; this GENERALIZES that guard to
 * EVERY stream and makes the score output "insufficient data" HONESTLY instead of any number when the
 * inputs don't support one. Deterministic, zero Claude calls, server-side-portable (the n8n "Score +
 * Normalize" Code node inlines gradeDay; scripts/backfill_health.py mirrors it - keep the three in sync
 * like the score formula already is).
 *
 * A stream is graded:
 *   complete - present and plausible; safe to use.
 *   partial  - present but thin (e.g. sleep duration exists but stage breakdown is missing) - usable for
 *              some components, not others.
 *   phantom  - missing or a zero that almost certainly means a failed read (the HealthKit-empty case),
 *              NOT a real zero. Never fed to the score as a value.
 *
 * The score gate: the Alex Sleep Score is only emitted when Duration is complete AND at least two of
 * {Efficiency, Deep, REM} are usable. Otherwise sleep_score = null with a stated reason. The graceful
 * component-drop-and-rescale still runs on top of that, but it can no longer manufacture a number from a
 * single thin stream.
 */
'use strict';

// sufficiency floors (tunable, mirrored in the n8n node + backfill)
const REAL_NIGHT_MIN = 180;   // < 3h asleep for a full night is treated as thin, not a real main sleep
const MAX_STEPS = 120000;     // above this is a sensor glitch, not a real day

function num(v) { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

// grade one day's streams. Returns { grades, sleep_score_ok, reason, steps_ok }.
function gradeDay(row) {
  const steps = num(row.steps);
  const asleep = num(row.asleep_min);
  const inbed = num(row.inbed_min);
  const deep = num(row.deep_min);
  const rem = num(row.rem_min);
  const awakenings = row.awakenings === '' || row.awakenings == null ? null : num(row.awakenings);

  const grades = {};

  // steps: missing or 0 for a whole day is almost always a failed read (phantom), not a rest day.
  grades.steps = steps == null || steps === 0 ? 'phantom'
    : steps > MAX_STEPS ? 'phantom'
    : 'complete';

  // sleep duration: the spine of the score.
  grades.sleep_duration = asleep == null || asleep === 0 ? 'phantom'
    : asleep < REAL_NIGHT_MIN ? 'partial'
    : 'complete';

  // efficiency needs both in-bed and asleep.
  grades.sleep_efficiency = (inbed == null || inbed === 0 || asleep == null || asleep === 0) ? 'phantom'
    : (inbed < asleep ? 'partial' : 'complete');

  // stage %s need the stage minutes AND a real asleep denominator.
  grades.sleep_deep = (deep == null || asleep == null || asleep === 0) ? 'phantom' : 'complete';
  grades.sleep_rem = (rem == null || asleep == null || asleep === 0) ? 'phantom' : 'complete';

  // restfulness: awakenings present (0 is a valid real value; null/'' is missing).
  grades.restfulness = awakenings == null ? 'phantom' : 'complete';

  // the score gate
  const durationOk = grades.sleep_duration === 'complete';
  const usable = ['sleep_efficiency', 'sleep_deep', 'sleep_rem'].filter(k => grades[k] === 'complete').length;
  const sleep_score_ok = durationOk && usable >= 2;
  const reason = sleep_score_ok ? null
    : !durationOk ? `insufficient data: sleep duration is ${grades.sleep_duration} (need a real night to score)`
    : `insufficient data: only ${usable} of Efficiency/Deep/REM usable (need >=2 to score)`;

  return { grades, sleep_score_ok, reason, steps_ok: grades.steps === 'complete' };
}

module.exports = { gradeDay, REAL_NIGHT_MIN, MAX_STEPS };

// CLI: pipe a day JSON or an array; prints grades (for tests + a quick eyeball).
if (require.main === module) {
  const fs = require('fs');
  let raw = '';
  try { raw = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : fs.readFileSync(0, 'utf8'); }
  catch (_) { console.error('usage: health-grade.js [file.json]  (or pipe JSON)'); process.exit(1); }
  let data; try { data = JSON.parse(raw); } catch (_) { console.error('input is not valid JSON'); process.exit(1); }
  const rows = Array.isArray(data) ? data : (data.days || [data]);
  for (const r of rows) {
    const g = gradeDay(r);
    console.log(JSON.stringify({ date: r.date, ...g }));
  }
}

// work/18-recovery-layer/lib/trigger-times.mjs - when does a scheduled job ACTUALLY fire?
//
// C7b's job since 2026-07-25 (stress-test fix F-05): compare the live trigger HOUR against the hour
// scheduler/schedule.md documents, so a job whose time was hand-edited or mangled by a re-creation
// cannot fire at the wrong hour forever while every surface reads green.
//
// Stress-test A05-T17 (2026-09-09, FAIL High): C7b had been dead on this machine since 2026-08-28.
// The rewire that day taught C7 to read `schtasks` and set `schedulerReadable = true`, which also
// opened the gate into C7b - but C7b still asked SYSTEMD for the times. On win32 that spawn returns
// ENOENT, `String(stdout || '')` is the empty string, zero OnCalendar matches, and the leg `continue`d
// on all 23 jobs. The 09-09 sweep wrote 0 scheduler-time rows under a header that said 25 drift items,
// which is the shape this whole layer exists to kill: a check that reports PASS while covering nothing.
// It is the F-05 class reopened by a platform move, exactly as the 07-25 fix warned.
//
// Two rules learned from that failure and encoded here:
//   1. UNREADABLE IS DRIFT, NEVER A SKIP. A job with a documented clock whose live time cannot be read
//      is reported. The old leg's `continue` is what made the death invisible.
//   2. THE COMPARED COUNT IS SAID OUT LOUD. A zero has to be visible in the sweep output, because
//      "0 scheduler-time findings" and "0 jobs actually compared" printed identically before.
//
// Pure: XML text in, times out. No I/O, so the negative test runs on synthetic tasks and never has to
// register a real one on the live scheduler.

// A Task Scheduler <StartBoundary> is an ISO-8601 local time, optionally carrying an explicit UTC
// offset (`+02:00`) or `Z`. The two are NOT the same promise and the difference is a real defect
// class: a bare local boundary floats with the machine clock and keeps its wall-clock hour across a
// DST change, while an offset-anchored one keeps its INSTANT and so shifts an hour on 10-25
// (A05-T13; 11 of this box's triggers are offset-anchored). So resolve an anchored boundary to the
// local wall-clock time it fires at TODAY, which is the honest answer to "when does this run", and
// report the anchoring alongside it so the caller can say which kind it compared.
const BOUNDARY_RE = /<StartBoundary>\s*([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?)\s*(Z|[+-][0-9]{2}:[0-9]{2})?\s*<\/StartBoundary>/gi;

const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/**
 * Every trigger time a task XML declares, as local wall-clock HH:MM.
 * @param {string} xml   the task definition (schtasks /query /tn <job> /xml ONE)
 * @param {Date}   [now] reference date for resolving an offset-anchored boundary (test seam)
 * @returns {{times: string[], anchoring: string[], parsed: number}}
 */
export function triggerTimesFromTaskXml(xml, now = new Date()) {
  const text = String(xml || '');
  const times = [];
  const anchoring = [];
  let parsed = 0;
  for (const m of text.matchAll(BOUNDARY_RE)) {
    const [, stamp, offset] = m;
    parsed++;
    if (!offset) {
      // Bare local boundary: the wall-clock hour IS the promise, take it literally.
      const t = /T([0-9]{2}):([0-9]{2})/.exec(stamp);
      if (!t) continue;
      times.push(hhmm(parseInt(t[1], 10), parseInt(t[2], 10)));
      anchoring.push('local');
      continue;
    }
    // Offset-anchored: the trigger keeps its INSTANT, so what moves is the local wall-clock hour it
    // lands on. Resolve it through UTC-time-of-day on the REFERENCE date - not through the boundary
    // date's own local hour, which would return the hour it fired the day it was created and hide the
    // very shift this branch exists to expose (caught by the 09-10 negative test: a July-created
    // 08:00+02:00 boundary returned 08:00 for November too, when it actually fires at 07:00 there).
    const d = new Date(`${stamp}${offset}`);
    if (Number.isNaN(d.getTime())) continue;
    const ref = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), d.getUTCHours(), d.getUTCMinutes()));
    times.push(hhmm(ref.getHours(), ref.getMinutes()));
    anchoring.push('offset');
  }
  return { times: [...new Set(times)], anchoring: [...new Set(anchoring)], parsed };
}

/**
 * Compare one job's live trigger times against its documented time.
 * Returns null when they agree, or a drift MESSAGE when they do not - including the unreadable case,
 * which is drift and not a skip (rule 1 above).
 *
 * @param {object} a
 * @param {string} a.job        task name
 * @param {string} a.want       documented HH:MM (from the '- Frequency:' line)
 * @param {string|null} a.xml   task XML, or null when the read failed
 * @param {string} [a.readError] why the read failed, if it did
 * @param {Date} [a.now]
 */
export function triggerTimeDrift({ job, want, xml, readError, now = new Date() }) {
  if (xml === null || xml === undefined) {
    return `'${job}' documents ${want} but its live trigger time could NOT be read` +
      `${readError ? ` (${readError})` : ''} - recorded as drift, not skipped: an unreadable trigger is exactly how C7b died silently on this platform for 12 days (A05-T17)`;
  }
  const { times, anchoring, parsed } = triggerTimesFromTaskXml(xml, now);
  if (times.length === 0) {
    return `'${job}' documents ${want} but its task definition declares no parseable StartBoundary` +
      `${parsed ? ` (${parsed} boundary element(s) present but unreadable)` : ''} - a job with a documented clock and no readable trigger is drift`;
  }
  if (times.includes(want)) return null;
  const anchorNote = anchoring.includes('offset')
    ? ` [offset-anchored trigger, resolved to local time: this one SHIFTS an hour at a DST change, a bare local boundary does not]`
    : '';
  return `'${job}' fires at ${times.join('/')} but scheduler/schedule.md documents ${want}${anchorNote} (retime the task, or correct the doc - a wrong hour runs the job at the wrong time silently)`;
}

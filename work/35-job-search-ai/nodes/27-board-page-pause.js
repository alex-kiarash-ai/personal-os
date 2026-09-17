'use strict';
/*
 * 27-board-page-pause.js - three seconds between cursor pages. The only reason this node exists is
 * that n8n's HTTP Request node cannot pace ACROSS runs, only within one.
 *
 * WHERE IT SITS (the file number is 27 only because 01 to 22 were taken):
 *   More Board Pages? [out0] -> Board Page Pause -> Fetch Board
 *
 * THE MEASUREMENT BEHIND IT. `Fetch Board` carries batching {batchSize 1, batchInterval 2000}, and
 * the node sleeps only when itemIndex > 0 inside a single execution. Pass one carries six board
 * units and gets five sleeps, ten seconds, properly spaced across six different hosts. Every pass
 * after that carries exactly ONE item, the next cursor page, so itemIndex is 0 and the interval
 * never fires. Without this node a dozen cursor pages would go to ONE small free service back to
 * back with no gap, which is the only burst shape this lane can produce.
 *
 * THREE SECONDS, and why not more or less. The contract's rate note for the paged source says "no
 * published number, the site 429s when abused, keep to a handful of calls per run". Three seconds
 * makes a twelve page run take about 36 seconds of extra wall clock on an unattended 06:30 job,
 * which costs nothing, and it puts the request rate below anything a human browsing the site would
 * produce. It is not tuned to a published limit because there is no published limit to tune to; it
 * is deliberately generous for that exact reason.
 *
 * `unit: 'seconds'` IS WRITTEN OUT, and this is the lesson node 12 paid for. The three Wait nodes
 * already on this box store {"amount": 20} with NO unit key, because n8n omits defaults, so reading
 * a live Wait node tells you nothing about its unit. Trusting the default would put a 3 HOUR sleep
 * one wrong assumption away inside a weekday job, and the symptom would be a run that never
 * finishes. The value is asserted here rather than remembered.
 *
 * UNDER n8n's 65 SECOND IN-MEMORY THRESHOLD, deliberately. n8n's Wait node docs: "For wait times
 * less than 65 seconds, the workflow does not offload execution data to the database." Three seconds
 * keeps the whole loop in one process, which matters because the two page guards replay previous
 * runs of the fetch node through $("node").all(0, runIndex) and that reads the in-memory run data.
 */

const SECONDS = 3;
const N8N_IN_MEMORY_THRESHOLD_SECONDS = 65;

(function assertTheNumber() {
  if (!Number.isFinite(SECONDS) || SECONDS < 1) {
    throw new Error('Board Page Pause: the pause is ' + SECONDS + ' second(s). A pause below one second is not pacing, it is decoration.');
  }
  if (SECONDS >= N8N_IN_MEMORY_THRESHOLD_SECONDS) {
    throw new Error(
      'Board Page Pause: ' + SECONDS + ' seconds is at or above n8n\'s ' + N8N_IN_MEMORY_THRESHOLD_SECONDS +
      ' second in-memory threshold, so the execution would offload to the database between passes. Both page\n' +
      '  guards replay earlier runs of their fetch node out of the run data, so that is not a performance\n' +
      '  question, it is a correctness one.'
    );
  }
}());

module.exports = {
  name: 'Board Page Pause',
  type: 'n8n-nodes-base.wait',
  typeVersion: 1.1,
  position: [1690, 620],
  connectFrom: 'More Board Pages?',
  outputIndex: 0,
  notes: SECONDS + ' seconds between cursor pages. Fetch Board can only pace between items inside one run, and every pass after the first carries a single item, so without this node consecutive cursor pages would hit one host with no gap at all.',
  parameters: {
    amount: SECONDS,
    unit: 'seconds',
  },
};

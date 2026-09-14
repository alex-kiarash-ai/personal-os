'use strict';
/*
 * 12-wait-indeed.js - 60 seconds between snapshot polls.
 *
 * THE UNIT IS WRITTEN OUT EXPLICITLY AND THAT IS THE WHOLE POINT OF THIS FILE. n8n's Wait node
 * stores only non-default values, and the three Wait nodes already on this box carry `{"amount":20}`
 * and `{"amount":60}` with no `unit` key at all. So reading them tells you nothing about what unit
 * those numbers are in: it only tells you the unit equals whatever the default is. Shipping
 * `{amount: 60}` and trusting that the default is seconds would put a 60 HOUR sleep one wrong
 * assumption away, inside an unattended weekday job, where the symptom would be a run that simply
 * never finishes and never reports. `unit: 'seconds'` costs one key and removes the question.
 *
 * WHY 60 SECONDS AND NOT 30 OR 120. Two constraints meet here.
 *   Upper: n8n keeps a wait of LESS THAN 65 SECONDS in memory and does not offload the execution to
 *   the database ("For wait times less than 65 seconds, the workflow does not offload execution data
 *   to the database", n8n's own Wait node documentation). Past that line every poll becomes a
 *   database write plus a reload, and the loop turns into a stream of persisted resumptions for a
 *   job that only wants to sleep. 60 keeps the whole loop in one process with 5 seconds of headroom.
 *   Lower: a Bright Data snapshot takes minutes, not seconds. Polling every 10 seconds would spend
 *   six times the requests to learn the same thing.
 *
 * THIS NODE HAS TWO INPUTS AND THAT IS THE LOOP. `Start Indeed Search` feeds it once, at the top.
 * `Keep Polling?` feeds it again on every pass that did not finish. Both arrive on output 0 of their
 * respective nodes, which is what lets build.js express the cycle: its node contract carries ONE
 * outputIndex per node, shared by every entry in connectFrom, so a back edge is only expressible
 * when both sources use the same output number. That is not a coincidence, it is why `Keep Polling?`
 * is phrased as "keep polling" with the loop on output 0 rather than as "snapshot ready" with the
 * loop on output 1. See 15-keep-polling.js.
 *
 * A CONSEQUENCE WORTH KNOWING: because this node sits between the trigger and the first poll, a
 * trigger that failed outright still costs one 60 second sleep before anything notices. The
 * alternative was a routing node on the path of every single run to save 60 seconds on the rare dead
 * account path. Indeed Poll Guard reads the TRIGGER response before it reads the snapshot response
 * precisely so that the diagnosis is still right when that happens: it says the trigger failed, not
 * that the snapshot is missing.
 */

const WAIT_SECONDS = 60;

// n8n keeps a wait under this threshold in process. Crossing it changes the execution model of the
// whole loop, so it is asserted rather than remembered.
const IN_MEMORY_CEILING_SECONDS = 65;

(function assertWaitShape() {
  if (!(WAIT_SECONDS > 0)) {
    throw new Error('Wait 60s: the wait must be a positive number of seconds. A zero or negative wait turns the poll loop into a tight loop against a paid API.');
  }
  if (WAIT_SECONDS >= IN_MEMORY_CEILING_SECONDS) {
    throw new Error(
      'Wait 60s: ' + WAIT_SECONDS + ' seconds is at or above n8n\'s ' + IN_MEMORY_CEILING_SECONDS + ' second threshold,\n' +
      '  past which the execution is offloaded to the database and resumed rather than slept through.\n' +
      '  That is a different execution model for every poll in the loop. If the longer wait is wanted,\n' +
      '  raise this ceiling DELIBERATELY and re-read the guard: Indeed Poll Guard reaches back to\n' +
      '  $(\'Start Indeed Search\') and $(\'Plan Queries\') on every pass, and those reads are what a\n' +
      '  persisted resumption has to restore correctly.'
    );
  }
}());

module.exports = {
  name: 'Wait 60s',
  type: 'n8n-nodes-base.wait',
  typeVersion: 1.1,
  position: [2080, 320],
  // The loop. Start Indeed Search enters it once; Keep Polling? re-enters it on every unfinished
  // pass. Both on output 0, which is what makes the cycle expressible in build.js's node contract.
  connectFrom: ['Start Indeed Search', 'Keep Polling?'],
  outputIndex: 0,
  notes: 'Sleeps ' + WAIT_SECONDS + ' seconds between snapshot polls. The unit is set explicitly because n8n omits default values, so a stored {amount: 60} on this box does not tell you whether it means seconds or hours.',
  parameters: {
    amount: WAIT_SECONDS,
    unit: 'seconds',
  },
};

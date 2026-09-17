'use strict';
/*
 * 15-keep-polling.js - the router that closes the poll loop. One boolean, two outputs, no thinking.
 *
 * THIS NODE MAKES NO DECISION AND THAT IS DELIBERATE. Indeed Poll Guard already decided; it wrote the
 * answer to `poll.continue` and wrote down why in `poll.reason`. This node reads that one boolean.
 * Splitting it that way means the cap lives in exactly ONE place: there is no second condition here
 * that could disagree with the guard, and no path back into the loop that the guard did not approve.
 * A guard whose verdict can be overridden by the router downstream of it is not a guard.
 *
 * THE BRIEF CALLED THIS NODE `Snapshot Ready?` AND PUT IT BEFORE THE GUARD. Two things made that
 * shape wrong, and both are worth keeping written down.
 *   1. An IF on "status 200" sends every OTHER status round the loop, including the permanent ones.
 *      A lapsed Bright Data account answering 401 would be polled once a minute to the cap, so the
 *      exact failure this branch was asked to survive would cost ten minutes and then be reported as
 *      a timeout. Right verdict, wrong reason, and the wrong fix would follow from it.
 *   2. With the guard on the IF's false branch, the guard's only downstream is the Wait node. So on
 *      hitting the cap it would have nowhere to send a degraded report except back into the loop it
 *      was trying to stop. The brief asked for the report and the topology could not deliver it.
 * Inverting the question fixes both: the guard sees every response, and its give-up verdict leaves on
 * output 1 to the extractor like any other finished state.
 *
 * WHY THE QUESTION IS PHRASED "KEEP POLLING" AND NOT "SNAPSHOT READY", which looks cosmetic and is
 * not. build.js's node contract carries ONE outputIndex per node, shared by every name in its
 * connectFrom. `Wait 60s` has two sources: `Start Indeed Search` (which has one output, index 0) and
 * this node's loop branch. The back edge is therefore only expressible if the loop leaves on output
 * 0, which means the TRUE branch has to be the one that keeps polling. Phrasing the node as
 * "Snapshot Ready?" would put the loop on output 1 and make the cycle inexpressible without either
 * changing build.js or wiring the loop to the wrong branch. The name follows the wiring, so that
 * reading the canvas tells the truth.
 *
 * strict TYPE VALIDATION, for the third time in this workflow and for the sharpest reason yet. Under
 * `loose`, a missing or undefined `poll.continue` coerces to false, which routes to "finished" and
 * hands the extractor an item with no verdict on it. Under `strict` it stops the run. Given the
 * choice between a stopped run and a poll loop whose exit condition can be satisfied by a field that
 * does not exist, the stopped run is the only honest option.
 */

// A fixed literal, not a generated uuid: build.js supports --rebuild, and a fresh id per build would
// make the PUT body differ from the live workflow every time, so the read-back diff would show
// permanent churn and stop being a signal.
const CONDITION_ID = 'f2b81d47-5a06-4c93-8e71-3d5a90cb62f4';

// The guard is the only writer of this field, and this node is its only reader. Asserting the pair
// at build time is what stops a rename on one side from quietly turning the loop into a straight
// line (under strict validation) or an infinite one (if the default ever went the other way).
const GUARD = require('./14-indeed-poll-guard.js');
const FIELD = 'poll.continue';

(function assertGuardWritesTheField() {
  const code = GUARD.parameters.jsCode;
  if (!/\bcontinue:\s*verdict\.done !== true/.test(code)) {
    throw new Error(
      'Keep Polling?: 14-indeed-poll-guard.js no longer writes `continue` from its own done verdict.\n' +
      '  This node routes the poll loop on $json.' + FIELD + ' and on nothing else. If the guard stopped\n' +
      '  writing it, every pass would read undefined: strict type validation turns that into a stopped\n' +
      '  run, which is loud, but the reason would point here instead of at the guard.'
    );
  }
  if (!/\bdone:\s*verdict\.done === true/.test(code)) {
    throw new Error('Keep Polling?: 14-indeed-poll-guard.js no longer writes `poll.done`. done and continue are the same decision written twice, once for routing and once for the report, and they have to stay opposites.');
  }
}());

module.exports = {
  name: 'Keep Polling?',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [2860, 320],
  connectFrom: 'Indeed Poll Guard',
  notes: 'Output 0 (true): poll again, back to Wait 60s. Output 1 (false): finished, hand the verdict to Extract Indeed Jobs. Reads only the boolean Indeed Poll Guard computed, so the cap lives in exactly one place.',
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: CONDITION_ID,
          leftValue: '={{ $json.poll.continue }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
};

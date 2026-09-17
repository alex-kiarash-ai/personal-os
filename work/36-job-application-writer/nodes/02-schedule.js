'use strict';
/*
 * 02-schedule.js - the weekday morning trigger, 07:15 Europe/Stockholm.
 *
 * THE CRON SHAPE IS A CONTRACT, NOT A STYLE CHOICE.
 * `rule.interval[0] = { field: 'cronExpression', expression: '<lane cron>' }` and nothing else.
 * Validator V6 leg (c) asserts the manifest's declared `n8n_cron` against the LIVE trigger, and its
 * liveCronsOf() can only derive a comparable string from a raw cronExpression or from a plain
 * every-1-day interval. Any other interval shape makes the declaration un-assertable: V6 drops from
 * FAILURE to a warning, and the contract then LOOKS checked while nothing checks it. build.js HARD
 * RULE 6 refuses any other shape, and it also refuses an expression that disagrees with the lane
 * file, so the three way agreement between this node, config/lane.json and system/manifest.json
 * n8n_cron is enforced rather than remembered.
 *
 * The expression is READ from the lane file for exactly that reason. Typing it here would create a
 * fourth place it could drift.
 *
 * WHY 07:15 AND NOT EARLIER. It sits 30 minutes behind #35 (06:45) and 45 behind #34 (06:30) so
 * both collectors have finished writing their jobs tab before this one reads it. That gap is the
 * ONLY coupling between the three workflows: there is no trigger chain and nothing signals
 * completion, so a collector that runs long just means this run reads yesterday's rows for that
 * lane. It is a quiet degradation rather than a failure, and the intake stage report names the
 * newest found_at it saw per lane so the gap is visible when it happens.
 *
 * Timezone is workflow level, not per rule: settings.timezone = Europe/Stockholm, set by build.js
 * from the lane file. A cron expression here carries no zone of its own, which also means the
 * DAILY CAP in Build Candidates has to resolve its own Stockholm date rather than trusting the
 * container clock.
 *
 * typeVersion 1.2 is what every scheduleTrigger on this box runs.
 */

const { lane } = require('./_lane');
const CRON = lane().cron;

module.exports = {
  name: 'Schedule Trigger',
  type: 'n8n-nodes-base.scheduleTrigger',
  typeVersion: 1.2,
  position: [0, 220],
  connectFrom: null,
  notes: 'Weekdays 07:15 Europe/Stockholm, behind both collectors. Raw cron expression on purpose: V6 leg (c) can only assert the declared n8n_cron against a raw cronExpression.',
  parameters: {
    rule: {
      interval: [
        { field: 'cronExpression', expression: CRON },
      ],
    },
  },
};

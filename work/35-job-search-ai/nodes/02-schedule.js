'use strict';
/*
 * 02-schedule.js - the weekday morning trigger.
 *
 * THE CRON SHAPE IS A CONTRACT, NOT A STYLE CHOICE.
 * `rule.interval[0] = { field: 'cronExpression', expression: '<lane cron>' }` and nothing else.
 * Validator V6 leg (c) asserts the manifest's declared `n8n_cron` against the LIVE trigger, and its
 * liveCronsOf() can only derive a comparable string from a raw cronExpression or from a plain
 * every-1-day interval. Any other interval shape (days, hours, weeks) makes the declaration
 * un-assertable: V6 drops from FAILURE to a warning, and the contract then LOOKS checked while
 * nothing checks it. That is worse than declaring nothing. build.js refuses any other shape, and
 * it also refuses an expression that disagrees with the lane file, so the three way agreement
 * between this node, config/lane.json and system/manifest.json `n8n_cron` is enforced rather than
 * remembered.
 *
 * The expression is READ from the lane file for exactly that reason. Typing it here would create a
 * fourth place it could drift, and would put #34's cron into a file #35 is meant to copy verbatim.
 *
 * Timezone is workflow level, not per rule: settings.timezone = Europe/Stockholm, set by build.js
 * from the lane file. A cron expression here carries no zone of its own.
 *
 * typeVersion 1.2 is what all seven scheduleTrigger nodes on this box run (read-only GET, 2026-09-11).
 */

const { lane } = require('./_lane');
const CRON = lane().cron;

module.exports = {
  name: 'Schedule Trigger',
  type: 'n8n-nodes-base.scheduleTrigger',
  typeVersion: 1.2,
  position: [0, 200],
  connectFrom: null,
  notes: 'Weekdays, Europe/Stockholm. Raw cron expression on purpose: V6 leg (c) can only assert the declared n8n_cron against a raw cronExpression.',
  parameters: {
    rule: {
      interval: [
        { field: 'cronExpression', expression: CRON },
      ],
    },
  },
};

'use strict';
/*
 * 02-build-target.js - bakes the approved values in, and nothing else.
 *
 * WHAT IS IN THE OUTPUT
 *   lanes[laneKey]    spreadsheet_id, tab, lane_number, title      (from the two lane.json files)
 *   targets[laneKey]  { settingsKey: encodedCellValue }            (from seed.json, ALLOWLIST applied)
 *   runtime_keys      the keys the pipeline owns and this sync never writes
 *   optional_keys     rows a human may legitimately have added by hand
 *
 * THE ALLOWLIST IS APPLIED HERE, AT BUILD TIME, not at run time. `targets` physically does not
 * contain `last_run_at`, so no run-time branch decides whether to skip it: there is nothing to skip.
 * 05-plan-changes.js still asserts the runtime keys are absent from the write set, because the
 * allowlist is the design and the assertion is what fires if someone later edits the design.
 *
 * The full reasoning for allowlist-over-denylist is in `_sync.js`. The short version: a denylist
 * fails open the day a second pipeline-written key appears, and this one fails closed.
 *
 * VALUES COME FROM config/seed.json AND config/lane.json AT BUILD TIME and are baked into jsCode,
 * because the n8n box cannot read this repo. Both those files are gitignored; this file is tracked
 * and public, so it carries the logic and none of the values. That is the same split `_seed.js` and
 * `_lane.js` already make in this lane.
 *
 * ONE ITEM OUT, deliberately. Returning one item per lane would make every downstream node run
 * twice, and the topology here is explicit per-lane nodes in a chain (Read BI, Read AI, Write BI,
 * Write AI). That exact mistake was proposed in a code review of the provisioner and rejected for
 * the same reason: it would have created four spreadsheets instead of two.
 */

const { loadSeed, loadLane, validateTargets, syncableSettings, RUNTIME_KEYS, KNOWN_OPTIONAL_KEYS } = require('./_sync');

const seed = validateTargets(loadSeed());

const lanes = {
  bi: loadLane('bi'),
  ai: loadLane('ai'),
};

// Build-time sanity: the lane NUMBER baked here is what the run-time lane guard compares against the
// `lane` cell on the sheet. If the two lane files ever carried the same number, the guard could not
// tell the two spreadsheets apart and a swapped id would pass every check.
if (lanes.bi.laneNumber === lanes.ai.laneNumber) {
  throw new Error('sync-settings: both lane files declare lane ' + lanes.bi.laneNumber + '. The lane guard cannot tell the two sheets apart.');
}
if (lanes.bi.id === lanes.ai.id) {
  throw new Error('sync-settings: both lane files point at the SAME spreadsheet id. One of them is wrong, and syncing would write the other lane profile over it.');
}
for (const laneKey of ['bi', 'ai']) {
  const declared = String(seed.lanes[laneKey].settings.lane);
  if (declared !== lanes[laneKey].laneNumber) {
    throw new Error(
      'sync-settings: seed.json lanes.' + laneKey + '.settings.lane is "' + declared + '" but that lane file says "' +
      lanes[laneKey].laneNumber + '". The sync would write a lane number that its own guard then rejects.'
    );
  }
}

const payload = {
  lanes: {
    bi: { key: 'bi', spreadsheet_id: lanes.bi.id, tab: lanes.bi.tab, lane_number: lanes.bi.laneNumber, title: lanes.bi.title },
    ai: { key: 'ai', spreadsheet_id: lanes.ai.id, tab: lanes.ai.tab, lane_number: lanes.ai.laneNumber, title: lanes.ai.title },
  },
  targets: {
    bi: syncableSettings(seed, 'bi'),
    ai: syncableSettings(seed, 'ai'),
  },
  runtime_keys: RUNTIME_KEYS,
  optional_keys: KNOWN_OPTIONAL_KEYS,
  // Which target keys are LISTS, taken from the shape of the seed value rather than from a second
  // hand-typed list. The report uses this to diff a list cell item by item instead of printing two
  // 300 character strings and leaving Shaheen to spot the difference. `readme` legitimately contains
  // a pipe and is NOT a list, which is exactly why this is derived and not guessed from the value.
  list_keys: Object.keys(seed.lanes.bi.settings).filter(k => Array.isArray(seed.lanes.bi.settings[k])),
};

const LOGIC = `
// The allowlist was applied at build time: TARGETS physically cannot contain a runtime key. This
// re-assertion costs nothing and turns a future editing mistake into a loud failure here rather than
// into a quietly clobbered last_run_at three nodes downstream.
for (const laneKey of Object.keys(TARGETS)) {
  for (const k of RUNTIME_KEYS) {
    if (Object.prototype.hasOwnProperty.call(TARGETS[laneKey], k)) {
      throw new Error(
        'sync: the target set for ' + laneKey + ' contains the RUNTIME key "' + k + '". ' +
        'That cell is written by the pipeline at the end of a successful run and is the basis of the ' +
        'search window. Syncing it would reset the window and silently re-collect a week of jobs.'
      );
    }
  }
  if (!Object.keys(TARGETS[laneKey]).length) {
    throw new Error('sync: the target set for ' + laneKey + ' is EMPTY, so this run would write nothing and report a healthy zero.');
  }
}

return [{
  json: {
    built_at: new Date().toISOString(),
    lanes: LANES,
    targets: TARGETS,
    runtime_keys: RUNTIME_KEYS,
    optional_keys: OPTIONAL_KEYS,
    list_keys: LIST_KEYS,
    target_key_count: {
      bi: Object.keys(TARGETS.bi).length,
      ai: Object.keys(TARGETS.ai).length,
    },
  },
}];
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/config/seed.json plus both lane.json files.',
  '// Edit those files, never this node. The allowlist (every settings key MINUS the runtime keys)',
  '// is already applied to TARGETS below.',
  `const LANES = ${JSON.stringify(payload.lanes)};`,
  `const TARGETS = ${JSON.stringify(payload.targets)};`,
  `const RUNTIME_KEYS = ${JSON.stringify(payload.runtime_keys)};`,
  `const OPTIONAL_KEYS = ${JSON.stringify(payload.optional_keys)};`,
  `const LIST_KEYS = ${JSON.stringify(payload.list_keys)};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Build Target Settings',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [220, 100],
  connectFrom: 'Manual Run',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

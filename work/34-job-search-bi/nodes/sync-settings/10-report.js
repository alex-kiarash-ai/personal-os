'use strict';
/*
 * 10-report.js - compares the sheet against what the plan said it would be, then reports.
 *
 * This is the half of Verify-after-write that actually decides. The verify nodes fetch; this one
 * asserts, cell by cell, against the SAME `expected` map the plan node built from the SAME parse of
 * the SAME before-read. A separately typed expectation can agree with itself and disagree with the
 * document, which is the failure the orchestrator wrote up on 2026-09-12: a check whose expected
 * value comes from the same place as the actual value cannot fail. Here the expected map comes from
 * the plan and the actual from Google, which are genuinely two sources.
 *
 * FIVE ASSERTIONS PER LANE. Each one catches a different way a cell-addressed write goes wrong:
 *
 *   1. EVERY SYNCED KEY holds its new value. The obvious one. Catches a write that did not land.
 *   2. EVERY PRESERVED KEY holds its OLD value, byte for byte, `last_run_at` included and named
 *      separately in the output. This is the one the whole design exists for. It catches a write
 *      that landed on the wrong row, which is invisible to check 1 because the cell it was aimed at
 *      can be correct while the cell one row down has been destroyed.
 *   3. THE KEY COLUMN is exactly the before order plus any appended keys, in order. Column A is only
 *      ever written for an APPENDED key, so any other movement in that column means a write went
 *      somewhere it was not aimed. Catches an off-by-one that happens to hit two keys with the same
 *      value.
 *   4. NO KEY APPEARED OR DISAPPEARED beyond the planned appends. A tab that grew a row nobody
 *      planned is a tab something else is writing to.
 *   5. THE TAB DID NOT SHRINK. Height is monotonic across a sync. A shorter tab is a truncating
 *      write, which is the shape that would quietly empty a filter.
 *
 * A single failure on either lane throws, and the message names the lane, the key, the row, what was
 * expected and what is there. A partial sync is reported as a FAILURE with the exact damage, never
 * as a success with a warning: half a settings tab reads as a working configuration and would filter
 * every future run against a list nobody chose.
 *
 * ON SUCCESS it prints the change log Shaheen actually reads: per lane, per key, old then new, with
 * list changes broken into the items that went and the items that arrived, because a 300 character
 * pipe-joined string next to another 300 character pipe-joined string is not a report.
 */

const { PARSE_TAB_LOGIC } = require('./_sync');

const LOGIC = `
const planned = $('Plan Changes').first().json;
const built = $('Build Target Settings').first().json;
const RUNTIME_KEYS = built.runtime_keys || [];
const VERIFY_NODE = { bi: 'Verify BI Settings', ai: 'Verify AI Settings' };

const pick = (node) => {
  try { const it = $(node).first(); return (it && it.json) || null; } catch (e) { return null; }
};

const problems = [];
const report = {};

for (const laneKey of ['bi', 'ai']) {
  const plan = planned[laneKey];
  if (!plan) { problems.push(laneKey + ': no plan was produced for this lane'); continue; }

  let after;
  try {
    after = parseTab(pick(VERIFY_NODE[laneKey]), laneKey + ' read-back');
  } catch (e) {
    problems.push(laneKey + ': ' + e.message);
    continue;
  }

  // 1 + 2. Every key the plan has an expectation for, synced and preserved alike.
  const expected = plan.expected;
  for (const key of Object.keys(expected)) {
    const rec = after.byKey[key];
    if (!rec) {
      problems.push(laneKey + ': key "' + key + '" is GONE from the tab after the write.');
      continue;
    }
    if (rec.value !== expected[key]) {
      const isPreserved = plan.preserved.some((p) => p.key === key);
      problems.push(
        laneKey + ' ' + (isPreserved ? 'PRESERVED ' : '') + 'key "' + key + '" at row ' + rec.row + ': expected ' +
        JSON.stringify(expected[key]) + ', sheet holds ' + JSON.stringify(rec.value) +
        (isPreserved ? '. This cell was NOT in the write set, so a write landed on the wrong row.' : '')
      );
    }
  }

  // 2b. The runtime keys, called out by name whatever the loop above found, because this is the one
  // guarantee the sync is built around and it should be visible in the output even when it holds.
  const runtime = {};
  for (const k of RUNTIME_KEYS) {
    const before = (plan.preserved.find((p) => p.key === k) || {}).value;
    const rec = after.byKey[k];
    runtime[k] = { before: before === undefined ? null : before, after: rec ? rec.value : null, preserved: !!rec && rec.value === before };
    if (!runtime[k].preserved) {
      problems.push(
        laneKey + ': RUNTIME key "' + k + '" was ' + JSON.stringify(before === undefined ? null : before) +
        ' before the sync and is ' + JSON.stringify(rec ? rec.value : null) + ' after it. The sync must never move this cell.'
      );
    }
  }

  // 3 + 4. The key column, exactly.
  const wantOrder = plan.expected_order;
  if (after.order.length !== wantOrder.length || after.order.some((k, i) => k !== wantOrder[i])) {
    const gained = after.order.filter((k) => wantOrder.indexOf(k) === -1);
    const lost = wantOrder.filter((k) => after.order.indexOf(k) === -1);
    problems.push(
      laneKey + ': the key column is not what the plan expected. ' +
      (gained.length ? 'Unplanned key(s): ' + JSON.stringify(gained) + '. ' : '') +
      (lost.length ? 'Missing key(s): ' + JSON.stringify(lost) + '. ' : '') +
      (!gained.length && !lost.length ? 'Same keys, different ORDER, which means a write moved a row. ' : '') +
      'expected ' + JSON.stringify(wantOrder) + ', got ' + JSON.stringify(after.order)
    );
  }

  // 5. Height is monotonic.
  const wantHeight = plan.before_height + plan.added.length;
  if (after.height < wantHeight) {
    problems.push(
      laneKey + ': the tab was ' + plan.before_height + ' row(s) and should be ' + wantHeight + ' after ' +
      plan.added.length + ' append(s), but it is ' + after.height + '. Rows were destroyed.'
    );
  }

  report[laneKey] = {
    spreadsheet_id: plan.lane.spreadsheet_id,
    title: plan.lane.title,
    tab: plan.lane.tab,
    cells_written: plan.cells_written,
    changed: plan.changed.map((c) => {
      const out = { key: c.key, row: c.row, old: c.old, new: c.new };
      if (c.items_removed || c.items_added) {
        out.items = c.items_before + ' -> ' + c.items_after;
        out.removed = c.items_removed;
        out.added = c.items_added;
      }
      return out;
    }),
    added_keys: plan.added.map((c) => ({ key: c.key, row: c.row, value: c.new })),
    unchanged_count: plan.unchanged_count,
    preserved: plan.preserved.map((p) => ({ key: p.key, row: p.row, value: p.value, why: p.why })),
    runtime: runtime,
  };
}

if (problems.length) {
  throw new Error(
    'sync: READ-BACK FAILED. The settings tabs do not hold what was written, so this run is NOT a ' +
    'successful sync whatever the write nodes returned.\\n' +
    '  - ' + problems.join('\\n  - ') + '\\n' +
    '  Fix the sheet or the plan and run this workflow again. It is idempotent: re-running writes the ' +
    'same cells to the same values.'
  );
}

const lines = [];
for (const laneKey of ['bi', 'ai']) {
  const r = report[laneKey];
  lines.push(laneKey.toUpperCase() + ' (' + r.title + '): ' + r.changed.length + ' changed, ' +
    r.added_keys.length + ' added, ' + r.unchanged_count + ' already correct, ' + r.preserved.length + ' preserved');
  for (const c of r.changed) {
    lines.push('  ' + c.key + (c.items ? '  ' + c.items + ' items' : '') +
      (c.removed && c.removed.length ? '  OUT: ' + c.removed.join(', ') : '') +
      (c.added && c.added.length ? '  IN: ' + c.added.join(', ') : '') +
      (c.items ? '' : '  ' + JSON.stringify(c.old) + ' -> ' + JSON.stringify(c.new)));
  }
  for (const k of Object.keys(r.runtime)) {
    lines.push('  ' + k + ' PRESERVED at ' + JSON.stringify(r.runtime[k].after));
  }
}

return [{
  json: {
    ok: true,
    synced_at: new Date().toISOString(),
    report_lines: lines,
    bi: report.bi,
    ai: report.ai,
    next: [
      'Nothing. This workflow is reusable: change work/34-job-search-bi/config/seed.json, rebuild it with build.js, and run it again.',
      'A settings change made by hand in the sheet is NOT written back to seed.json. The sheet wins at run time; seed.json wins the next time this sync runs.',
    ],
  },
}];
`;

const jsCode = [
  '// GENERATED at build time. The parse block below is shared VERBATIM with the Plan Changes node,',
  '// so the node that decided where to write and the node that checks the write landed read the',
  '// sheet the same way. Source: work/34-job-search-bi/nodes/sync-settings/_sync.js.',
  PARSE_TAB_LOGIC,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Report',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1980, 100],
  connectFrom: 'Verify AI Settings',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

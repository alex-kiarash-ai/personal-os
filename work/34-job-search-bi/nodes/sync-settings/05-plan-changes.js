'use strict';
/*
 * 05-plan-changes.js - the whole decision. Everything downstream of here is plumbing.
 *
 * IN:  the baked targets (02), and both settings tabs as they are RIGHT NOW (03, 04).
 * OUT: one item carrying, per lane, a values:batchUpdate body, a per-key change log, and the exact
 *      state the sheet is expected to be in afterwards.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IT WRITES, AND WHAT IT REFUSES TO WRITE
 * ---------------------------------------------------------------------------------------------
 * The write is CELL BY CELL, never a whole-tab overwrite. Each allowlisted key gets one ValueRange
 * addressed at its own row (settings!B12), so a cell this sync does not name cannot move. That is
 * the entire mechanism protecting `last_run_at` and any row a human added by hand. A range like
 * settings!A1 with the full block, which is what the provisioner used, would flatten all of it.
 *
 * It writes EVERY allowlisted key, not only the changed ones, and that is a deliberate choice over
 * a diff-driven write set:
 *   - the body is then a fixed, countable list, so the read-back knows exactly how many cells should
 *     match and a partial write is arithmetic rather than a judgement;
 *   - it cannot be defeated by a bug in the diff. A diff that wrongly reports "unchanged" silently
 *     skips a needed write, and every check downstream would still pass;
 *   - re-writing an identical value is a true no-op at RAW.
 * The change log is computed separately and is what the run report prints. Reporting and writing are
 * two jobs and they do not share a decision.
 *
 * ---------------------------------------------------------------------------------------------
 * THE FIVE REFUSALS. All of them throw BEFORE the first write node runs, and all of them are the
 * same class: a condition under which a write would land somewhere other than where it was aimed.
 * ---------------------------------------------------------------------------------------------
 * 1. HEADER. Row 1 must be key/value. Every row address is computed from that, so a shifted header
 *    means every write lands one row out, silently, into cells that all look plausible.
 * 2. DUPLICATE KEY. Two rows named `always_drop` means there is no such thing as "the always_drop
 *    row". Writing one of them leaves the other, and which one the pipeline reads is whichever the
 *    decoder hits first. Refused rather than guessed.
 * 3. THE LANE GUARD. The `lane` cell on the sheet must match the lane number baked from that lane's
 *    own lane.json. This is the one that matters most: with the two ids swapped, every other check
 *    in this workflow passes and the BI targeting lands in the AI spreadsheet. Stage A's Parse
 *    Settings carries the same guard for the same reason.
 * 4. A MISSING RUNTIME ROW. If `last_run_at` has no row, the sync refuses instead of creating one.
 *    Creating it means choosing a value, and the only value available is empty, which means "first
 *    run, collect 168 hours". That is a decision about pipeline state and it is not this workflow's
 *    to make. The message names the exact one-cell repair. It also cannot be silently survived: the
 *    key is required by the settings schema, so that sheet's pipeline is already failing.
 * 5. A RUNTIME KEY IN THE WRITE SET. Belt and braces over the build-time allowlist. The allowlist is
 *    the design; this assertion is what fires if someone edits the design.
 *
 * A blank-keyed row that carries a VALUE is refused too, for a smaller reason: appending past it
 * would bury a cell somebody meant to name.
 *
 * BOTH LANES ARE PLANNED TOGETHER AND REFUSED TOGETHER. A fault on the AI sheet stops the BI write
 * from happening at all. Half-applying a settings change across two lanes leaves them disagreeing
 * about a rule that is supposed to be shared, and nothing downstream would ever report it.
 */

const { PARSE_TAB_LOGIC } = require('./_sync');

const LOGIC = `
const built = $('Build Target Settings').first().json;
const LANES = built.lanes;
const TARGETS = built.targets;
const RUNTIME_KEYS = built.runtime_keys || [];
const OPTIONAL_KEYS = built.optional_keys || [];
const LIST_KEYS = built.list_keys || [];

const READ_NODE = { bi: 'Read BI Settings', ai: 'Read AI Settings' };

const pick = (node) => {
  try { const it = $(node).first(); return (it && it.json) || null; } catch (e) { return null; }
};

const SEP = '|';
const items = (s) => (String(s) === '' ? [] : String(s).split(SEP).map((x) => x.trim()).filter(Boolean));

const plans = {};
const problems = [];

for (const laneKey of Object.keys(LANES)) {
  const lane = LANES[laneKey];
  const target = TARGETS[laneKey] || {};
  let tab;
  try {
    tab = parseTab(pick(READ_NODE[laneKey]), laneKey);
  } catch (e) {
    problems.push(e.message);
    continue;
  }

  // --- refusal 2: duplicate keys ---
  for (const d of tab.dupes) {
    problems.push(
      laneKey + ': the settings tab has "' + d.key + '" on more than one row (' + d.rows.join(' and ') + '). ' +
      'There is no single cell to write and the decoder reads whichever it meets first. Delete the spare row.'
    );
  }
  // --- a valued row with no key ---
  for (const b of tab.blanks) {
    problems.push(
      laneKey + ': row ' + b.row + ' has a value (' + JSON.stringify(b.value.slice(0, 60)) + ') and no key in column A. ' +
      'Name it or clear it. A new key appended below it would bury it.'
    );
  }

  // --- refusal 3: the lane guard ---
  const laneCell = tab.byKey.lane;
  if (!laneCell) {
    problems.push(laneKey + ': the settings tab has no "lane" row, so the lane guard cannot run and a swapped spreadsheet id would be undetectable.');
  } else if (String(laneCell.value).trim() !== String(lane.lane_number)) {
    problems.push(
      'LANE GUARD: the spreadsheet at ' + lane.spreadsheet_id + ' says lane "' + laneCell.value +
      '" but the ' + laneKey + ' lane file says "' + lane.lane_number + '". Either the id in lane.json is wrong or ' +
      'the cell is. Syncing now would write the ' + laneKey.toUpperCase() + ' profile into the other lane spreadsheet, ' +
      'and every other check in this workflow would pass.'
    );
  }

  // --- refusal 4: a missing runtime row ---
  for (const k of RUNTIME_KEYS) {
    if (!tab.byKey[k]) {
      problems.push(
        laneKey + ': the settings tab has no "' + k + '" row. This sync will not create one: the only value it ' +
        'could choose is empty, which tells the next run to collect a ' + 'full first-run window and re-import a week ' +
        'of jobs. Add the row by hand (column A "' + k + '", column B the last successful run timestamp, or blank if ' +
        'there has never been one), then run this again.'
      );
    }
  }

  // --- refusal 5: a runtime key in the write set ---
  for (const k of RUNTIME_KEYS) {
    if (Object.prototype.hasOwnProperty.call(target, k)) {
      problems.push(laneKey + ': the target set contains the RUNTIME key "' + k + '". The allowlist was bypassed.');
    }
  }

  if (!Object.keys(target).length) {
    problems.push(laneKey + ': the target set is empty, so this run would write nothing and report success.');
  }

  // ---------------------------------------------------------------------------
  // The write set and the change log.
  // ---------------------------------------------------------------------------
  const data = [];
  const changes = [];
  const expected = {};            // key -> the value the sheet must hold afterwards
  const expectedOrder = tab.order.slice();
  const preserved = [];
  let nextRow = tab.height + 1;   // height counts the header, so this is the first free row

  for (const rec of tab.rows) expected[rec.key] = rec.value;

  for (const key of Object.keys(target)) {
    const want = String(target[key]);
    const existing = tab.byKey[key];
    if (existing) {
      data.push({ range: a1(lane.tab, 'B' + existing.row), values: [[want]] });
      expected[key] = want;
      const action = existing.value === want ? 'unchanged' : 'changed';
      const entry = { key: key, row: existing.row, action: action, old: existing.value, new: want };
      if (action === 'changed' && LIST_KEYS.indexOf(key) !== -1) {
        const was = items(existing.value);
        const now = items(want);
        entry.items_before = was.length;
        entry.items_after = now.length;
        entry.items_removed = was.filter((x) => now.indexOf(x) === -1);
        entry.items_added = now.filter((x) => was.indexOf(x) === -1);
      }
      changes.push(entry);
    } else {
      // A key in the approved set with no row on the sheet. Appending it is safe in a way that
      // touching a runtime row is not: there is no state to destroy, and leaving it out would make
      // the pipeline throw on a required key that this sync could have restored.
      const row = nextRow++;
      data.push({ range: a1(lane.tab, 'A' + row + ':B' + row), values: [[key, want]] });
      expected[key] = want;
      expectedOrder.push(key);
      changes.push({ key: key, row: row, action: 'added', old: null, new: want });
    }
  }

  for (const rec of tab.rows) {
    if (Object.prototype.hasOwnProperty.call(target, rec.key)) continue;
    preserved.push({
      key: rec.key,
      row: rec.row,
      value: rec.value,
      why: RUNTIME_KEYS.indexOf(rec.key) !== -1
        ? 'runtime state, written by the pipeline at the end of a successful run'
        : (OPTIONAL_KEYS.indexOf(rec.key) !== -1
          ? 'an optional cap, set by hand rather than by the approved settings'
          : 'not in the approved settings, so this sync has no opinion about it'),
    });
  }

  plans[laneKey] = {
    lane: lane,
    body: { valueInputOption: 'RAW', data: data },
    cells_written: data.length,
    changes: changes,
    changed: changes.filter((c) => c.action === 'changed'),
    added: changes.filter((c) => c.action === 'added'),
    unchanged_count: changes.filter((c) => c.action === 'unchanged').length,
    preserved: preserved,
    expected: expected,
    expected_order: expectedOrder,
    before_height: tab.height,
  };
}

if (problems.length) {
  throw new Error(
    'sync: REFUSED before writing anything. Both spreadsheets are exactly as they were.\\n' +
    '  - ' + problems.join('\\n  - ')
  );
}

// One last arithmetic check on the write set itself. Cheap, and it is the one that would catch a
// row-address bug: every range must name a row below the header, and no two ranges may collide.
const seenRanges = {};
for (const laneKey of Object.keys(plans)) {
  for (const d of plans[laneKey].body.data) {
    if (seenRanges[laneKey + ' ' + d.range]) {
      throw new Error('sync: two writes target the same cell ' + d.range + ' on the ' + laneKey + ' sheet.');
    }
    seenRanges[laneKey + ' ' + d.range] = true;
    const row = parseInt(String(d.range).replace(/^.*!\\D*/, ''), 10);
    if (!(row >= 2)) throw new Error('sync: a write targets ' + d.range + ', which is not a data row. Row 1 is the header.');
  }
}

return [{
  json: {
    planned_at: new Date().toISOString(),
    summary: Object.keys(plans).map((k) => (
      k + ': ' + plans[k].changed.length + ' changed, ' + plans[k].added.length + ' added, ' +
      plans[k].unchanged_count + ' unchanged, ' + plans[k].preserved.length + ' preserved'
    )),
    bi: plans.bi,
    ai: plans.ai,
  },
}];
`;

const jsCode = [
  '// GENERATED at build time. The parse block below is shared VERBATIM with the Report node, so the',
  '// node that decides where to write and the node that checks the write landed read the sheet the',
  '// same way. Source: work/34-job-search-bi/nodes/sync-settings/_sync.js.',
  PARSE_TAB_LOGIC,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Plan Changes',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [880, 100],
  connectFrom: 'Read AI Settings',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

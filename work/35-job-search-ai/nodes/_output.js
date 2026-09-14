'use strict';
/*
 * _output.js - the one place the output and telemetry nodes (38 to 49) read their facts from.
 *
 * Same split every folder in this lane uses, and for the same reason: `nodes/` is TRACKED and the
 * repo is PUBLIC, `config/` is gitignored (.gitignore:98). So the spreadsheet id, the tab names and
 * the credential ids live in `config/lane.json` and are BAKED IN at build time by build.js on this
 * machine. This file holds the wiring and the reasoning; it carries no lane value as a literal.
 *
 * The leading underscore keeps it out of build.js's node glob (/^\d+-.+\.js$/).
 *
 * PORTING TO #35: every path resolves from __dirname and every value comes from the lane's OWN
 * config/lane.json, so work/35-job-search-ai/nodes/ can hold a byte-identical copy. The ONE thing
 * #35's lane.json is missing today is `credentials.hq_token`; hqCredential() refuses the build with
 * that sentence in the error rather than shipping a push nobody authenticates.
 *
 * ---------------------------------------------------------------------------------------------
 * THE WRITE TAB, AND WHY IT IS ITS OWN KEY.
 * ---------------------------------------------------------------------------------------------
 * `sheet.jobs_write_tab` overrides `sheet.tab` for the WRITE only. Read Known Jobs still reads
 * `sheet.tab`. That asymmetry is the whole point of a test tab: the first live write lands somewhere
 * a mistake costs nothing, and the real jobs tab is untouched until a human has read the result.
 *
 * TWO CONSEQUENCES, both real, both reported on every run rather than remembered:
 *   1. While the two differ the lane has NO DEDUPE against what it wrote. Remove Known reads the
 *      real tab, so a second test run writes the same rows again. That is expected and it is why the
 *      test phase is one run, not a habit.
 *   2. THE LANE MUST NOT ADVANCE last_run_at WHILE WRITING TO A TEST TAB. This is not in the
 *      dispatch and it is load-bearing. If the window moved, the jobs written only to jobs_test
 *      would fall out of the next window and never be written to the real tab, and every run would
 *      still look green. That is precisely the failure the advance rule exists to prevent, so the
 *      test tab is a THIRD condition on it, alongside the two the dispatch named.
 *
 * ---------------------------------------------------------------------------------------------
 * THE RUNS COLUMNS ARE DECLARED HERE, NOT DERIVED FROM seed.json.
 * ---------------------------------------------------------------------------------------------
 * Same call `_lane.js` makes about the settings schema, for the same reason: seed.json is a spent
 * provisioning artifact and this stage must keep working the day it is archived. It is used as a
 * CROSS CHECK when it is on disk, and the LIVE header is checked again at run time by Check Writes,
 * which is the only check that can catch a hand edit to the sheet.
 */

const fs = require('fs');
const path = require('path');

const LANE_DIR = path.resolve(__dirname, '..');
const REPO = path.resolve(__dirname, '..', '..', '..');
const SEED_FILE = path.join(REPO, 'work', '34-job-search-bi', 'config', 'seed.json');
const MANIFEST_FILE = path.join(REPO, 'system', 'manifest.json');

const { lane } = require('./_lane');

// ---------------------------------------------------------------------------------------------
// THE RUN LEDGER COLUMNS, in sheet order. Nine, exactly as provisioned on 2026-09-11.
// ---------------------------------------------------------------------------------------------
const RUNS_COLUMNS = ['date', 'exec_id', 'searched', 'filtered', 'new', 'scored', 'verdict', 'note', 'cost_usd'];

// ---------------------------------------------------------------------------------------------
// THE VERDICT VOCABULARY, and the ONE token that is not in the dispatch's list.
//
// The dispatch named a CLOSED set: ok, no_new_jobs, scoring_down, budget_hit, source_down:<name>.
// Measured against what the collectors actually emit, that set has no slot for a state that is not
// an edge case at all. Every source_report carries a `verdict` from a five-value set:
//     ok        it ran and everything worked
//     degraded  it ran, some of it was refused or truncated, and it kept what it got
//     down       it ran and delivered nothing
//     disabled   it was switched off and cost nothing
//     idle       nothing was asked of it this run (the detail source on a day with no LinkedIn rows)
// `degraded` maps onto nothing in the dispatch's list, and it is what the FIRST real run produces by
// design: the LinkedIn call ceiling truncates the 168 hour backfill and a cap-truncated board
// reports degraded. Printing `ok` on that run would be the run ledger's first lie, and the runs tab
// exists to be scanned on a phone, where the verdict column is the only thing that gets read.
//
// So the set is extended by exactly ONE token, `degraded:<name>`, shaped like `source_down:<name>`
// so both parse the same way. Nothing else was added, and the extension is declared here as a
// constant so a test can pin it rather than a comment claiming it.
//
// PRECEDENCE, worst first, because a single token has to choose. Every applicable token is ALSO
// carried in full on the report and in the run row's note, so the ranking can never hide one.
//   1. source_down:<name>   a source delivered nothing. Ranked first on purpose: LinkedIn is the
//                           entire Sweden channel and a refusal there is the largest single risk in
//                           this lane. If it ranked below scoring_down it would be invisible for as
//                           long as the Anthropic account stays empty, which is right now.
//   2. scoring_down         rows were sent to the scorer and none came back scored.
//   3. budget_hit           a cap held real wanted rows back: max_scored_per_run or the cost cap.
//   4. degraded:<name>      a source ran, was partly refused or truncated, and kept what it got.
//   5. no_new_jobs          zero rows written, nothing down, nothing degraded, no cap, nothing held.
//                           A genuinely quiet day, which is the common case on this lane.
//   6. ok                   rows were written and nothing above applies.
// ---------------------------------------------------------------------------------------------
const VERDICT_TOKENS = {
  ok: 'ok',
  no_new_jobs: 'no_new_jobs',
  scoring_down: 'scoring_down',
  budget_hit: 'budget_hit',
  source_down: 'source_down',   // source_down:<contract key>
  degraded: 'degraded',         // degraded:<contract key>, the one extension, see above
};
const VERDICT_PRECEDENCE = ['source_down', 'scoring_down', 'budget_hit', 'degraded', 'no_new_jobs', 'ok'];

// Source verdicts that mean the window was NOT fully covered. `disabled` and `idle` are deliberate
// states and neither of them holds the window open.
const UNCLEAN_SOURCE_VERDICTS = ['down', 'degraded'];

// ---------------------------------------------------------------------------------------------
// Google Sheets REST, the same two calls the provisioner and the settings sync already use live.
// ---------------------------------------------------------------------------------------------
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets/';

// A1 notation quoting. `jobs`, `jobs_test`, `runs` and `settings` are all bare words today, so this
// is insurance rather than a fix, and it is the same rule nodes/sync-settings/_sync.js states.
function a1(tab, ref) {
  const safe = /^[A-Za-z0-9_]+$/.test(tab) ? tab : "'" + String(tab).split("'").join("''") + "'";
  return safe + '!' + ref;
}
function batchGetUrl(spreadsheetId, ranges) {
  const qs = ranges.map((r) => 'ranges=' + encodeURIComponent(r)).join('&');
  return SHEETS_BASE + spreadsheetId + '/values:batchGet?' + qs + '&majorDimension=ROWS';
}
function batchUpdateUrl(spreadsheetId) {
  return SHEETS_BASE + spreadsheetId + '/values:batchUpdate';
}

// ---------------------------------------------------------------------------------------------
// HQ. The URL is public (it is in scripts/lib/paths.mjs and in half the slash commands); the
// credential ID is a lane value and comes from the gitignored lane file like every other one.
// ---------------------------------------------------------------------------------------------
const HQ_PUSH_URL = 'https://n8n.shaheenkiarash.com/webhook/alex-push';

function hqCredential() {
  const L = lane();
  const id = L.credentials && L.credentials.hq_token;
  if (!id) {
    throw new Error(
      'Push HQ: config/lane.json has no credentials.hq_token.\n' +
      '  It is the n8n credential "Alex HQ Token" (httpHeaderAuth), the one every HQ webhook on the\n' +
      '  box authenticates with, and it is how the token value stays out of this repo.\n' +
      '  FOR #35: add the SAME id to work/35-job-search-ai/config/lane.json under credentials.hq_token.\n' +
      '  Refused rather than defaulted: a push with no credential returns 401 and an unauthenticated\n' +
      '  heartbeat that silently never lands is worse than no heartbeat, because the dashboard just\n' +
      '  ages instead of going red.'
    );
  }
  return { httpHeaderAuth: { id, name: 'Alex HQ Token' } };
}

// The project slug HQ files the metric rows under. Read out of the REGISTRY so it cannot drift from
// what the Automation Health board is built from (work/16-alex-hq/scripts/build-projects.mjs ships
// every non-retired manifest row).
function hqProject() {
  const L = lane();
  if (!fs.existsSync(MANIFEST_FILE)) throw new Error('output nodes: system/manifest.json is missing, and the HQ project slug is read from the registry rather than typed.');
  const m = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
  const row = (m.projects || []).find((p) => Number(p.num) === Number(L.lane));
  if (!row) {
    throw new Error(
      'output nodes: system/manifest.json has no row for lane #' + L.lane + '. The HQ slug, the state\n' +
      '  and the declared cron all come from that row, and a lane that is not in the registry is a lane\n' +
      '  nothing watches.'
    );
  }
  return {
    // hq_project is null for #34 and #35 today. That is the registry saying "no slug declared", not
    // "do not push": #31 and #32 are LIVE with the same null. Falling back to the manifest NAME keeps
    // the metric rows landing in alex_metrics under a stable, greppable key, and the run report says
    // which of the two it used so the fallback is never mistaken for a declaration.
    slug: row.hq_project || row.name,
    declared: row.hq_project !== null && row.hq_project !== undefined,
    state: row.state,
    name: row.name,
  };
}

// ---------------------------------------------------------------------------------------------
// The write tab. See the header.
// ---------------------------------------------------------------------------------------------
function writeTarget() {
  const L = lane();
  const real = L.sheet.tab;
  const override = L.sheet.jobs_write_tab;
  if (override !== undefined && (typeof override !== 'string' || !override.trim())) {
    throw new Error('output nodes: lane.json sheet.jobs_write_tab is ' + JSON.stringify(override) + '. It is either a non-empty tab name or the key is absent. An empty string would resolve to a range of "!A:A" and write nowhere.');
  }
  const tab = override || real;
  return {
    tab,
    real_tab: real,
    is_test_tab: tab !== real,
    why: tab !== real
      ? 'lane.json sets sheet.jobs_write_tab, so this run writes to a TEST tab and must not advance last_run_at. Delete that key and rebuild to repoint at the real tab.'
      : 'lane.json sets no sheet.jobs_write_tab, so the write goes to the real jobs tab.',
  };
}

// ---------------------------------------------------------------------------------------------
// The resourceMapper `columns.schema` an append node needs.
//
// NOT COSMETIC, and this was measured rather than copied off a live node. On typeVersion >= 4.4 with
// mappingMode `defineBelow`, append.operation.ts THROWS when columns.schema is missing or empty, and
// then runs checkForSchemaChanges(node, liveHeaderRow, schema), which throws if any declared column
// is absent from the sheet's real header row. So the schema is both required and a free guard: a
// renamed or deleted column in Shaheen's sheet fails the write loudly instead of writing a row into
// the wrong columns. (packages/nodes-base/nodes/Google/Sheet/v2/actions/sheet/append.operation.ts and
// helpers/GoogleSheets.utils.ts at n8n@2.30.3, fetched, not remembered.)
// ---------------------------------------------------------------------------------------------
function mapperSchema(columns) {
  return columns.map((c) => ({
    id: c,
    displayName: c,
    required: false,
    defaultMatch: false,
    display: true,
    type: 'string',
    canBeUsedToMatch: true,
  }));
}
// The `columns.value` map for defineBelow: one expression per column, read off the item by name.
function mapperValues(columns) {
  const out = {};
  for (const c of columns) out[c] = '={{ $json["' + c + '"] }}';
  return out;
}

// ---------------------------------------------------------------------------------------------
// CROSS CHECK against the seed that actually wrote the tabs, when it is still on disk.
// A check, not a source: an absent seed.json skips it silently, exactly as settingsSchema() does.
// ---------------------------------------------------------------------------------------------
function assertTabsAgainstSeed(sharedRowShape) {
  if (!fs.existsSync(SEED_FILE)) return { checked: false };
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  const tabs = seed.tabs || {};
  const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  if (!same(tabs.runs, RUNS_COLUMNS)) {
    throw new Error(
      'output nodes: RUNS_COLUMNS disagrees with the seed that provisioned the runs tab.\n' +
      '  declared: ' + JSON.stringify(RUNS_COLUMNS) + '\n' +
      '  seeded:   ' + JSON.stringify(tabs.runs) + '\n' +
      '  The run ledger row is written by column NAME, so a disagreement here means the row lands in\n' +
      '  columns nobody meant.'
    );
  }
  if (!same(tabs.jobs, sharedRowShape)) {
    throw new Error(
      'output nodes: the jobs tab header and sources.json shared_row_shape disagree.\n' +
      '  seeded:   ' + JSON.stringify(tabs.jobs) + '\n' +
      '  contract: ' + JSON.stringify(sharedRowShape) + '\n' +
      '  Stage A froze these as the same list in the same order. If the row shape is genuinely growing,\n' +
      '  the SHEET HEADER moves in the same session or every collector writes into the wrong columns.'
    );
  }
  return { checked: true };
}

// ---------------------------------------------------------------------------------------------
// A constant lifted out of another node's GENERATED jsCode, never declared twice.
// Same pattern 18-extract-board-jobs.js uses to read BOARD_KEYS out of 05-plan-queries.js: two
// copies of a number is how one node caps at 200 while another reports 240.
// ---------------------------------------------------------------------------------------------
function constFromNode(nodeDef, name) {
  const src = (nodeDef.parameters && nodeDef.parameters.jsCode) || '';
  const m = new RegExp('const\\s+' + name + '\\s*=\\s*([0-9]+)\\s*;').exec(src);
  if (!m) {
    throw new Error(
      'output nodes: could not read `' + name + '` out of ' + JSON.stringify(nodeDef.name) + "'s generated code.\n" +
      '  It is read rather than restated so the two can never disagree. If that node stopped declaring it,\n' +
      '  decide where the number lives now and change both ends in the same edit.'
    );
  }
  return Number(m[1]);
}

module.exports = {
  RUNS_COLUMNS,
  VERDICT_TOKENS,
  VERDICT_PRECEDENCE,
  UNCLEAN_SOURCE_VERDICTS,
  SHEETS_BASE,
  HQ_PUSH_URL,
  a1,
  batchGetUrl,
  batchUpdateUrl,
  hqCredential,
  hqProject,
  writeTarget,
  mapperSchema,
  mapperValues,
  assertTabsAgainstSeed,
  constFromNode,
  REPO,
  LANE_DIR,
};

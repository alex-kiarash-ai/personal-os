'use strict';
/*
 * 10-build-indeed-request.js - N planned Indeed units folded into ONE trigger request.
 *
 * THIS NODE WAS NOT IN THE STAGE C BRIEF AND IT IS NOT OPTIONAL. Stated plainly, because a node
 * nobody asked for owes a reason rather than a preference.
 *
 * Plan Queries emits ONE Indeed unit per search term x location. For the BI lane with the shipped
 * settings that is 5 terms x 2 resolvable locations = 10 units. An n8n HTTP Request node runs once
 * per INPUT item, so ten units hung straight off the router would mean:
 *   1. TEN separate Bright Data trigger calls, so ten snapshots, on a source that bills per record.
 *   2. TEN snapshot ids arriving as ten items into ONE poll loop. The loop would then be carrying a
 *      mixed population where some snapshots are ready and some are not, and `Keep Polling?` would
 *      have to route a single verdict for all of them. There is no correct answer to that: stopping
 *      when the first is ready abandons nine, and stopping when the last is ready re-fetches the
 *      other nine on every pass. The loop is not merely inelegant with N inputs, it is undefined.
 * So the fold is what makes the poll loop tractable at all, and it is also what `limit_per_input`
 * is FOR: that parameter only means something if the trigger takes a LIST of inputs. One POST, one
 * snapshot_id, one loop, one cap.
 *
 * WHAT IT SENDS, AND WHY EVERY NAME IN IT IS A DECLARED GUESS. The Stage C probe could not run: the
 * Bright Data key lives inside the n8n credential and nowhere else on this machine, so nothing about
 * this dataset has ever been observed. The input field names therefore come from the contract's
 * `input_fields.map`, which is marked `_verified: false`, and they are the LinkedIn dataset's names
 * carried across. They are READ from the contract rather than typed here for one reason: when the
 * probe finally lands, one contract edit fixes this node, and the build fails loudly if that edit is
 * done by halves.
 *
 * THE COST CEILING IS A BUILD TIME CHECK, DELIBERATELY, AND NOT A RUNTIME GATE. A runtime gate would
 * need somewhere to send a refusal, which means another routing node, and the only thing it could do
 * without one is throw, which would destroy the LinkedIn rows already collected in the same run for
 * a cost that is already bounded three other ways: the source ships OFF, Plan Queries caps
 * `limit_per_input`, and Bright Data enforces that cap server side. A half gate that can only kill a
 * good run trades a known small cost for an unknown large one. So the ceiling is asserted HERE, on
 * this machine, before a byte ships, and the runtime estimate is carried into the run report where a
 * human can read it.
 */

const { sources } = require('./_lane');
const CONTRACT = sources();
const SRC = CONTRACT.sources;

const SOURCE_KEY = 'brightdata_indeed';
const S = SRC[SOURCE_KEY];

// The worst case this build is willing to ship, in dollars per run. Not a runtime cap, see above.
// 10 units x 10 records x $0.00075 is $0.075, so the ceiling is roughly six times the shipped
// worst case and exists to catch someone raising limit_per_input by an order of magnitude.
const COST_CEILING_USD = 0.5;
// The most Indeed units a plan could plausibly emit: every search term against every resolvable
// location. Generous on purpose. It only feeds the ceiling arithmetic.
const MAX_EXPECTED_UNITS = 20;

(function assertAgainstContract() {
  if (!S) {
    throw new Error('Build Indeed Request: the shared contract has no source called ' + SOURCE_KEY + '. It carries: ' + Object.keys(SRC).join(', '));
  }

  const inp = S.input_fields;
  if (!inp || !inp.map || typeof inp.map !== 'object' || !Object.keys(inp.map).length) {
    throw new Error(
      'Build Indeed Request: the contract has no input_fields.map for ' + SOURCE_KEY + '.\n' +
      '  This node builds the trigger body from that map so a probe result lands as ONE contract edit\n' +
      '  instead of a hunt through node files. Add it, even if every name in it is still a guess.'
    );
  }

  // The flags and the values have to tell the same story. A contract that says "probed" while its
  // field names still say UNVERIFIED, or that says "unverified" while the names look settled, is a
  // contract nobody can act on, and both halves of this lane branch on exactly that flag.
  const fieldMapValues = Object.values(S.field_map || {}).map(String);
  const anyUnverified = fieldMapValues.some((v) => /UNVERIFIED/i.test(v));
  if (S.probed === true) {
    if (anyUnverified) {
      throw new Error(
        'Build Indeed Request: the contract sets probed=true for ' + SOURCE_KEY + ' while field_map still\n' +
        '  says UNVERIFIED. The probe was recorded as done and its result was not written down. Finish the\n' +
        '  edit: field_map, output_fields, snapshot_envelope, date_field, date_format and input_fields._verified.'
      );
    }
    if (inp._verified !== true) {
      throw new Error('Build Indeed Request: the contract sets probed=true but input_fields._verified is still ' + JSON.stringify(inp._verified) + '. The trigger input names are the half of the probe this node depends on.');
    }
  } else {
    if (!anyUnverified) {
      throw new Error(
        'Build Indeed Request: the contract still says probed=false for ' + SOURCE_KEY + ' but no field_map\n' +
        '  value says UNVERIFIED any more. Either the probe ran and the flag was never flipped, or somebody\n' +
        '  tidied the wording off a set of guesses and made them look like measurements. Both are worse than\n' +
        '  the guesses were, because the whole lane reads that flag to decide whether to trust these names.'
      );
    }
    if (inp._verified === true) {
      throw new Error('Build Indeed Request: input_fields._verified is true while probed is false. They describe the same probe.');
    }
  }

  const price = S.price_per_record_usd;
  if (typeof price !== 'number' || !(price > 0)) {
    throw new Error('Build Indeed Request: the contract has no numeric price_per_record_usd for ' + SOURCE_KEY + '. This is the only source that bills, so the number belongs in the contract where a human can see it, not in a comment.');
  }

  // Plan Queries owns limit_per_input and bakes it into the endpoint. Read it back out of the
  // endpoint template's sibling so the ceiling is computed against the number that actually ships.
  const planned = require('./05-plan-queries.js');
  const m = /const INDEED_LIMIT_PER_INPUT = (\d+);/.exec(planned.parameters.jsCode);
  if (!m) {
    throw new Error('Build Indeed Request: could not read INDEED_LIMIT_PER_INPUT back out of 05-plan-queries.js. The cost ceiling is computed from it, so it has to be readable.');
  }
  const limit = Number(m[1]);
  const worst = limit * MAX_EXPECTED_UNITS * price;
  if (worst > COST_CEILING_USD) {
    throw new Error(
      'Build Indeed Request: the worst case cost of this configuration is $' + worst.toFixed(4) + ' per run\n' +
      '  (' + MAX_EXPECTED_UNITS + ' units x limit_per_input ' + limit + ' x $' + price + ' per record), above the\n' +
      '  $' + COST_CEILING_USD + ' ceiling this build will ship. Lower limit_per_input in 05-plan-queries.js, or\n' +
      '  raise the ceiling here DELIBERATELY, in the same commit, with the new number in the card.'
    );
  }
}());

const INPUT_MAP = S.input_fields.map;
const PROBED = S.probed === true;

const LOGIC = `
// ---------------------------------------------------------------------------
// Build Indeed Request. N planned units in, exactly ONE trigger request out.
// ---------------------------------------------------------------------------
const units = $input.all().map((i) => i.json);

if (!units.length) {
  // Unreachable in practice: a node with no input items is SKIPPED by n8n and never runs at all,
  // which is exactly what happens when source_brightdata_indeed is off. Kept as a guard because a
  // future rewiring that DID deliver an empty set would otherwise POST a trigger with no inputs,
  // and Bright Data would charge for whatever it decided that meant.
  throw new Error('Build Indeed Request: no planned Indeed units on the input. This node folds the planned units into one paid trigger call and has nothing to fold.');
}

for (const u of units) {
  if (u.source !== SOURCE_KEY) {
    throw new Error(
      'Build Indeed Request: a unit for source "' + u.source + '" reached the Indeed branch. Only ' +
      SOURCE_KEY + ' units belong here. Something upstream of Indeed Units Only is misrouting, and this ' +
      'node is one POST away from paying for it.'
    );
  }
}

// Every unit carries the same trigger url, because Plan Queries fills the only placeholder in it
// with a constant. If they ever disagree, ONE of them would be silently chosen by arrival order.
const urls = Array.from(new Set(units.map((u) => u.url)));
if (urls.length !== 1) {
  throw new Error('Build Indeed Request: the planned Indeed units carry ' + urls.length + ' different trigger urls. One trigger call cannot serve two endpoints: ' + urls.join(' | '));
}

// The inputs array. One entry per planned unit, built from the contract's input map. A field whose
// source value is null or empty is OMITTED rather than sent blank, for the same reason Plan Queries
// drops an empty query param: an empty value is not the same request as no value, and nobody has
// measured which one this dataset prefers. Remote EU has no country, so this actually fires.
const inputs = [];
const omitted = [];
for (const u of units) {
  const entry = {};
  for (const field of Object.keys(INPUT_MAP)) {
    const from = INPUT_MAP[field];
    const v = u[from];
    if (v === null || v === undefined || v === '') { omitted.push({ seq: u.seq, field: field, from: from }); continue; }
    entry[field] = v;
  }
  if (!Object.keys(entry).length) {
    throw new Error('Build Indeed Request: planned unit seq ' + u.seq + ' produced an EMPTY trigger input. Every field in the contract input map resolved to nothing on that unit, so the request would ask Bright Data to discover jobs matching no criteria at all.');
  }
  inputs.push(entry);
}

const limitPerInput = units[0].limit_per_input;
const estimatedRecords = inputs.length * limitPerInput;
const estimatedCostUsd = Number((estimatedRecords * PRICE_PER_RECORD_USD).toFixed(5));

// The settings cap is REPORTED against, not enforced here. See the header: enforcing it would need a
// routing node, and the only thing this node could do alone is throw, which would take the LinkedIn
// rows down with it for a cost that is already bounded three other ways.
let settingsCap = null;
try { settingsCap = $('Parse Settings').first().json.max_cost_per_run_usd; } catch (e) { settingsCap = null; }
const overSettingsCap = typeof settingsCap === 'number' && estimatedCostUsd > settingsCap;

const run = units[0].run || {};

return [{
  json: {
    trigger_url: urls[0],
    trigger_body: inputs,
    source: SOURCE_KEY,
    lane: units[0].lane,
    planned_units: units.length,
    seqs: units.map((u) => u.seq),
    terms: units.map((u) => u.term),
    limit_per_input: limitPerInput,
    cost: {
      price_per_record_usd: PRICE_PER_RECORD_USD,
      max_records: estimatedRecords,
      max_cost_usd: estimatedCostUsd,
      settings_cap_usd: settingsCap,
      over_settings_cap: overSettingsCap,
      note: 'max_records is the CEILING Bright Data is allowed to bill for, not a prediction. A discover run that finds fewer jobs bills for fewer records.',
    },
    // Everything downstream needs about the contract, carried once rather than re-read per node.
    input_shape_verified: INPUT_SHAPE_VERIFIED,
    window_start: units[0].window_start,
    window_end: units[0].window_end,
    window_start_effective: units[0].window_start_effective,
    date_field: units[0].date_field,
    date_format: units[0].date_format,
    dedup_id_rule: units[0].dedup_id_rule,
    filters: units[0].filters,
    run: run,
    omitted_input_fields: omitted,
    warnings: (INPUT_SHAPE_VERIFIED ? [] : [
      'The Bright Data Indeed input field names have NEVER been observed. This request is built from ' +
      'the LinkedIn dataset names carried across as the only documented guess (contract input_fields, ' +
      '_verified false). If Bright Data rejects the body or returns nothing, the input names are the ' +
      'first thing to distrust, not the account and not the loop.',
    ]).concat(overSettingsCap ? [
      'This run may bill up to $' + estimatedCostUsd + ', above the max_cost_per_run_usd of $' + settingsCap +
      ' set in the settings tab. It is REPORTED and not blocked: see the node header for why a runtime ' +
      'cost gate would need a routing node and could otherwise only kill an otherwise good run.',
    ] : []),
  },
}];
`;

const jsCode = [
  '// GENERATED at build time from work/34-job-search-bi/nodes/10-build-indeed-request.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  `const SOURCE_KEY = ${JSON.stringify(SOURCE_KEY)};`,
  `const INPUT_MAP = ${JSON.stringify(INPUT_MAP)};`,
  `const INPUT_SHAPE_VERIFIED = ${JSON.stringify(PROBED && S.input_fields._verified === true)};`,
  `const PRICE_PER_RECORD_USD = ${JSON.stringify(S.price_per_record_usd)};`,
  LOGIC,
].join('\n');

module.exports = {
  name: 'Build Indeed Request',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1560, 320],
  connectFrom: 'Indeed Units Only',
  outputIndex: 0,
  notes: 'Folds every planned Indeed unit into ONE Bright Data trigger body. One POST, one snapshot, one poll loop. Without this the lane would fire one paid scrape per search term and the poll loop would carry a mixed population it cannot route.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

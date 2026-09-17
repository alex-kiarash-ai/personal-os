'use strict';
/*
 * 06-linkedin-only.js - the router. LinkedIn search units out of output 0, everything else out of
 * output 1.
 *
 * THIS NODE WAS NOT IN THE STAGE B BRIEF, AND IT IS NOT OPTIONAL. Stated plainly because a node
 * nobody asked for needs a reason, not a preference.
 *
 * Plan Queries emits ONE item per unit of work, and today that is 18 items for this lane: 12
 * LinkedIn searches and 6 board calls (an Indeed unit joins them the day its switch goes on). An
 * n8n HTTP Request node runs once per INPUT item and has no way to skip one. So an HTTP node hung
 * straight off Plan Queries fires on all 18, which breaks in two directions at once:
 *   1. It GETs the six board feeds under LinkedIn's settings: LinkedIn's 1500 ms pacing, LinkedIn's
 *      refusal statuses, LinkedIn's timeout. Then the day the board collector is built, those six
 *      feeds are fetched TWICE per run, and nothing anywhere says so.
 *   2. Their JSON arrives at a parser that is looking for LinkedIn job cards, finds none, and
 *      reports six degraded sources that were never broken. A false red is as expensive as a false
 *      green, because the next person learns to ignore the report.
 * Neither of those is a LinkedIn problem, so neither belongs in the LinkedIn nodes.
 *
 * WHY AN IF AND NOT A FILTER. A Filter node has one output and DISCARDS what it rejects, which
 * would silently drop six planned units on a lane whose entire design is that nothing goes missing
 * quietly. An IF has two, so the six board units land on a visibly unconnected output instead of
 * being erased. They still go nowhere in Stage B, and the honest way to say so is where a human
 * looks: output 1 is unwired on the canvas, the fact is in this file, and Extract LinkedIn counts
 * them from the plan and prints them in the run report as not_collected_here. The board collector
 * wires to THIS output when it is built, and nothing upstream changes.
 *
 * WHY strict TYPE VALIDATION. The two IF nodes already on this box run `loose`, which coerces a
 * missing left value to '' and routes it to false. Here that would read a plan item with no
 * `source` as "not LinkedIn" and lose it. Plan Queries sets `source` on every item it emits, so a
 * missing one is a contract violation upstream, and strict turns it into a stopped run instead of
 * a quiet reroute.
 *
 * The source key is READ from the shared contract, never typed. A source renamed in sources.json
 * fails this build rather than routing every LinkedIn call into the unwired branch.
 */

const { sources } = require('./_lane');
const SRC = sources().sources;

const SOURCE_KEY = 'linkedin_guest_search';

// The condition id is a fixed literal, not a generated uuid, and that is deliberate: build.js
// supports --rebuild, and a fresh random id on every build would make the PUT body differ from the
// live workflow every single time, so the read-back diff would show permanent churn and stop being
// a signal. n8n only needs it unique inside this node.
const CONDITION_ID = 'a1f0c3d2-7b64-4e18-9a25-6c0b8d41e7f3';

(function assertAgainstContract() {
  if (!SRC[SOURCE_KEY]) {
    throw new Error(
      'LinkedIn Units Only: the shared contract has no source called ' + SOURCE_KEY + '. It carries: ' +
      Object.keys(SRC).join(', ') + '.\n' +
      '  This node routes on that exact string, and Plan Queries stamps it onto every LinkedIn item.\n' +
      '  If the source was renamed, rename it in BOTH places in the same edit. Failing the build is\n' +
      '  the point: the alternative is every LinkedIn call routing into the unwired branch and the\n' +
      '  run reporting a healthy zero.'
    );
  }
}());

module.exports = {
  name: 'LinkedIn Units Only',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [1040, 100],
  connectFrom: 'Plan Queries',
  notes: 'Output 0: LinkedIn search units. Output 1: every other planned unit, deliberately unwired in Stage B and counted in the run report, never dropped.',
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: CONDITION_ID,
          leftValue: '={{ $json.source }}',
          rightValue: SOURCE_KEY,
          operator: { type: 'string', operation: 'equals' },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
};

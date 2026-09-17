'use strict';
/*
 * 09-indeed-only.js - the second router. Indeed units out of output 0, board units out of output 1.
 *
 * WHY A SECOND ROUTER AND NOT A REUSE OF THE FIRST. `LinkedIn Units Only` splits the plan in two:
 * LinkedIn on output 0, EVERYTHING ELSE on output 1. Stage B left that second output deliberately
 * unwired and counted what sat on it. Stage C wires it, and the first thing that has to happen there
 * is a second split, because "everything else" is two different kinds of work:
 *   - six board units, whole feeds over plain unauthenticated GETs, no cost, no polling
 *   - up to ten Indeed units, one PAID asynchronous scrape behind a credential, with a poll loop
 * An HTTP Request node runs once per INPUT item and cannot skip one, which is the same fact that
 * forced the first router into existence. Hung straight off output 1, `Start Indeed Search` would
 * POST the Bright Data trigger once per BOARD unit as well, against a source that BILLS PER RECORD.
 * That is not a wiring inelegance, it is a way to spend money on a mistake, on a schedule, with
 * nobody watching.
 *
 * SO OUTPUT 1 HERE IS THE BOARD OUTPUT, and it is unwired on purpose, exactly as Stage B left its
 * own. The board collector is Stage D and it plugs in HERE, not upstream. Extract LinkedIn already
 * counts the boards from the plan and prints them as `not_collected_here`, so the gap has a number
 * against it in every run report and is not resting on anyone remembering.
 *
 * WHY AN IF AND NOT A FILTER, AGAIN. A Filter has one output and discards what it rejects. Six board
 * units silently erased is precisely the failure this lane is built to refuse, and it would be
 * invisible: the run would look clean and the sheet would just be smaller.
 *
 * WHY strict TYPE VALIDATION, AGAIN. The box's own older IF nodes run `loose`, which coerces a
 * missing left value to '' and routes it to false. Here that would read a plan item with no `source`
 * as "not Indeed" and quietly hand it to the board branch. Plan Queries stamps `source` on every item
 * it emits, so a missing one is an upstream contract violation and belongs in a stopped run.
 *
 * The source key is READ from the shared contract, never typed.
 */

const { sources } = require('./_lane');
const SRC = sources().sources;

const SOURCE_KEY = 'brightdata_indeed';

// A fixed literal, not a generated uuid, for the same reason as the first router: build.js supports
// --rebuild, and a fresh random id per build would make the PUT body differ from the live workflow
// every single time, so the read-back diff would show permanent churn and stop being a signal.
const CONDITION_ID = 'c7e4b910-2d63-4f85-b1a7-0e93f6c2d84b';

(function assertAgainstContract() {
  if (!SRC[SOURCE_KEY]) {
    throw new Error(
      'Indeed Units Only: the shared contract has no source called ' + SOURCE_KEY + '. It carries: ' +
      Object.keys(SRC).join(', ') + '.\n' +
      '  This node routes on that exact string and Plan Queries stamps it onto every Indeed item.\n' +
      '  If the source was renamed, rename it in BOTH places in the same edit. Failing the build is\n' +
      '  the point: the alternative is every Indeed unit routing into the board branch, where an\n' +
      '  unauthenticated GET collector would try to read a paid asynchronous scrape API.'
    );
  }
}());

module.exports = {
  name: 'Indeed Units Only',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [1300, 320],
  connectFrom: 'LinkedIn Units Only',
  outputIndex: 1,
  notes: 'Output 0: Indeed units, which are paid and asynchronous. Output 1: the board units, deliberately unwired until Stage D and counted in the run report, never dropped.',
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

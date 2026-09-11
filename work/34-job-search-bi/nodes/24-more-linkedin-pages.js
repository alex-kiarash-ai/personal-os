'use strict';
/*
 * 24-more-linkedin-pages.js - the router that closes the LinkedIn paging loop. One boolean, two
 * outputs, no thinking. The same split 15-keep-polling.js makes for the Indeed poll loop, and for
 * the same reason: the cap lives in exactly ONE place, so there is no second condition here that
 * could disagree with the guard, and no path back into the loop the guard did not approve.
 *
 * WHERE IT SITS (the file number is 24 only because 01 to 22 were taken):
 *   Search LinkedIn -> LinkedIn Page Guard -> More LinkedIn Pages?
 *     output 0 (TRUE)  -> Search LinkedIn      the loop
 *     output 1 (FALSE) -> Extract LinkedIn     the exit
 *
 * WHY TRUE IS THE LOOP AND NOT THE EXIT, which looks like a naming preference and is not. The node
 * is asked "are there more pages", so TRUE has to mean "go and get them", and the name follows the
 * wiring so that reading the canvas tells the truth. 15-keep-polling.js made the identical call and
 * was forced into it by build.js carrying one shared outputIndex per node; that constraint is gone
 * since Stage E added per-entry outputIndex, so this one is a choice rather than a workaround, and
 * the choice is to match the loop already on this canvas.
 *
 * WHY THE EXIT BRANCH IS EMPTY ON EVERY PASS BUT THE LAST, which is the load-bearing property of
 * the whole design. n8n skips a node whose input is empty. The guard holds every response back until
 * paging is finished, so output 1 carries nothing until then and `Extract LinkedIn` runs EXACTLY
 * ONCE, seeing the whole corpus. If the guard released each pass's finished queries as it went, the
 * extractor would run once per pass and emit one source_report per pass, each carrying a slice of
 * the counts. The truncation total, the verdict and the duplicate count are all whole-run numbers,
 * so a per-pass report is not a smaller version of the right answer, it is a different answer.
 *
 * strict TYPE VALIDATION, same as the other two IF nodes in this workflow and for the same reason.
 * Under `loose` a missing or undefined `page_more` coerces to false, which routes to the exit and
 * hands the extractor items with no paging report attached. Under `strict` it stops the run. Given
 * the choice between a stopped run and a loop whose exit condition can be satisfied by a field that
 * does not exist, the stopped run is the only honest option.
 */

// A fixed literal, not a generated uuid: build.js supports --rebuild, and a fresh id per build would
// make the PUT body differ from the live workflow every time, so the read-back diff would show
// permanent churn and stop being a signal.
const CONDITION_ID = 'c7d41e92-8b60-4a15-9f33-5e0c7a1d24b8';

const GUARD = require('./23-linkedin-page-guard.js');
const FIELD = 'page_more';

(function assertGuardWritesTheField() {
  const code = GUARD.parameters.jsCode;
  if (!/page_more:\s*true/.test(code)) {
    throw new Error(
      'More LinkedIn Pages?: 23-linkedin-page-guard.js no longer emits page_more: true on its loop items.\n' +
      '  This node routes on $json.' + FIELD + ' and on nothing else, so with strict type validation every\n' +
      '  pass would stop the run. That is loud, but the error would point here instead of at the guard.'
    );
  }
  if (!/page_more:\s*false/.test(code) && !/\.page_more = false/.test(code)) {
    throw new Error(
      'More LinkedIn Pages?: 23-linkedin-page-guard.js no longer emits page_more: false on its released\n' +
      '  corpus. true and false are the same decision written twice, once for the loop and once for the\n' +
      '  exit, and if only one of them is written the other branch never fires.'
    );
  }
  // The clamp is what a hand edited settings cell cannot raise. If it went away, this loop would have
  // no bound that survives the sheet, and it is a weekday cron with nobody in the room.
  if (!/HARD_MAX_PASSES/.test(code) || !/HARD_MAX_CALLS/.test(code)) {
    throw new Error('More LinkedIn Pages?: the guard no longer carries its hard clamps. The configurable ceiling is a convenience; the clamp is the only bound a hand edited settings cell cannot raise, and this node is the edge that would spin without it.');
  }
}());

module.exports = {
  name: 'More LinkedIn Pages?',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [1560, 140],
  connectFrom: 'LinkedIn Page Guard',
  notes: 'Output 0 (true): request the next page, back to Search LinkedIn. Output 1 (false): paging is finished, hand the whole corpus to Extract LinkedIn. Reads only the boolean LinkedIn Page Guard computed, so the ceiling lives in exactly one place.',
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: CONDITION_ID,
          leftValue: '={{ $json.page_more }}',
          rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true },
        },
      ],
      combinator: 'and',
    },
    options: {},
  },
};

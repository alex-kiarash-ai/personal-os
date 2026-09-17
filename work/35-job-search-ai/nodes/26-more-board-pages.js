'use strict';
/*
 * 26-more-board-pages.js - the router that closes the board paging loop. Same one-boolean shape as
 * 24-more-linkedin-pages.js and 15-keep-polling.js: the guard decided, this node only routes, so the
 * cap lives in exactly one place and there is no path back into the loop the guard did not approve.
 *
 * WHERE IT SITS (the file number is 26 only because 01 to 22 were taken):
 *   Fetch Board -> Board Page Guard -> More Board Pages?
 *     output 0 (TRUE)  -> Board Page Pause -> Fetch Board     the loop
 *     output 1 (FALSE) -> Extract Board Jobs                  the exit
 *
 * THE PAUSE IS ON THIS BRANCH AND NOT ON THE LINKEDIN ONE, which is asymmetric on purpose and worth
 * the paragraph. `Fetch Board` paces with batchInterval 2000 ms, and n8n's HTTP node only sleeps
 * BETWEEN ITEMS INSIDE ONE RUN (measured: it sleeps when itemIndex > 0). Pass one carries six items
 * and is properly spaced. Every pass after that carries exactly ONE item, the next cursor page, so
 * the interval never fires and consecutive cursor pages to the SAME host would arrive back to back
 * with no gap at all. Himalayas publishes no limit and its contract note says the site 429s when
 * abused, so a burst of a dozen back-to-back calls to one small free service is the one shape worth
 * a whole extra node to avoid.
 *   The LinkedIn loop does not have that problem in the same degree: each of its passes carries many
 *   items and is internally spaced, so only the first call of each pass sits close to the previous
 *   pass's last, which is at most two or three unspaced pairs out of twenty. That is stated rather
 *   than hidden, because it IS a residual and a reader is entitled to know it was measured and
 *   accepted rather than missed.
 *
 * strict TYPE VALIDATION, same as every other IF in this workflow. Under `loose` a missing
 * `page_more` coerces to false and routes to the exit, handing the extractor items with no paging
 * report. Under `strict` it stops the run, which is the honest outcome when a loop's exit condition
 * can be satisfied by a field that does not exist.
 */

const CONDITION_ID = '3a5f7c18-42d9-4e6b-b70a-9c1e5f8b3d46';

const GUARD = require('./25-board-page-guard.js');
const FIELD = 'page_more';

(function assertGuardWritesTheField() {
  const code = GUARD.parameters.jsCode;
  if (!/page_more:\s*true/.test(code)) {
    throw new Error(
      'More Board Pages?: 25-board-page-guard.js no longer emits page_more: true on its loop items.\n' +
      '  This node routes on $json.' + FIELD + ' and on nothing else, so with strict type validation every\n' +
      '  pass would stop the run, and the error would point here instead of at the guard.'
    );
  }
  if (!/\.page_more = false/.test(code) && !/page_more:\s*false/.test(code)) {
    throw new Error('More Board Pages?: 25-board-page-guard.js no longer emits page_more: false on its released corpus, so the exit branch would never fire and Extract Board Jobs would never run.');
  }
  if (!/HARD_MAX_PASSES/.test(code) || !/HARD_MAX_PAGES_PER_SOURCE/.test(code)) {
    throw new Error('More Board Pages?: the guard no longer carries its hard clamps. The configurable cap is a convenience; the clamp is the only bound a hand edited settings cell cannot raise, and this node is the edge that would spin without it.');
  }
}());

module.exports = {
  name: 'More Board Pages?',
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position: [1820, 620],
  connectFrom: 'Board Page Guard',
  notes: 'Output 0 (true): fetch the next cursor page, through Board Page Pause and back to Fetch Board. Output 1 (false): paging is finished, hand the whole corpus to Extract Board Jobs. Reads only the boolean Board Page Guard computed.',
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

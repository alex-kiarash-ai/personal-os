'use strict';
/*
 * 08-eval-summary.js - "Eval Summary". One verdict line, and it has to read 6/6.
 *
 * ---------------------------------------------------------------------------------------------
 * THE VERDICT IS RECOMPUTED, NEVER READ OFF ANYTHING.
 * ---------------------------------------------------------------------------------------------
 * It counts rows where `pass === true` and asserts the total against the number of cases BAKED into
 * this node at build time. A run that scored five cases and passed all five reports 5 of 6 and is
 * not a pass, because the missing case is the one nobody looked at. That is the same shape as the
 * runtime's D16 rule: an answer that did not happen is not an answer that succeeded.
 *
 * ---------------------------------------------------------------------------------------------
 * THREE OUTCOMES, KEPT APART ON PURPOSE.
 * ---------------------------------------------------------------------------------------------
 *   passed        the letter came back and cleared all thirteen checks
 *   failed        the letter came back and broke one, and the row names which and quotes the span
 *   no_letter     the call 4xx'd, timed out, or came back with no parseable letter
 * Rolling the third into the second would be the expensive mistake here. "The prompt regressed" and
 * "the Anthropic key is out of credit" are different problems with different fixes, and an eval
 * that says FAILED for both sends the next person to read a prompt that is fine.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IT DOES NOT DO.
 * ---------------------------------------------------------------------------------------------
 * It writes nothing. No sheet, no Drive, no HQ heartbeat, no ledger row. This harness has no
 * outbound channel at all beyond the six Anthropic calls, which is why it needs no read back and
 * why it has no row in the Outbound Channels table. The answer is the node output, read by the
 * person who pressed Execute.
 */

const E = require('./_eval');

const FP = E.writerFingerprint();

(function assertAgainstUpstream() {
  const metrics = require('./07-case-metrics.js');
  if (metrics.name !== 'Case Metrics') {
    throw new Error('Eval Summary: node 07 is named ' + JSON.stringify(metrics.name) + ' and this node connects from "Case Metrics".');
  }
  if (String(metrics.parameters.jsCode || '').indexOf('_kind: \'eval_result\'') === -1) {
    throw new Error('Eval Summary: Case Metrics no longer emits eval_result rows, so this node would aggregate a shape it does not understand and report zero of zero as a pass.');
  }
}());

/*
 * summariseEval() is declared at column zero for the same reason evaluateLetter() is:
 * config/test-letter-eval.js lifts it and runs THESE BYTES offline. The case that matters most is
 * the one nobody would think to run live, five rows arriving where six were expected, and the
 * assertion that this reports 5/6 and not a pass is the difference between a harness and a habit.
 */
const SUMMARY = `
function summariseEval(rows, K) {
  const passed = rows.filter(function (r) { return r.pass === true; });
  const failed = rows.filter(function (r) { return r.pass !== true && r.outcome === 'letter'; });
  const noLetter = rows.filter(function (r) { return r.outcome !== 'letter'; });

  const scored = rows.length;
  const complete = scored === K.expected;
  const green = complete && passed.length === K.expected;

  const verdict = green
    ? passed.length + '/' + K.expected + ' PASS'
    : (!complete
      ? passed.length + '/' + K.expected + ' PASS, and only ' + scored + ' case(s) were scored at all. A case nobody looked at is not a case that passed.'
      : passed.length + '/' + K.expected + ' PASS, ' + failed.length + ' FAILED, ' + noLetter.length + ' produced no letter');

  // The primary is the check the case exists for. A case that dodged its own bait and tripped
  // something else is a different story from one that failed the thing it was built to catch, and
  // this line is what makes that readable without opening the rows.
  const primaryFails = rows.filter(function (r) { return r.primary_status === 'FAIL'; }).map(function (r) { return r.case_id + ':' + r.primary; });
  const collateral = failed.filter(function (r) { return r.primary_status === 'PASS'; }).map(function (r) { return r.case_id + ' dodged its bait and broke ' + r.failed.join(', '); });

  const line = 'LETTER EVAL ' + verdict +
    '  |  prose node ' + K.sha.slice(0, 12) + ' (' + K.chars + ' chars, verbatim)' +
    '  |  ' + (primaryFails.length ? 'primary failures: ' + primaryFails.join(', ') : 'no primary failure') +
    (collateral.length ? '  |  ' + collateral.join('; ') : '') +
    (noLetter.length ? '  |  no letter: ' + noLetter.map(function (r) { return r.case_id + ' (' + r.outcome + ')'; }).join(', ') : '');

  const usd = rows.reduce(function (a, r) {
    const u = r.usage || {};
    const inTok = (Number(u.input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0) * 1.25 + (Number(u.cache_read_input_tokens) || 0) * 0.1;
    return a + (inTok / 1e6) * K.price_in + ((Number(u.output_tokens) || 0) / 1e6) * K.price_out;
  }, 0);

  return {
    eval: 'job-application-writer-letter-eval (36)',
    verdict_line: line,
    verdict: verdict,
    green: green,
    expected: K.expected,
    scored: scored,
    passed: passed.length,
    failed: failed.length,
    no_letter: noLetter.length,
    prose_node: { name: K.name, sha256: K.sha, chars: K.chars, copy: 'verbatim, taken off nodes/29-build-writer-request.js at build time and pinned against the live box' },
    cost_usd_estimate: Math.round(usd * 1e6) / 1e6,
    failures: failed.map(function (r) {
      return {
        case: r.case_id, lane: r.lane, primary: r.primary, primary_status: r.primary_status,
        seeds: r.seeds, pass_means: r.pass_means, broke: r.failed, detail: r.fail_detail, words: r.words,
      };
    }),
    no_letter_detail: noLetter.map(function (r) { return { case: r.case_id, outcome: r.outcome, http_status: r.http_status, stop_reason: r.stop_reason, why: r.why }; }),
    advisory: rows.filter(function (r) { return (r.advisory || []).length; }).map(function (r) { return { case: r.case_id, notes: r.advisory }; }),
    passes: passed.map(function (r) { return { case: r.case_id, primary: r.primary, words: r.words, paragraphs: r.paragraphs }; }),
  };
}
`;

const LOGIC = `
${SUMMARY}

const rows = $input.all().map((i) => i.json).filter((j) => j && j._kind === 'eval_result');
const summary = summariseEval(rows, { expected: EXPECTED, name: WRITER_NAME, sha: WRITER_SHA, chars: WRITER_CHARS, price_in: PRICE_IN, price_out: PRICE_OUT });
summary.ran_at = new Date().toISOString();
return [{ json: summary, pairedItem: { item: 0 } }];
`;

const jsCode = [
  '// GENERATED at build time from work/36-job-application-writer/nodes-eval/08-eval-summary.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  'const EXPECTED = ' + E.CASES.length + ';',
  'const WRITER_NAME = ' + JSON.stringify(FP.node) + ';',
  'const WRITER_SHA = ' + JSON.stringify(FP.sha256) + ';',
  'const WRITER_CHARS = ' + FP.chars + ';',
  'const PRICE_IN = 2;',
  'const PRICE_OUT = 10;',
  LOGIC,
].join('\n');

module.exports = {
  name: 'Eval Summary',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1820, 0],
  connectFrom: 'Case Metrics',
  notes: 'One verdict line that must read 6/6, the sha256 of the prose node it ran, the per case failures with the offending span quoted, the advisory notes, and an estimated cost. Keeps a failed CHECK apart from a failed CALL, because those have different fixes. Writes nothing anywhere.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

'use strict';
/*
 * 41-grade-letter.js - "Grade Letter". One Anthropic Messages call per graded pair, on
 * claude-sonnet-4-6, returning five verdicts and a top level one.
 *
 * The transport is 31-write-letter.js verbatim, one body field different. Six nodes in this workflow
 * talk to Anthropic and they are deliberately the same node with different bodies.
 *
 * ---------------------------------------------------------------------------------------------
 * 1. WHAT A FAILURE OF THIS CALL MEANS, AND IT IS NOT THE SAME AS THE OTHERS.
 * ---------------------------------------------------------------------------------------------
 * By the time a pair reaches here it has a CV assembled from his frozen master and a letter that
 * passed eighteen deterministic checks. If the grading call itself fails, the work is not lost: the
 * pair is held for review rather than shipped, per D16, because an ungraded letter and a failed
 * letter are treated the same way. That is the conservative reading and it is the right one: D16
 * says nothing that failed the voice check reaches Drive unattended, and a call that never returned
 * is a voice check that did not happen.
 *
 * So fullResponse plus neverError plus onError continueRegularOutput, the same as everywhere else,
 * and Parse Grade decides. The sheet row is left untouched on a systemic failure so the next run
 * offers the job again.
 *
 * ---------------------------------------------------------------------------------------------
 * 2. NO RETRY ON A PAID ENDPOINT.
 * ---------------------------------------------------------------------------------------------
 * /v1/messages has no idempotency key, so a lost response on a call that succeeded server side bills
 * twice. Separately, retryOnFail fires on a node ERROR and neverError removes the error, so it would
 * read as protection while providing none.
 *
 * ---------------------------------------------------------------------------------------------
 * 3. PACING AND THE CACHE WINDOW.
 * ---------------------------------------------------------------------------------------------
 * batchSize 1 with a 1500 ms interval. The rubric system block is identical for every pair and sits
 * just above this model's minimum cacheable prefix, so keeping the calls inside the five minute
 * window is the difference between one cache write and ten full price copies of the rubric.
 * batchSize must be 1: n8n sleeps between BATCHES, not between items.
 */

const LN = require('./_lane');

const L = LN.lane();
const MODEL = LN.STAGE_MODELS.grade;

// Shorter than the writer stages: this is the smallest call in the chain, five verdicts on one page
// of prose, and a grader that has not answered in a minute is not going to.
const TIMEOUT_MS = 60000;
const BATCH_SIZE = 1;
const BATCH_INTERVAL_MS = 1500;

(function assertAgainstUpstream() {
  const route = require('./40-grade-route.js');
  const build = require('./39-build-grade-request.js');
  if (route.name !== 'Grade Route') {
    throw new Error('Grade Letter: node 40 is named ' + JSON.stringify(route.name) + ' and this node hangs off "Grade Route" output 0.');
  }
  const code = String(build.parameters.jsCode || '');
  if (code.indexOf('grade_request') === -1) {
    throw new Error('Grade Letter: Build Grade Request no longer builds grade_request, which is the entire body this node posts. It would send the literal string "undefined".');
  }
  // BLINDNESS IS A PROPERTY OF THE BODY, so it is asserted against the node that builds the body,
  // and it is asserted by reading the whole user turn EXPRESSION rather than by looking for a phrase
  // inside it.
  //
  // The first version of this check asked whether the expression still contained `letter + NL +`.
  // That is satisfied by an expression which ALSO carries the brief, the CV or the audit result, and
  // the offline suite proved it by adding one of those and getting a green. A grader that can see
  // the posting still returns five verdicts; they are simply worth nothing, and nothing downstream
  // can tell the difference. So the rule is stated as what the expression may MENTION: the letter
  // and the literal text around it, and no other field of the pair.
  const at = code.indexOf('const userText =');
  const end = code.indexOf(';\n', at);
  if (at === -1 || end === -1) {
    throw new Error('Grade Letter: Build Grade Request no longer builds a userText expression, which is the body this node posts and the thing that has to stay blind.');
  }
  const expr = code.slice(at, end);
  if (expr.indexOf('letter') === -1) {
    throw new Error('Grade Letter: the grader user turn no longer carries the letter, so there would be nothing to grade.');
  }
  const leaks = expr.match(/\bj\.[A-Za-z_]+|\$json\.[A-Za-z_]+|\bpair\.[A-Za-z_]+/g);
  if (leaks) {
    throw new Error(
      'Grade Letter: the grader user turn reads ' + JSON.stringify(Array.from(new Set(leaks))) + ' off the pair.\n' +
      '  It may carry the letter and nothing else. The whole value of this stage is what the grader\n' +
      '  CANNOT see: a grader that can read the posting, the CV, the screening note or the audit result\n' +
      '  still returns five verdicts, they are simply worth nothing, and nothing downstream can tell.'
    );
  }
  if (!L.credentials || !L.credentials.anthropic) {
    throw new Error('Grade Letter: lane.json has no credentials.anthropic. Refused rather than built without one: n8n renders a permanently disabled credential picker for a missing id and the node 401s on every call.');
  }
  LN.prices(MODEL);
  if (BATCH_SIZE !== 1) {
    throw new Error('Grade Letter: batchSize is ' + BATCH_SIZE + '. n8n sleeps between BATCHES, so any size above 1 sends that many paid calls back to back with no interval at all.');
  }
}());

module.exports = {
  name: 'Grade Letter',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  position: [10140, 0],
  connectFrom: { node: 'Grade Route', outputIndex: 0 },
  onError: 'continueRegularOutput',
  notes: 'The blind grade. One Anthropic /v1/messages call per passing pair, claude-sonnet-4-6, one item per batch with a 1500 ms pause that keeps the identical rubric block inside the five minute cache window. The body comes from Build Grade Request and its user turn is the letter text alone. A failure arrives as data and the pair is HELD rather than shipped, because D16 says nothing that failed the voice check reaches Drive unattended and a call that never returned is a voice check that did not happen. No retry: a retried paid call is a second charge.',
  parameters: {
    method: 'POST',
    url: LN.ANTHROPIC_URL,
    authentication: 'predefinedCredentialType',
    nodeCredentialType: 'anthropicApi',
    sendHeaders: true,
    specifyHeaders: 'keypair',
    headerParameters: {
      parameters: [
        { name: 'anthropic-version', value: LN.ANTHROPIC_VERSION },
      ],
    },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ JSON.stringify($json.grade_request) }}',
    options: {
      timeout: TIMEOUT_MS,
      batching: {
        batch: {
          batchSize: BATCH_SIZE,
          batchInterval: BATCH_INTERVAL_MS,
        },
      },
      response: {
        response: {
          fullResponse: true,
          neverError: true,
          responseFormat: 'json',
        },
      },
    },
  },
  credentials: LN.anthropicCredential(),
};

'use strict';
/*
 * 06-parse-eval-letter.js - "Parse Eval Letter". Takes the six Anthropic answers apart with the
 * runtime's own bytes.
 *
 * ---------------------------------------------------------------------------------------------
 * extractLetter() IS LIFTED, NOT REWRITTEN.
 * ---------------------------------------------------------------------------------------------
 * _stage2.bakedFunction() cuts the function out of the GENERATED jsCode of nodes/33-parse-letter.js
 * and proves the cut by a needle from inside its own body. So the eval decides what counts as "the
 * letter" using the same code the lane uses. That matters more than it looks: the letter is defined
 * as exactly what sits between the two markers, with CRLF normalised and the ends trimmed and
 * NOTHING else, no dash substitution and no whitespace collapse. An eval that trimmed differently
 * would score a different string from the one the audit sees, and the two would disagree about a
 * dash sitting against a marker.
 *
 * Same reasoning for the content[] filter. Adaptive thinking is on by default on this model family
 * and puts a thinking block first, so content[0].text is empty on every call. The runtime filters
 * for type === 'text' and joins; this does the same, and a failure to find any text block is
 * reported as its own outcome rather than as an empty letter that then fails every voice check for
 * the wrong reason.
 *
 * ---------------------------------------------------------------------------------------------
 * PAIRING, AND WHY IT REFUSES RATHER THAN GUESSES.
 * ---------------------------------------------------------------------------------------------
 * The route's output 0 is the authoritative sent order. If the response count does not match it,
 * every case after the gap is scored against another case's letter, and the run would report a
 * plausible mixture of passes and failures with nothing to say it was nonsense. So a mismatch
 * refuses the whole run by name. This is the same guard nodes/33-parse-letter.js carries, for the
 * same reason, and it is the one failure mode in a harness like this that produces confident
 * garbage instead of an error.
 *
 * ---------------------------------------------------------------------------------------------
 * A NON 2xx IS A CASE OUTCOME, NOT A DEAD BRANCH.
 * ---------------------------------------------------------------------------------------------
 * fullResponse plus neverError means a 401, a 429 or a 529 arrives as data. Those are recorded as
 * `call_failed` with the status, and the Eval Summary reports them separately from a letter that
 * came back and failed a check. Six letters that failed and six calls that never happened are very
 * different answers to "is the prompt still good", and rolling them together would be the kind of
 * red that teaches people to stop reading.
 */

const E = require('./_eval');

(function assertAgainstUpstream() {
  const http = require('./05-write-letter.js');
  const route = require('./04-eval-write-route.js');
  if (http.name !== 'Write Letter') throw new Error('Parse Eval Letter: node 05 is named ' + JSON.stringify(http.name) + ' and this node connects from "Write Letter".');
  if (route.name !== 'Eval Write Route') throw new Error('Parse Eval Letter: node 04 is named ' + JSON.stringify(route.name) + ' and this node reads $(\'Eval Write Route\') output 0 for the sent order.');
  const rr = ((http.parameters.options || {}).response || {}).response || {};
  if (rr.fullResponse !== true) {
    throw new Error('Parse Eval Letter: Write Letter no longer sets fullResponse, so this node would read statusCode off an object that has none and classify every healthy call as a transport failure.');
  }
}());

// The markers are read off the prose node rather than retyped, because the prose node is the thing
// that TOLD the model to emit them. If it changes its output format, this parse has to change with
// it, and a hardcoded marker here would keep extracting an empty string and report six clean
// letters of nothing.
const WRITER = require('../nodes/29-build-writer-request.js');
function markerFromWriter(constName) {
  const code = String(WRITER.parameters.jsCode || '');
  const m = new RegExp('\\nconst ' + constName + ' = ("(?:[^"\\\\]|\\\\.)*");').exec(code);
  if (!m) {
    throw new Error(
      'Parse Eval Letter: the prose node no longer declares `const ' + constName + ' = "...";`.\n' +
      '  The markers are read from the node that instructs the model to emit them, never retyped here.\n' +
      '  A stale marker in this file would extract an empty string from every answer and the eval would\n' +
      '  report six failures that are all this node\'s fault.'
    );
  }
  return JSON.parse(m[1]);
}
const LETTER_OPEN = markerFromWriter('LETTER_OPEN');
const LETTER_CLOSE = markerFromWriter('LETTER_CLOSE');
const SCREEN_OPEN = markerFromWriter('SCREEN_OPEN');

const LOGIC = `
const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const SCREEN_LINES_MAX = 12;
const SCREEN_SENTENCE_MAX = 400;

${E.liftedExtractLetter()}

let sent = [];
try { sent = $('Eval Write Route').all(0).map((i) => i.json); } catch (e) { sent = []; }
const responses = $input.all().map((i) => i.json);

if (!sent.length) {
  throw new Error('Parse Eval Letter: Eval Write Route sent nothing on output 0. Every case was held or skipped before the call, which means the prose node refused all six. Read its stage report: the usual cause is a missing soul voice block, which holds a pair fail closed before a token is spent.');
}
if (responses.length !== sent.length) {
  throw new Error('Parse Eval Letter: ' + sent.length + ' case(s) were sent and ' + responses.length + ' response(s) came back. Refusing to pair by position across a gap: every case after it would be scored against another case letter and the run would report a plausible mixture of passes and failures with nothing to say it was nonsense.');
}

const out = [];
for (let i = 0; i < sent.length; i += 1) {
  const c = sent[i]._case || {};
  const row = {
    _kind: 'eval_case',
    case: c,
    master_key: sent[i].master_key,
    voice_block_present: sent[i].voice_block_present === true,
    approved_numbers: (sent[i]._write && sent[i]._write.approved_numbers) || [],
    quote_line: (sent[i].brief && sent[i].brief.quote_verified === true) ? String(sent[i].brief.quote_line || '') : '',
    hook_quote: (sent[i].research && sent[i].research.hook) ? String(sent[i].research.hook.quote || '') : '',
    outcome: null,
    why: null,
    http_status: null,
    stop_reason: null,
    usage: null,
    letter_text: '',
    screen: { raw: '', lines: [], had_screen: false },
    letter_raw: '',
  };

  const j = responses[i] || {};

  if (j.error !== undefined && j.statusCode === undefined) {
    row.outcome = 'call_failed';
    row.why = 'the request never completed: ' + String(typeof j.error === 'string' ? j.error : (j.error && j.error.message) || JSON.stringify(j.error)).slice(0, 240);
    out.push(row);
    continue;
  }
  const status = Number(j.statusCode);
  if (!isFinite(status)) {
    row.outcome = 'call_failed';
    row.why = 'the response carried no statusCode, and fullResponse is set on Write Letter, so this item is not an HTTP response at all.';
    out.push(row);
    continue;
  }
  row.http_status = status;
  const body = j.body;
  if (status < 200 || status >= 300) {
    row.outcome = 'call_failed';
    const msg = (body && body.error && (body.error.message || body.error.type)) || '';
    row.why = 'HTTP ' + status + (msg ? ': ' + String(msg).slice(0, 200) : '') + '. No letter was produced, so nothing about the PROMPT was measured by this case.';
    out.push(row);
    continue;
  }

  row.usage = (body && body.usage) || null;
  row.stop_reason = (body && body.stop_reason) || 'unknown';
  const content = (body && Array.isArray(body.content)) ? body.content : [];
  const textBlocks = content.filter((b) => b && b.type === 'text');
  const answer = textBlocks.map((b) => String(b.text === undefined || b.text === null ? '' : b.text)).join(NL);
  row.letter_raw = answer.slice(0, 8000);

  if (!answer.trim()) {
    row.outcome = 'no_text';
    row.why = row.stop_reason === 'max_tokens'
      ? 'the answer hit max_tokens before producing any text. Adaptive thinking is on by default on this model and max_tokens caps thinking and text together, so the whole budget went to reasoning. Content block types seen: ' + JSON.stringify(content.map((b) => (b && b.type) || 'unknown'))
      : 'the answer carried ' + content.length + ' content block(s) and none of them was a text block (types ' + JSON.stringify(content.map((b) => (b && b.type) || 'unknown')) + ').';
    out.push(row);
    continue;
  }

  const ex = extractLetter(answer, LETTER_OPEN, LETTER_CLOSE, SCREEN_OPEN);
  if (!ex.ok) {
    row.outcome = 'unparseable';
    row.why = ex.why + (row.stop_reason === 'max_tokens' ? ' The answer also hit max_tokens, which is the likely cause of a missing close marker.' : '');
    out.push(row);
    continue;
  }

  row.outcome = 'letter';
  row.letter_text = ex.letter;
  row.screen = { raw: ex.screen_raw, lines: ex.screen_lines, had_screen: ex.had_screen };
  out.push(row);
}

return out.map((j) => ({ json: j, pairedItem: { item: 0 } }));
`;

const jsCode = [
  '// GENERATED at build time from work/36-job-application-writer/nodes-eval/06-parse-eval-letter.js.',
  '// Edit that file and re-run build.js. Editing this node in the n8n editor loses the change.',
  '//',
  '// extractLetter() below is LIFTED VERBATIM out of the generated code of',
  '// nodes/33-parse-letter.js, so the eval and the lane agree byte for byte about what "the letter"',
  '// is. The markers are read off the prose node, which is what told the model to emit them.',
  'const LETTER_OPEN = ' + JSON.stringify(LETTER_OPEN) + ';',
  'const LETTER_CLOSE = ' + JSON.stringify(LETTER_CLOSE) + ';',
  'const SCREEN_OPEN = ' + JSON.stringify(SCREEN_OPEN) + ';',
  LOGIC,
].join('\n');

module.exports = {
  name: 'Parse Eval Letter',
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: [1300, 0],
  connectFrom: 'Write Letter',
  notes: 'One row per case: the extracted letter, the screening note, the HTTP status, the stop reason and the usage. extractLetter is lifted verbatim from nodes/33-parse-letter.js and the three markers are read off the prose node. Refuses the whole run if the response count does not match the sent count, because pairing across a gap produces confident nonsense.',
  parameters: {
    mode: 'runOnceForAllItems',
    jsCode,
  },
};

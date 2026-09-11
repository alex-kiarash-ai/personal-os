#!/usr/bin/env node
'use strict';
/*
 * outbound-log.js - one line per outbound tool call, so "what left this machine" is a question
 * with an answer.
 *
 * WHY (A16-T-12 / A16-T22, P-55 third sighting). The 2026-08-05 assessment counted 8 outbound
 * channel classes and asked for an inventory in the constitution. That never landed. By 2026-09-04
 * the count was 15 and three of them were instrumented: git-backup (a log line and an HQ status),
 * the HQ pushes (one line per caller) and n8n (the box's own execution ledger). Every MCP write,
 * every WebFetch, WebSearch and Exa search, claude-in-chrome and Artifacts had no per-send record
 * anywhere. After the fact there was no way to answer which of them had run, in a system that
 * routinely runs fifteen unattended lanes over attacker-controllable email.
 *
 * WHAT IT RECORDS, and deliberately not more: timestamp, tool name, and the HOST when the payload
 * carries an obvious one. Never arguments, never bodies, never a URL path or query string. This
 * file answers "did something go out, where to, when" and is useless for reconstructing content,
 * which is the correct trade for a log that will sit on disk unencrypted for months.
 *
 * FAIL-OPEN, ALWAYS. A PostToolUse hook runs after the call has already happened, so failing here
 * cannot prevent anything; it can only break a working lane. Every path exits 0.
 */

const fs = require('fs');
const path = require('path');

const REPO = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
const LOG = path.join(REPO, 'outputs', 'logs', 'outbound.jsonl');

/** Pull a hostname out of a payload without keeping anything else from it. */
function hostOf(input) {
  try {
    const flat = JSON.stringify(input || {});
    const m = flat.match(/https?:\/\/([A-Za-z0-9._-]+)/);
    if (m) return m[1];
  } catch { /* unstringifiable payload: the tool name alone is still worth a row */ }
  return null;
}

let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  try {
    const hook = JSON.parse(raw || '{}');
    const tool = String(hook.tool_name || '');
    if (!tool) return process.exit(0);
    const row = {
      ts: new Date().toISOString(),
      tool,
      host: hostOf(hook.tool_input),
      // The lane flag is the difference between "Shaheen asked for this" and "an unattended run
      // reading email decided to". Worth one boolean.
      lane: process.env.ALEX_UNTRUSTED_LANE || null,
    };
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, JSON.stringify(row) + '\n', 'utf8');
  } catch { /* fail open: this runs AFTER the call, so it can only break things, never prevent them */ }
  process.exit(0);
});
process.stdin.on('error', () => process.exit(0));

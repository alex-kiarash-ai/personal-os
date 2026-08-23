#!/usr/bin/env node
'use strict';
/*
 * scripts/hooks/lifecycle.js - PreCompact / SessionEnd / PostToolUseFailure. (P3.4-P3.6, run-47.)
 *
 * ONE script, three events, because they share every mechanic that matters: read stdin, append one
 * row, optionally emit a short additionalContext, and NEVER fail. Three near-identical files would
 * be three things to keep correct.
 *
 * WHY THESE THREE. Each replaces a standing rule that only works when the model remembers it:
 *   - PreCompact  <- "Re-read the soul core after context compaction" (root CLAUDE.md). A rule.
 *   - SessionEnd  <- the Close-Out Gate's printed report. A checklist a tired session can skip,
 *                    and its absence was previously invisible: nothing counted the sessions that
 *                    ended without one, so the denominator for "how often do we skip it" was unknown.
 *   - PostToolUseFailure <- "check vault/projects/error-log.md for past fixes before retrying"
 *                    (the Self-Correction Loop). Prose that fires only if the model recalls it at
 *                    exactly the wrong moment: right after something broke.
 *
 * CONTRACT (all three): fail-OPEN, always exit 0, never throw. A lifecycle hook that breaks a
 * session is far worse than one that misses a row. stdout stays SMALL and is only ever emitted as
 * hookSpecificOutput.additionalContext (the harness truncates large hook stdout at ~10KB - the
 * measured D5 defect - so nothing here ever approaches it).
 *
 * Usage (from .claude/settings.json):
 *   node scripts/hooks/lifecycle.js precompact
 *   node scripts/hooks/lifecycle.js sessionend
 *   node scripts/hooks/lifecycle.js toolfail
 */
const fs = require('fs');
const path = require('path');

const REPO = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
const LOGDIR = path.join(REPO, 'outputs', 'logs');
const STATE = path.join(REPO, 'system', 'lifecycle.jsonl');
const ERRLOG = path.join(REPO, 'vault', 'projects', 'error-log.md');

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_) { return ''; }
}

function appendRow(row) {
  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    const withKey = { ts: now(), ...row };
    if (process.env.ALEX_RUN_ID) withKey.run_id = process.env.ALEX_RUN_ID; // P1.1 join key
    fs.appendFileSync(STATE, JSON.stringify(withKey) + '\n', 'utf8');
  } catch (_) { /* best effort, never fatal */ }
}

function emit(context) {
  if (!context) return;
  try {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: EVENT_NAME[MODE] || 'SessionStart', additionalContext: context },
    }));
  } catch (_) { /* ignore */ }
}

const MODE = (process.argv[2] || '').toLowerCase();
const EVENT_NAME = { precompact: 'PreCompact', sessionend: 'SessionEnd', toolfail: 'PostToolUseFailure' };

function main() {
  const raw = readStdin();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch (_) { payload = {}; }

  if (MODE === 'precompact') {
    // The telemetry half works regardless of whether stdout survives compaction, and it answers a
    // question nothing could answer before: how often compaction actually fires. The context half is
    // best-effort - if the harness carries it across, the post-compaction model gets the standing
    // re-read rule at the exact moment it matters.
    appendRow({ event: 'precompact', cwd: payload.cwd || null, trigger: payload.trigger || null });
    emit('CONTEXT WAS JUST COMPACTED. Re-read the loaded soul core (soul-core.md) before any output in Shaheen\'s voice, and re-read the plan of record for this session before continuing work. This is the standing rule from root CLAUDE.md, delivered mechanically.');
    return;
  }

  if (MODE === 'sessionend') {
    // Was a Close-Out Report actually printed? The session transcript is not readable from here, so
    // the honest proxy is the day's logs: a Close-Out line written today by anything. MISSING is
    // recorded as a fact rather than inferred later, which is what gives /self-review a denominator.
    let closeOutSeen = false;
    try {
      const today = new Date().toISOString().slice(0, 10);
      for (const f of fs.readdirSync(LOGDIR).filter((x) => x.endsWith('.log'))) {
        const st = fs.statSync(path.join(LOGDIR, f));
        if (st.mtime.toISOString().slice(0, 10) !== today) continue;
        const tail = fs.readFileSync(path.join(LOGDIR, f), 'utf8').slice(-20000);
        if (/Close-Out\s*\[/i.test(tail)) { closeOutSeen = true; break; }
      }
    } catch (_) { /* unreadable logs are not a reason to fail */ }
    appendRow({ event: 'sessionend', reason: payload.reason || null, close_out_seen: closeOutSeen });
    return;
  }

  if (MODE === 'toolfail') {
    // Mechanizes the Self-Correction Loop's first step. Looks up the FAILING tool/server name in
    // error-log.md and hands back the matching past fix at the moment of failure, instead of relying
    // on the model to remember to go looking. Advisory only, never blocking: Alex's MCP fleet is
    // mostly remote and OAuth-gated, where a probe cannot see auth state, so a false "unhealthy"
    // verdict would be worse than the failed call it replaced.
    const tool = String(payload.tool_name || payload.toolName || '').trim();
    appendRow({ event: 'toolfail', tool: tool || null });
    if (!tool) return;
    // Match the distinctive part of an MCP tool name (mcp__notion__x -> notion).
    const parts = tool.split('__').filter(Boolean);
    const needle = (parts.length > 1 ? parts[1] : parts[0]).toLowerCase();
    if (needle.length < 3) return;
    try {
      const log = fs.readFileSync(ERRLOG, 'utf8');
      const all = log.split(/^## /m);
      // Prefer an entry whose HEADING names the failing tool: a block that merely mentions it in
      // passing produces a related-but-wrong fix, which is worse than none at this moment.
      const byHeading = all.filter((b) => b.split('\n')[0].toLowerCase().includes(needle));
      const byBody = all.filter((b) => b.toLowerCase().includes(needle));
      const blocks = byHeading.length ? byHeading : byBody;
      if (!blocks.length) return;
      const newest = blocks[blocks.length - 1];
      const fixLine = (newest.match(/^[-*]?\s*\*\*Fix.*$/mi) || [])[0];
      const head = newest.split('\n')[0].trim();
      const out = fixLine
        ? `PAST FIX FOUND for "${needle}" in vault/projects/error-log.md (## ${head}):\n${fixLine.trim()}\nUse it before retrying; do not repeat the failed approach.`
        : `error-log.md has a past entry for "${needle}" (## ${head}). Read it before retrying.`;
      emit(out.slice(0, 900));
    } catch (_) { /* no error log, nothing to offer */ }
    return;
  }
}

try { main(); } catch (_) { /* fail open, always */ }
process.exit(0);

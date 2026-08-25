#!/usr/bin/env node
'use strict';
/*
 * scripts/hooks/skill-usage.js - PostToolUse telemetry for the Skill tool. (P5.1, run-47 plan.)
 *
 * WHY. 85 skills are installed and 45 were parked on 2026-08-16 by a manual docket cross-off,
 * because there was no usage data to decide with and there still is not. Nothing anywhere records
 * which skills actually fire. Every park/wake and every retire decision is therefore judgment
 * applied to an unmeasured set, and the quarterly stocktake (P5.2) would inherit exactly that
 * problem. Measure first, curate second.
 *
 * PRIVACY BY CONSTRUCTION. It records the skill NAME and a timestamp. Not the prompt, not the
 * arguments, not the result. There is nothing in a row that could leak anything, which is why it can
 * run on every tool call without a second thought. Output is gitignored (system/* default-deny).
 *
 * COST. Zero model tokens, one appended line, fail-open and always exit 0 - a telemetry hook that can
 * break a tool call is not worth having.
 */
const fs = require('fs');
const path = require('path');

const REPO = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, '..', '..');
const OUT = path.join(REPO, 'system', 'skill-usage.jsonl');

try {
  if (String(process.env.ALEX_DISABLED_HOOKS || '').split(',').map((s) => s.trim()).includes('skill-usage')) process.exit(0);

  let payload = {};
  try { payload = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (_) { payload = {}; }

  const tool = String(payload.tool_name || payload.toolName || '');
  if (tool === 'Skill') {
    const inp = payload.tool_input || payload.toolInput || {};
    const skill = String(inp.skill || inp.name || '').trim();
    if (skill) {
      const row = { ts: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), skill };
      if (process.env.ALEX_RUN_ID) row.run_id = process.env.ALEX_RUN_ID; // P1.1 join key
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.appendFileSync(OUT, JSON.stringify(row) + '\n', 'utf8');
    }
  }
} catch (_) { /* fail open, always */ }
process.exit(0);

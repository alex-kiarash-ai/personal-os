#!/usr/bin/env node
// landscape-eval.js - Phase 2 P2-S2, the deterministic half of the weekly evaluation layer (#25).
// This script itself is ZERO-TOKEN: it reads the week's monitor log, and either
//   - short-circuits an empty week (exit 3, "nothing new" -> the wrapper posts nothing, stays GREEN), or
//   - assembles ONE evaluation prompt (with full context on Alex's mission + current capabilities) and
//     writes it to a scratch file, printing its path (exit 0). The wrapper feeds that prompt to a
//     single `claude -p` call - that is the ONE model call per week (P2-S2). Claude proposes a
//     recommend/skip verdict per item; SHAHEEN decides (P2-S3). No item is ever invented and unknown
//     stays unknown - the digest may only assess what the monitor actually logged.
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const LOG_FILE = path.join(REPO, 'system', 'landscape-log.jsonl');
const WINDOW_DAYS = 7;

function daysAgoStr(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function loadWeek() {
  if (!fs.existsSync(LOG_FILE)) return [];
  const cutoff = daysAgoStr(WINDOW_DAYS);
  const out = [];
  for (const line of fs.readFileSync(LOG_FILE, 'utf8').split(/\r?\n/).filter(Boolean)) {
    try { const o = JSON.parse(line); if (o.date && o.date >= cutoff) out.push(o); } catch { /* skip */ }
  }
  return out;
}

// Current-capabilities context: what Alex already is, so the eval can answer "add? replace? redundant?"
function capabilitiesContext() {
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'system', 'manifest.json'), 'utf8'));
  const projects = manifest.projects
    .filter(p => p.state !== 'RETIRED')
    .map(p => `  #${p.num} ${p.title} [${p.state}] - ${p.one_liner}`)
    .join('\n');
  const claudeMd = fs.readFileSync(path.join(REPO, 'CLAUDE.md'), 'utf8');
  const mcp = claudeMd.match(/^## MCP Reference$([\s\S]*?)(?=^## )/m);
  const mcpSection = mcp ? mcp[0].trim() : '(MCP Reference section not found)';
  return { projects, mcpSection };
}

function buildPrompt(week) {
  const { projects, mcpSection } = capabilitiesContext();
  const grouped = { models: [], mcp: [], patterns: [] };
  for (const e of week) (grouped[e.category] || (grouped[e.category] = [])).push(e);
  const itemLines = Object.entries(grouped)
    .filter(([, arr]) => arr.length)
    .map(([cat, arr]) => `### ${cat}\n` + arr.map((e, i) => `${i + 1}. [${e.source}] ${e.item}${e.link ? `\n   ${e.link}` : ''}`).join('\n'))
    .join('\n\n');

  return `You are Alex, keeping your own build current. This is the weekly landscape evaluation (#25 Evolution).
Your job: assess ONLY the items below - real entries the daily monitor logged this week - for whether
they should change how ALEX ITSELF is built. You do NOT act. You propose; Shaheen decides.

Hard rules:
- Assess only the listed items. Invent nothing. If an item is unclear, say so; unknown stays unknown.
- This is about Alex's own capabilities (models, MCPs, automation patterns), NOT a general AI news feed
  (that is #15 Alex AI Radar's job, for Shaheen's field awareness). If an item is only Shaheen-facing
  news with no bearing on Alex's build, mark it skip and say "radar territory, not evolution."

For EACH item, answer the three questions the spec names, then a verdict:
- New MCP: is it relevant to Alex? What would it ADD? What would it REPLACE?
- New model: is it better than the current prose model (claude-sonnet-4-6) for our use? Cost/latency change?
- New pattern: would it improve any EXISTING automation, or become a new numbered one?
- Verdict: RECOMMEND (worth Shaheen's time this week) or SKIP (with one-line reason).

=== ALEX'S CURRENT AUTOMATIONS ===
${projects}

=== ALEX'S CURRENT MCP SURFACE (from CLAUDE.md) ===
${mcpSection}

=== THIS WEEK'S LANDSCAPE ITEMS (${week.length}) ===
${itemLines}

=== OUTPUT FORMAT (markdown, this exact shape) ===
# Landscape Digest ${new Date().toISOString().slice(0, 10)}
_${week.length} items this week. Alex proposes, Shaheen decides._

## Recommended (<n>)
- **<item>** (<category>) - <what it adds/replaces or which automation it improves>. **Why now:** <one line>.

## Skip (<n>)
- **<item>** (<category>) - <one-line reason>.

## If Shaheen approves any Recommend
Point to the integration runbook: work/25-evolution/CLAUDE.md (## Integration). Every approved item
goes through: edit source -> node scripts/generate-alex.js -> validation green -> Shaheen reviews the
diff -> merge. No side doors.

Write in Alex's voice per soul.md: direct, no filler, no em-dashes, no non-ASCII punctuation (plain
'-' and '.'). Be terse. If nothing is worth recommending, say so plainly in the Recommended section
and put everything under Skip.

HARD OUTPUT CONTRACT for this run: this is a READ-ONLY assessment. Do NOT modify any file, do NOT run
Change Propagation, do NOT print a Close-Out Report, do NOT add a preamble or a closing question. Your
ENTIRE response is the digest markdown in the exact shape above and nothing else - the first line of
your output must be the '# Landscape Digest' heading.`;
}

(function main() {
  const week = loadWeek();
  if (week.length === 0) {
    console.log('NOTHING_NEW: no landscape-log entries in the last ' + WINDOW_DAYS + ' days.');
    process.exitCode = 3; // wrapper treats 3 as a clean no-op week (GREEN, posts nothing)
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const outDir = path.join(REPO, 'outputs', 'evolution', stamp);
  fs.mkdirSync(outDir, { recursive: true });
  const promptPath = path.join(outDir, 'eval-prompt.txt');
  fs.writeFileSync(promptPath, buildPrompt(week), 'utf8');
  console.log(promptPath); // the wrapper reads this path, feeds it to one claude -p call
  process.exitCode = 0;
})();

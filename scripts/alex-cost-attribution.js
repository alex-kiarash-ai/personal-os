#!/usr/bin/env node
/*
 * alex-cost-attribution.js - per-project token-cost attribution (cost-attribution v1, 2026-07-15,
 * /prompting item 3, promoting alex-costs from cash-only to "which project ate the quota").
 *
 * The gap it closes: the quota gate knows the plan is capped but not WHICH project spent it. Under
 * per-interaction billing the bill has no line items. The join key already exists at zero cost: every
 * scheduled wrapper spawns `claude -p "Run /{command}"`, so a Claude Code session's FIRST user message
 * names the command. This parses the local session logs and rolls up notional token cost per project
 * per week. Deterministic, ZERO Claude calls (so the cap it measures can never stop it).
 *
 * SCOPE (v1): LOCAL Claude Code sessions only (interactive Alex + the scheduled `claude -p` wrappers),
 * which had NO per-project itemisation before. The n8n engines' API cost (#03/#14) is already attributed
 * in run_log (the alex-costs Usage sheet / the #08 merge), so it is pointed at here, not re-derived -
 * re-deriving it from the executions API is v1.1. This answers "what did each project cost", NOT
 * "was it worth it": nothing records what was READ, only what was produced (deliverables ledger).
 *
 * Cost is NOTIONAL (Shaheen is on a flat Max plan): a token-cost proxy for quota consumption, using
 * published per-model rates. Rates are approximate + configurable below. Cache write = 1.25x input,
 * cache read = 0.1x input (Anthropic standard).
 *
 * Usage:
 *   node scripts/alex-cost-attribution.js                 # full history -> outputs/alex-costs/<today>/
 *   node scripts/alex-cost-attribution.js --weeks 8       # limit the per-week table to the last N weeks
 *   node scripts/alex-cost-attribution.js --since 2026-07-01
 * Env: ALEX_CC_PROJECTS_DIR overrides the session-log dir (default: ~/.claude/projects/<repo-slug>).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');

// USD per 1M tokens. Matched by model-id prefix, so version suffixes still hit. Approximate + editable.
const PRICING = {
  'claude-opus':   { in: 15,  out: 75 },
  'claude-sonnet': { in: 3,   out: 15 },
  'claude-haiku':  { in: 0.8, out: 4 },
  'claude-fable':  { in: 15,  out: 75 },
};
const CACHE_WRITE_MULT = 1.25;
const CACHE_READ_MULT = 0.10;
const DEFAULT_RATE = PRICING['claude-sonnet']; // unknown model -> sonnet rate (flagged in output)

function rateFor(model) {
  if (!model) return { rate: DEFAULT_RATE, known: false };
  for (const key of Object.keys(PRICING)) if (model.startsWith(key)) return { rate: PRICING[key], known: true };
  return { rate: DEFAULT_RATE, known: false };
}

function costUSD(model, u) {
  const { rate } = rateFor(model);
  return (
    (u.in || 0) * rate.in +
    (u.out || 0) * rate.out +
    (u.cw || 0) * rate.in * CACHE_WRITE_MULT +
    (u.cr || 0) * rate.in * CACHE_READ_MULT
  ) / 1e6;
}

function isoWeek(d) {
  // ISO-8601 week, e.g. 2026-W29. Cheap + stable for weekly buckets.
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7; // Mon=0
  t.setUTCDate(t.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// project attribution: build {command -> projectName} from the manifest so it never drifts.
function commandMap() {
  const m = JSON.parse(fs.readFileSync(path.join(REPO, 'system', 'manifest.json'), 'utf8'));
  const map = {};
  const add = (cmds, name) => (cmds || []).forEach((c) => { map[c] = name; });
  (m.projects || []).forEach((p) => add(p.commands, p.name));
  ((m.meta && m.meta.unnumbered) || []).forEach((p) => add(p.commands, p.name));
  ((m.meta && m.meta.utility_commands) || []).forEach((c) => { map[c] = 'utility'; });
  return map;
}

function firstUserText(o) {
  const c = o && o.message && o.message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : x.text || '')).join(' ');
  return '';
}

// pick the first /command token that is a known command; else 'interactive'.
function classify(text, map) {
  if (!text) return 'interactive';
  const tokens = text.match(/\/([a-z][a-z0-9-]{2,})/gi) || [];
  for (const tok of tokens) {
    const cmd = tok.slice(1).toLowerCase();
    if (map[cmd]) return map[cmd];
  }
  return 'interactive';
}

function main() {
  const args = process.argv.slice(2);
  const weeksArg = args.includes('--weeks') ? parseInt(args[args.indexOf('--weeks') + 1], 10) : 8;
  const sinceArg = args.includes('--since') ? args[args.indexOf('--since') + 1] : null;
  const since = sinceArg ? new Date(sinceArg + 'T00:00:00Z') : null;

  const slug = REPO.replace(/[\\/:]/g, '-'); // C:\...\personal-os -> C--...-personal-os (one dash per sep)
  const dir = process.env.ALEX_CC_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects', slug);
  if (!fs.existsSync(dir)) {
    console.error(`session-log dir not found: ${dir}\nset ALEX_CC_PROJECTS_DIR to override.`);
    process.exit(2);
  }
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));

  // rollup[project] = { cost, sessions, in, out, cr, cw, weeks:{ isoWeek: cost } }
  const roll = {};
  const weeksSeen = new Set();
  let unknownModels = new Set();
  let parsed = 0, skipped = 0;

  files.forEach((fname, i) => {
    if (i % 60 === 0) process.stderr.write(`  parsing ${i}/${files.length}...\n`);
    let lines;
    try { lines = fs.readFileSync(path.join(dir, fname), 'utf8').split('\n'); } catch { skipped++; return; }
    let cmdText = null, sessDate = null;
    const models = {}; // model -> {in,out,cr,cw}
    for (const line of lines) {
      if (!line) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (!sessDate && o.timestamp) sessDate = new Date(o.timestamp);
      if (cmdText === null && o.type === 'user' && o.message) { const t = firstUserText(o); if (t) cmdText = t; }
      if (o.type === 'assistant' && o.message && o.message.usage && o.message.model && o.message.model !== '<synthetic>') {
        const m = o.message.model, u = o.message.usage;
        const acc = (models[m] = models[m] || { in: 0, out: 0, cr: 0, cw: 0 });
        acc.in += u.input_tokens || 0; acc.out += u.output_tokens || 0;
        acc.cr += u.cache_read_input_tokens || 0; acc.cw += u.cache_creation_input_tokens || 0;
      }
    }
    if (!sessDate) { try { sessDate = fs.statSync(path.join(dir, fname)).mtime; } catch { sessDate = new Date(); } }
    if (since && sessDate < since) return;
    const totals = { in: 0, out: 0, cr: 0, cw: 0 };
    let cost = 0;
    for (const [m, u] of Object.entries(models)) {
      cost += costUSD(m, u);
      if (!rateFor(m).known) unknownModels.add(m);
      totals.in += u.in; totals.out += u.out; totals.cr += u.cr; totals.cw += u.cw;
    }
    parsed++;
    const project = classify(cmdText, CMD);
    const wk = isoWeek(sessDate);
    weeksSeen.add(wk);
    const r = (roll[project] = roll[project] || { cost: 0, sessions: 0, in: 0, out: 0, cr: 0, cw: 0, weeks: {} });
    r.cost += cost; r.sessions += 1; r.in += totals.in; r.out += totals.out; r.cr += totals.cr; r.cw += totals.cw;
    r.weeks[wk] = (r.weeks[wk] || 0) + cost;
  });

  const recentWeeks = [...weeksSeen].sort().slice(-weeksArg);
  const projects = Object.entries(roll).sort((a, b) => b[1].cost - a[1].cost);
  const grand = projects.reduce((s, [, r]) => s + r.cost, 0);
  const usd = (n) => `$${n.toFixed(2)}`;
  const M = (n) => `${(n / 1e6).toFixed(1)}M`;

  let md = `# Alex cost attribution (local Claude Code sessions)\n\n`;
  md += `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} from ${parsed} sessions in \`${path.relative(os.homedir(), dir)}\`. `;
  md += `Notional token cost (flat Max plan; a quota-consumption proxy), rates approximate + configurable in the script. `;
  md += `Cache read priced at ${CACHE_READ_MULT}x input, cache write ${CACHE_WRITE_MULT}x.\n\n`;
  md += `**Scope:** LOCAL sessions only. The n8n engines' API cost (#03/#14) is tracked in run_log / the alex-costs Usage sheet, not re-derived here (v1.1). This is the cost half only: nothing records what was READ, so it answers "what did this cost", not "was it worth it".\n\n`;

  md += `## Per project (all time in the log)\n\n`;
  md += `| Project | Sessions | Notional cost | Share | In | Out | Cache read |\n|---|--:|--:|--:|--:|--:|--:|\n`;
  for (const [name, r] of projects) {
    md += `| ${name} | ${r.sessions} | ${usd(r.cost)} | ${grand ? ((r.cost / grand) * 100).toFixed(0) : 0}% | ${M(r.in)} | ${M(r.out)} | ${M(r.cr)} |\n`;
  }
  md += `| **TOTAL** | **${parsed}** | **${usd(grand)}** | 100% | | | |\n\n`;

  md += `## Per project x last ${recentWeeks.length} weeks (notional cost)\n\n`;
  md += `| Project | ${recentWeeks.join(' | ')} |\n|---|${recentWeeks.map(() => '--:').join('|')}|\n`;
  for (const [name, r] of projects) {
    const cells = recentWeeks.map((w) => (r.weeks[w] ? usd(r.weeks[w]) : ''));
    if (cells.some((c) => c)) md += `| ${name} | ${cells.join(' | ')} |\n`;
  }
  md += `\n`;
  if (unknownModels.size) md += `> Unknown models priced at the sonnet default: ${[...unknownModels].join(', ')}\n`;

  const outDir = path.join(REPO, 'outputs', 'alex-costs', new Date().toISOString().slice(0, 10));
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'cost-attribution.md');
  fs.writeFileSync(outPath, md, 'utf8');

  // stdout summary
  console.log(`\nAlex cost attribution (local sessions): ${parsed} sessions, notional total ${usd(grand)}`);
  console.log(`top projects by cost:`);
  projects.slice(0, 6).forEach(([n, r]) => console.log(`  ${usd(r.cost).padStart(9)}  ${String(Math.round((r.cost / grand) * 100)).padStart(3)}%  ${n} (${r.sessions} sessions)`));
  console.log(`table -> ${path.relative(REPO, outPath)}`);
}

const CMD = commandMap();
main();

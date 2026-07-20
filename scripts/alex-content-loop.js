#!/usr/bin/env node
/*
 * alex-content-loop.js - the CONTENT outcome loop v1 (Content Agent build 2026-07-20).
 *
 * The content twin of scripts/alex-outcome-loop.js. Same thesis (results write back so the next
 * cycle reads the winners), same honesty rail, same zero-Claude determinism - but a content-shaped
 * schema, because the job loop resolves CATEGORICAL outcomes (response/interview) while a post
 * resolves a CONTINUOUS one (engagement per impression). Forcing both shapes into one file would
 * bloat the job loop that deliberately stays dumb, so this is a clean sibling, not a fork.
 *
 * SCOPE (v1): Building Alex LinkedIn episodes (#12) ONLY. Modeling (#30) and any second content
 * channel come later and only if this loop proves it is read and acted on (same 60-day rail).
 *
 * SOURCE TABLE (Tier 2, append-only):
 *   vault/projects/linkedin-series/outcomes/posts.jsonl
 * One row per post; the LAST row per post_id wins (updates are appends). Row schema (see README.md):
 *   { post_id, date_posted, episode, title,
 *     variant:{ hook_type, framing, format, topic },
 *     metrics:{ impressions, reactions, comments, reposts },
 *     status:"pending"|"resolved", resolved_date, source:"manual"|"brief", note }
 * A row is RESOLVED the moment real metrics are logged (impressions >= 1). Fed by Shaheen logging a
 * post's numbers ("/content-agent log ep-05 4200 61 9") or by a run reporting them. Rule-based only.
 *
 * GENERATED (into the same Tier 2 folder + the ready block, never hand-edited):
 *   winners.json                                          - machine-readable winning patterns
 *   report-section.md                                     - decisions for the weekly report / brief
 *   work/12-linkedin-series/content-winners.block.md      - marker-wrapped block for the drafter
 *
 * HONESTY RAIL: a variant value earns a "winner" call only at >= MIN_RESOLVED resolved posts. Below
 * that the loop reports "accumulating - insufficient signal" and declares nothing. A 60-day window
 * decides keep-or-shrink. It earns its place the way the job loop and the vault must; nothing is
 * believed, everything is counted. Ranking output BELOW the gate must say so out loud.
 *
 * Usage:
 *   node scripts/alex-content-loop.js                          # aggregate -> winners.json + section + block
 *   node scripts/alex-content-loop.js add --post-id ep-06 --episode 06 --title "..." \
 *        --hook contrarian --framing lesson --format text --topic memory                # register a drafted post
 *   node scripts/alex-content-loop.js log ep-05 4200 61 9 3                              # impressions reactions comments [reposts]
 *   node scripts/alex-content-loop.js status                   # counts, no write
 *
 * Zero external calls. Zero Claude calls. Safe to run headless in the nightly chain.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const OUT_DIR = path.join(REPO, 'vault', 'projects', 'linkedin-series', 'outcomes');
const TABLE = path.join(OUT_DIR, 'posts.jsonl');
const WINNERS = path.join(OUT_DIR, 'winners.json');
const SECTION = path.join(OUT_DIR, 'report-section.md');
const READY_BLOCK = path.join(REPO, 'work', '12-linkedin-series', 'content-winners.block.md');

const MIN_RESOLVED = 4;          // a variant value needs this many RESOLVED posts before it can win
const MEASURE_DAYS = 60;         // the honesty-rail measurement window (~8 weekly posts)
const DIMS = ['hook_type', 'framing', 'format', 'topic'];
const today = () => new Date().toISOString().slice(0, 10);

function ensureDir() { fs.mkdirSync(OUT_DIR, { recursive: true }); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

// a post is resolved once real impressions are logged; engagement rate = engagements / impressions
function isResolved(r) { return r.metrics && Number.isFinite(r.metrics.impressions) && r.metrics.impressions >= 1; }
function engRate(r) {
  const m = r.metrics || {};
  const eng = (num(m.reactions) || 0) + (num(m.comments) || 0) + (num(m.reposts) || 0);
  return m.impressions >= 1 ? eng / m.impressions : 0;
}

function readTable() {
  if (!fs.existsSync(TABLE)) return [];
  return fs.readFileSync(TABLE, 'utf8').split('\n').filter(Boolean).map((l, i) => {
    try { return JSON.parse(l); } catch { console.error(`  skipping malformed row ${i + 1}`); return null; }
  }).filter(Boolean);
}

// --- add / update one post row (last write wins per post_id) ----------------------------------------
function cmdAdd(args) {
  ensureDir();
  const get = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
  const postId = get('post-id');
  if (!postId) { console.error('add: --post-id is required'); process.exit(1); }
  const rows = readTable();
  const existing = [...rows].reverse().find((r) => r.post_id === postId);
  const prevVar = (existing && existing.variant) || {};
  const prevMet = (existing && existing.metrics) || {};
  const metrics = {
    impressions: get('impressions') !== undefined ? num(get('impressions')) : (prevMet.impressions ?? null),
    reactions: get('reactions') !== undefined ? num(get('reactions')) : (prevMet.reactions ?? null),
    comments: get('comments') !== undefined ? num(get('comments')) : (prevMet.comments ?? null),
    reposts: get('reposts') !== undefined ? num(get('reposts')) : (prevMet.reposts ?? null),
  };
  const resolved = Number.isFinite(metrics.impressions) && metrics.impressions >= 1;
  const row = {
    post_id: postId,
    date_posted: get('date-posted') || (existing && existing.date_posted) || today(),
    episode: get('episode') || (existing && existing.episode) || '',
    title: get('title') || (existing && existing.title) || '',
    variant: {
      hook_type: get('hook') || prevVar.hook_type || 'unknown',
      framing: get('framing') || prevVar.framing || 'unknown',
      format: get('format') || prevVar.format || 'unknown',
      topic: get('topic') || prevVar.topic || 'unknown',
    },
    metrics,
    status: resolved ? 'resolved' : 'pending',
    resolved_date: resolved ? ((existing && existing.resolved_date) || get('date') || today()) : null,
    source: get('source') || 'manual',
    note: get('note') || (existing && existing.note) || '',
  };
  fs.appendFileSync(TABLE, JSON.stringify(row) + '\n', 'utf8');
  console.log(`content row ${existing ? 'updated' : 'added'}: ${postId} -> ${row.status}${resolved ? ` (rate ${(engRate(row) * 100).toFixed(1)}%)` : ''}`);
  aggregate();
}

// --- the 30-second log path: positional impressions reactions comments [reposts] --------------------
function cmdLog(args) {
  const [postId, impressions, reactions, comments, reposts] = args;
  if (!postId || impressions === undefined) {
    console.error('log: usage: log <post-id> <impressions> <reactions> <comments> [reposts]');
    process.exit(1);
  }
  const passthrough = ['--post-id', postId, '--impressions', impressions];
  if (reactions !== undefined) passthrough.push('--reactions', reactions);
  if (comments !== undefined) passthrough.push('--comments', comments);
  if (reposts !== undefined) passthrough.push('--reposts', reposts);
  cmdAdd(passthrough);
}

// --- deterministic aggregation: variant value -> mean engagement rate, winners behind the gate ------
function collapse(rows) {
  const byId = new Map();
  for (const r of rows) byId.set(r.post_id, r);   // last row per post_id wins
  return [...byId.values()];
}

function tallyBy(posts, dim) {
  const t = {};
  for (const p of posts) {
    if (!isResolved(p)) continue;
    const key = p.variant && p.variant[dim];
    if (key == null || key === 'unknown') continue;
    const b = (t[key] = t[key] || { resolved: 0, rateSum: 0 });
    b.resolved++;
    b.rateSum += engRate(p);
  }
  for (const b of Object.values(t)) b.meanRate = b.resolved ? b.rateSum / b.resolved : 0;
  return t;
}

function pickWinner(tally) {
  // winner = highest mean engagement rate with resolved >= MIN_RESOLVED; else null (accumulating).
  const eligible = Object.entries(tally).filter(([, b]) => b.resolved >= MIN_RESOLVED);
  if (!eligible.length) return null;
  eligible.sort((a, b) => b[1].meanRate - a[1].meanRate);
  const [value, b] = eligible[0];
  return { value, resolved: b.resolved, rate: +b.meanRate.toFixed(4) };
}

function aggregate() {
  ensureDir();
  const posts = collapse(readTable());
  const resolvedPosts = posts.filter(isResolved);
  const dims = {};
  for (const d of DIMS) dims[d] = tallyBy(posts, d);
  const winners = {};
  for (const d of DIMS) winners[d] = pickWinner(dims[d]);
  const anyWinner = Object.values(winners).some(Boolean);

  const firstDate = posts.map((p) => p.date_posted).filter(Boolean).sort()[0] || today();
  const daysIn = Math.round((Date.parse(today()) - Date.parse(firstDate)) / 86400000);
  const windowStatus = daysIn >= MEASURE_DAYS
    ? (anyWinner ? 'measured: winner(s) declared' : `measured: ${MEASURE_DAYS}d elapsed, no variant hit ${MIN_RESOLVED} resolved -> SHRINK candidate`)
    : (anyWinner ? `early winner(s) present; 60-day measurement continues (day ${daysIn}/${MEASURE_DAYS})` : `accumulating: day ${daysIn}/${MEASURE_DAYS}`);

  const meta = { generated: new Date().toISOString(), posts: posts.length, resolved: resolvedPosts.length, min_resolved: MIN_RESOLVED, first_post: firstDate, days_in_window: daysIn, window_status: windowStatus };
  fs.writeFileSync(WINNERS, JSON.stringify({ meta, winners, dims }, null, 2), 'utf8');
  fs.writeFileSync(SECTION, renderSection(meta, winners), 'utf8');
  writeReadyBlock(meta, winners);

  console.log(`content-loop: ${posts.length} posts, ${resolvedPosts.length} resolved. ${windowStatus}.`);
  if (anyWinner) for (const [dim, w] of Object.entries(winners)) { if (w) console.log(`  winner[${dim}] = ${w.value} (${(w.rate * 100).toFixed(1)}% eng across ${w.resolved})`); }
  else console.log('  no winner yet - insufficient signal (loop accumulating, fabricating nothing).');
  console.log(`  -> ${path.relative(REPO, WINNERS)} , ${path.relative(REPO, SECTION)}`);
}

// --- the report/brief section, written as DECISIONS not a dashboard ---------------------------------
function renderSection(meta, winners) {
  const label = { hook_type: 'Hook type', framing: 'Framing', format: 'Format', topic: 'Topic' };
  let md = `## Content outcomes (which posts actually landed)\n\n`;
  md += `_Generated ${meta.generated.slice(0, 16).replace('T', ' ')} by the zero-token content loop from ${meta.posts} posts (${meta.resolved} resolved). ${meta.window_status}._\n\n`;
  if (meta.resolved < MIN_RESOLVED) {
    md += `**No decisions yet. The loop is accumulating.** ${meta.resolved} of ${meta.posts} posts have logged metrics; a variant needs ${MIN_RESOLVED} resolved before it earns a call. Hook ranking leans on soul.md + past posts until then, and says so on every draft. Day ${meta.days_in_window}/${MEASURE_DAYS}.\n`;
    return md;
  }
  const anyWinner = Object.values(winners).some(Boolean);
  if (!anyWinner) {
    md += `${meta.resolved} resolved posts, but no single variant value has cleared ${MIN_RESOLVED} yet. No decision this cycle; keep posting, keep logging.\n`;
    return md;
  }
  md += `**Decisions (what the drafter should lean into next):**\n`;
  for (const [dim, w] of Object.entries(winners)) {
    if (!w) continue;
    md += `- **${label[dim] || dim}: \`${w.value}\`** drew ${(w.rate * 100).toFixed(1)}% engagement across ${w.resolved} posts. Favor it where truthful.\n`;
  }
  return md;
}

// --- the built-ready drafter block, marker-wrapped (mirrors the SOUL_VOICE + job-winners pattern) ---
function writeReadyBlock(meta, winners) {
  const day = today();
  const lines = [`<<<CONTENT_WINNERS_START synced ${day} from the content loop - do not hand-edit, re-run scripts/alex-content-loop.js>>>`];
  const active = Object.entries(winners).filter(([, w]) => w);
  if (meta.resolved < MIN_RESOLVED || !active.length) {
    lines.push('# (no winning patterns yet - content loop still accumulating; this block is intentionally empty)');
  } else {
    lines.push('# Outcome-proven content patterns (from real LinkedIn engagement, favor these where truthful):');
    for (const [dim, w] of active) lines.push(`# - ${dim}: ${w.value} (${(w.rate * 100).toFixed(1)}% engagement across ${w.resolved} posts)`);
    lines.push('# Guidance stays truthful: lean toward proven patterns, never bend the real material to fit one.');
  }
  lines.push('<<<CONTENT_WINNERS_END>>>');
  fs.mkdirSync(path.dirname(READY_BLOCK), { recursive: true });
  fs.writeFileSync(READY_BLOCK, lines.join('\n') + '\n', 'utf8');
}

function cmdStatus() {
  const posts = collapse(readTable());
  const resolved = posts.filter(isResolved).length;
  const first = posts.map((p) => p.date_posted).filter(Boolean).sort()[0] || '(none)';
  console.log(`content-loop status: ${posts.length} posts, ${resolved} resolved, first ${first}.`);
  console.log(`table: ${fs.existsSync(TABLE) ? path.relative(REPO, TABLE) : '(not created yet)'}`);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'add') return cmdAdd(rest);
  if (cmd === 'log') return cmdLog(rest);
  if (cmd === 'status') return cmdStatus();
  if (cmd && cmd !== 'aggregate') { console.error(`unknown command '${cmd}' (add | log | status | <none>)`); process.exit(1); }
  aggregate();
}

main();

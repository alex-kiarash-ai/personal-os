'use strict';
/*
 * scripts/outputs-burst-check.js - S1 Compiled Surfaces P2 (2026-08-16): the outputs/ growth
 * tripwire. Run 44 measured 30-day growth of ~492MB with BURSTS (2026-08-06 alone: 211 files /
 * 199.4MB of raw n8n exec JSON = 40% of the month) that nobody noticed while they happened.
 *
 * One pass, zero tokens: sum bytes of outputs/** files modified in the last 24h. Over the
 * threshold (50MB) -> push HQ amber (infra/outputs_burst) + write system/outputs-burst-state.json
 * (the morning brief reads it and prints one line). Clean day AFTER a burst -> push green once
 * (self-clearing, the sprint run_status pattern). Clean day, no prior burst -> no push, no noise.
 *
 * Wired best-effort into the 21:45 vault-backup chain (beside the ledger reconcile): it NEVER
 * fails the backup. --dry prints instead of pushing. Detect-only; nothing is deleted, ever.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const OUTPUTS = path.join(REPO, 'outputs');
const STATE = path.join(REPO, 'system', 'outputs-burst-state.json');
const TOKEN_FILE = path.join(REPO, 'work', '16-alex-hq', 'config', 'alex-hq-token.txt');
const THRESHOLD_MB = 50;
const DRY = process.argv.includes('--dry');

function walk(dir, out) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
}

async function pushHQ(status, headline, mb) {
  if (DRY) { console.log(`DRY: would push infra/outputs_burst ${status}: ${headline}`); return true; }
  try {
    const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    const r = await fetch('https://n8n.shaheenkiarash.com/webhook/alex-push', {
      method: 'POST',
      headers: { 'X-Alex-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: 'infra', metric_key: 'outputs_burst', value_num: Math.round(mb), headline, status }),
    });
    return r.ok;
  } catch (e) { console.log(`HQ push failed (non-fatal): ${e.message}`); return false; }
}

(async () => {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  const files = [];
  walk(OUTPUTS, files);
  const byDir = new Map();
  let total = 0, count = 0;
  for (const f of files) {
    let st; try { st = fs.statSync(f); } catch { continue; }
    if (st.mtimeMs < cutoff) continue;
    total += st.size; count++;
    const top = path.relative(OUTPUTS, f).split(path.sep)[0];
    byDir.set(top, (byDir.get(top) || 0) + st.size);
  }
  const mb = total / (1024 * 1024);
  const top3 = [...byDir.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([d, b]) => `${d} ${(b / 1048576).toFixed(1)}MB`).join(', ');
  const prev = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};

  if (mb > THRESHOLD_MB) {
    const headline = `outputs/ grew ${mb.toFixed(1)}MB in 24h (${count} files; top: ${top3}) - burst tripwire (>${THRESHOLD_MB}MB)`;
    console.log(`BURST: ${headline}`);
    await pushHQ('amber', headline, mb);
    if (!DRY) fs.writeFileSync(STATE, JSON.stringify({ ts: new Date().toISOString(), state: 'burst', mb: +mb.toFixed(1), files: count, top: top3 }, null, 2));
    process.exitCode = 2;
  } else if (prev.state === 'burst') {
    console.log(`clean day after a burst (${mb.toFixed(1)}MB/24h) - clearing to green`);
    await pushHQ('green', `outputs/ growth back to normal (${mb.toFixed(1)}MB in 24h)`, mb);
    if (!DRY) fs.writeFileSync(STATE, JSON.stringify({ ts: new Date().toISOString(), state: 'ok', mb: +mb.toFixed(1) }, null, 2));
  } else {
    console.log(`outputs-burst: ok (${mb.toFixed(1)}MB in 24h, ${count} files)`);
  }
})();

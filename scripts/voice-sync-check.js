#!/usr/bin/env node
'use strict';
/*
 * voice-sync-check.js - do the LIVE n8n writer nodes still carry the current soul voice block?
 *
 * WHY (A15-T-06, stress test 2026-09-04). The generator injects a block built from soul.md into
 * the four `Build Writer Request` nodes, backup-first and GET-verified, and that works. The gap is
 * BETWEEN generator runs: the constitution's re-sync trigger is "whenever soul.md changes, run the
 * generator", which is a rule a session has to remember. Nothing ever asked the live workflows
 * whether they still match. So the failure mode is a soul.md edit that never got a generator run,
 * after which every cover letter and every LinkedIn draft the engines produce is written in a
 * stale register - and nothing looks broken, because a wrong-but-fluent voice is exactly as
 * fluent as the right one.
 *
 * That is the same shape as the card going stale (C23) and the corpus going out of order
 * (C22's ordering leg): the identity surfaces fail quietly and only in the OUTPUT.
 *
 * GET-ONLY. It reads four workflows and compares. It never writes, never activates, never touches
 * a flag - repairing is the generator's job and the 07-10 silent-deactivation lesson is why a
 * checker does not get to PUT.
 *
 * Compares `stablePart`, the same function the sync uses, so the timestamp line inside the block
 * is excluded and a match means the VOICE matches rather than the build time.
 *
 * Usage:
 *   node scripts/voice-sync-check.js          # human output, exit 2 on drift
 *   node scripts/voice-sync-check.js --json   # machine output for the sweep
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const REPO = path.resolve(__dirname, '..');
const { buildVoiceBlock, stablePart, extractLiveBlock, TARGETS, NODE } = require('./lib/sync-n8n-voice.js');

const API = 'https://n8n.shaheenkiarash.com/api/v1';
const KEY_FILE = path.join(REPO, 'work', '03-application-engine', 'config', 'n8n-api-key.txt');

function apiKey() {
  const fromEnv = process.env.N8N_API_KEY;
  if (fromEnv) return fromEnv.trim();
  try { return fs.readFileSync(KEY_FILE, 'utf8').trim(); } catch { return null; }
}

function getWorkflow(id, key) {
  return new Promise((resolve, reject) => {
    const u = new URL(`${API}/workflows/${id}`);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname, method: 'GET', headers: { 'X-N8N-API-KEY': key }, timeout: 20000 },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { body += d; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(body)); } catch (e) { reject(new Error(`unparseable body: ${e.message}`)); }
          } else reject(new Error(`HTTP ${res.statusCode}`));
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

/*
 * The block as it currently sits in the node. Delegates to the sync module's own extractor: the
 * first draft of this file searched the RAW node code for the markers, and because the SYSTEM
 * literal is JSON-encoded there, every newline is a two-character escape and the comparison
 * reported all four lanes as drifted while the generator had just verified all four in sync.
 */
function liveBlock(wf) {
  const node = (wf.nodes || []).find((n) => n.name === NODE);
  if (!node) return { err: `no '${NODE}' node` };
  const code = (node.parameters && (node.parameters.jsCode || node.parameters.functionCode)) || '';
  return extractLiveBlock(code);
}

async function main() {
  const JSON_OUT = process.argv.includes('--json');
  const key = apiKey();
  if (!key) {
    const msg = 'voice-sync-check: no n8n API key (N8N_API_KEY or the key file) - NOT asserted this run';
    console.log(JSON_OUT ? JSON.stringify({ asserted: false, reason: 'no api key' }) : msg);
    return 0; // absence of a credential is not drift; the caller says so out loud
  }

  let soul;
  try { soul = fs.readFileSync(path.join(REPO, 'soul.md'), 'utf8'); }
  catch (e) {
    console.error(`voice-sync-check: cannot read soul.md (${e.message})`);
    return 2;
  }
  const want = stablePart(buildVoiceBlock(soul));

  const rows = [];
  for (const t of TARGETS) {
    try {
      const wf = await getWorkflow(t.id, key);
      const live = liveBlock(wf);
      if (live.err) { rows.push({ ...t, ok: false, why: live.err }); continue; }
      const same = stablePart(live.block) === want;
      rows.push({ ...t, ok: same, why: same ? 'in sync' : 'voice block does NOT match soul.md' });
    } catch (e) {
      rows.push({ ...t, ok: null, why: `unreachable (${e.message})` });
    }
  }

  const drift = rows.filter((r) => r.ok === false);
  const unknown = rows.filter((r) => r.ok === null);
  if (JSON_OUT) {
    console.log(JSON.stringify({ asserted: true, checked: rows.length, drift: drift.length, unknown: unknown.length, rows }));
  } else {
    for (const r of rows) console.log(`  ${r.ok === true ? 'ok  ' : r.ok === false ? 'DRIFT' : 'unk '} ${r.name}: ${r.why}`);
    console.log(`voice-sync-check: ${rows.length} lane(s), ${drift.length} drifted, ${unknown.length} unreachable`);
    if (drift.length) console.log('Fix: node scripts/generate-alex.js (the voice sync lives inside the generator, and it is the only thing that may WRITE to these nodes).');
  }
  return drift.length ? 2 : 0;
}

main().then((c) => { process.exitCode = c; }).catch((e) => {
  console.error(`voice-sync-check: ${e.message}`);
  process.exitCode = 2;
});

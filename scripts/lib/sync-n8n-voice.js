// sync-n8n-voice.js - soul.md voice -> live n8n writer nodes (refactor P1-S3).
// Absorbs scripts/sync-soul-to-n8n.js (built 2026-07-07) with its proven behaviors intact:
//   - builds the voice block FROM soul.md (Voice Rules + Detection-proofing + real My Words samples)
//   - injects between idempotent <<<SOUL_VOICE>>> markers into the "Build Writer Request" node of
//     BOTH active engines + the Writer Voice Eval (append once, replace on re-sync, never duplicate)
//   - backup-first (scripts/n8n-backups/, gitignored), PUTs only {name,nodes,connections,settings},
//     GET-verifies marker + sample phrase + node count + active flag before declaring green.
//     The active flag is a HARD gate since 2026-07-10: n8n's public-API PUT dropped activation on
//     both live engines (crons deregistered, 07:00 runs silently never fired) and the old check only
//     printed the flag. The sync now re-activates a workflow the PUT deactivated and fails loudly if
//     it cannot restore the pre-write state.
// Changes vs the standalone script (per the refactor ground rules):
//   - credentials come ONLY from env: N8N_API_URL + N8N_API_KEY; fails loudly if missing (rule 7)
//   - soul.md text comes from the shared source model (read-sources), one read for the whole run
//   - NO-OP DETECTION: if the soul-derived content (ignoring the dated sync header) already matches
//     what is live, the workflow is NOT written - a re-run with an unchanged soul.md is a verified
//     no-op, which is what makes the sync safe inside every generation run.
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const BACKUP_DIR = path.join(REPO, 'scripts', 'n8n-backups');

// Only the WRITER produces human-facing prose (model-routing rule). Match/scoring nodes are
// reasoning and are deliberately NOT touched. The eval reuses the writer node verbatim, so it is
// a sync target too (keeps the regression harness testing the CURRENT injected prompt).
const TARGETS = [
  { id: '9XuIEfxS71DEetVR', name: 'Application Engine (BI)' },
  { id: '9x9M3EnEEeX3O8dy', name: 'AI Application Engine' },
  { id: 'grMqmGzzbTXTEdKr', name: 'Writer Voice Eval (regression)' },
];
const NODE = 'Build Writer Request';
const START = '<<<SOUL_VOICE_START';
const END = '<<<SOUL_VOICE_END>>>';

function env() {
  const base = process.env.N8N_API_URL;
  const key = process.env.N8N_API_KEY;
  if (!base || !key)
    throw new Error('sync-n8n-voice: N8N_API_URL and/or N8N_API_KEY env vars are missing - refusing to run (credentials never live in code)');
  return { base: base.replace(/\/$/, ''), hdrs: { 'X-N8N-API-KEY': key, 'Content-Type': 'application/json' } };
}

// --- Build the voice block FROM soul.md (identical construction to the standalone script) --------
function buildVoiceBlock(soul) {
  const vr = soul.match(/## Voice Rules \(always active\)[\s\S]*?(?=\n## )/);
  if (!vr) throw new Error('sync-n8n-voice: could not find Voice Rules section in soul.md');
  const rules = vr[0].trim();
  const mw = soul.slice(soul.indexOf('## My Words'));
  const samples = (mw.match(/^- "[^"]+"/gm) || []).slice(0, 8).join('\n');
  if (samples.length === 0) throw new Error('sync-n8n-voice: no My Words samples found in soul.md');
  const day = new Date().toISOString().slice(0, 10);
  return [
    `${START} synced ${day} from soul.md - do not edit by hand, re-run the generator (scripts/generate-alex.js)>>>`,
    'VOICE (highest priority, overrides any generic-English instinct): write EXACTLY in Shaheen\'s',
    'register. He is ESL-direct; keep his real texture, do NOT polish it into corporate English.',
    '',
    rules,
    '',
    'Real phrasing samples (match this texture, do not sanitize):',
    samples,
    '',
    'If a sentence could have come from any competent AI, it is wrong - rewrite it in his words.',
    END,
  ].join('\n');
}

// The stable part of a block: everything after the dated sync-header line.
function stablePart(blockText) {
  const i = blockText.indexOf('\n');
  return blockText.slice(i + 1).trim();
}

// Inject/refresh the block inside the node's SYSTEM string literal (idempotent, same as standalone).
// Returns { code, changed, noop, reason }.
function injectIntoSystem(code, blockText) {
  const head = 'const SYSTEM = ';
  const i = code.indexOf(head);
  if (i < 0) return { code, changed: false, reason: 'no SYSTEM const' };
  const j = code.indexOf(';\nconst TONE', i);
  if (j < 0) return { code, changed: false, reason: 'no SYSTEM terminator (;\\nconst TONE)' };
  const litStart = i + head.length;
  let sys;
  try { sys = JSON.parse(code.slice(litStart, j).trim()); }
  catch (e) { return { code, changed: false, reason: 'SYSTEM literal not JSON-parseable: ' + e.message }; }
  const s = sys.indexOf(START), e = sys.indexOf(END);
  if (s >= 0 && e > s) {
    const existing = sys.slice(s, e + END.length);
    if (stablePart(existing) === stablePart(blockText))
      return { code, changed: false, noop: true, reason: 'live block already matches soul.md (verified no-op)' };
    sys = (sys.slice(0, s) + sys.slice(e + END.length)).replace(/\n{3,}/g, '\n\n').trimEnd();
  }
  sys = sys.trimEnd() + '\n\n' + blockText;
  const newCode = code.slice(0, litStart) + JSON.stringify(sys) + code.slice(j);
  return { code: newCode, changed: true };
}

// --- The sync run. apply=false -> fetch + diff + report only, no write. -------------------------
async function run({ soul, apply, log }) {
  const { base, hdrs } = env();
  const blockText = buildVoiceBlock(soul);
  const sampleMark = (blockText.match(/^- "([^"]{6,40})/m) || [])[1];
  const results = [];
  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  for (const t of TARGETS) {
    const wf = await (await fetch(`${base}/workflows/${t.id}`, { headers: hdrs })).json();
    if (!wf.nodes) throw new Error(`sync-n8n-voice: fetch failed for ${t.name} (${t.id})`);
    const node = wf.nodes.find(n => n.name === NODE);
    if (!node || typeof node.parameters.jsCode !== 'string')
      throw new Error(`sync-n8n-voice: ${t.name}: no "${NODE}" code node - live workflow differs from what the sync expects, NOT writing`);
    const before = wf.nodes.length;

    const r = injectIntoSystem(node.parameters.jsCode, blockText);
    if (r.noop) { log(`  [${t.name}] NO-OP: ${r.reason}`); results.push({ target: t.name, status: 'noop' }); continue; }
    if (!r.changed) throw new Error(`sync-n8n-voice: ${t.name}: cannot inject (${r.reason}) - live workflow differs from what the sync expects, NOT writing`);
    node.parameters.jsCode = r.code;

    if (!apply) { log(`  [${t.name}] WOULD INJECT into "${NODE}" (dry-run, no write)`); results.push({ target: t.name, status: 'would-change' }); continue; }

    fs.writeFileSync(path.join(BACKUP_DIR, `${t.id}-before-soulsync-${Date.now()}.json`),
      JSON.stringify(await (await fetch(`${base}/workflows/${t.id}`, { headers: hdrs })).json(), null, 2));

    const ALLOWED = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];
    const settings = {};
    for (const k of ALLOWED) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
    if (!settings.executionOrder) settings.executionOrder = 'v1';
    const res = await fetch(`${base}/workflows/${t.id}`, {
      method: 'PUT', headers: hdrs,
      body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings }),
    });
    if (!res.ok) throw new Error(`sync-n8n-voice: ${t.name}: PUT failed ${res.status} ${(await res.text()).slice(0, 300)}`);

    const v = await (await fetch(`${base}/workflows/${t.id}`, { headers: hdrs })).json();
    const w = v.nodes.find(n => n.name === NODE).parameters.jsCode;
    const ok = w.includes(START) && w.includes(END) && (!sampleMark || w.includes(sampleMark)) && v.nodes.length === before;
    if (!ok) throw new Error(`sync-n8n-voice: ${t.name}: post-write verification failed (marker/phrase/nodecount)`);

    // n8n's PUT can drop activation (2026-07-10: both engines deactivated by the overnight sync,
    // crons deregistered, next-morning runs never fired). Restore it, then GATE green on it.
    let active = v.active;
    if (wf.active && !active) {
      const ra = await fetch(`${base}/workflows/${t.id}/activate`, { method: 'POST', headers: hdrs });
      if (ra.ok) active = (await ra.json()).active === true;
    }
    if (active !== wf.active)
      throw new Error(`sync-n8n-voice: ${t.name}: active flag ${wf.active} -> ${active} after sync and re-activation could not restore it - workflow left DEACTIVATED, fix by hand (POST /workflows/${t.id}/activate)`);
    log(`  [${t.name}] GREEN: voice block live in "${NODE}"; nodes ${before}->${v.nodes.length}; active=${active}${wf.active && !v.active ? ' (re-activated: PUT had dropped it)' : ''}`);
    results.push({ target: t.name, status: 'synced' });
  }
  return results;
}

module.exports = { run, buildVoiceBlock, injectIntoSystem, TARGETS, NODE, START, END };

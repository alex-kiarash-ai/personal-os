// sync-soul-to-n8n.js  (built 2026-07-07)
// Propagates Shaheen's VOICE (soul.md Voice Rules + Detection-proofing + real My Words
// samples) into the live n8n "Build Writer Request" nodes, so automated cover-letter/CV
// prose gets the SAME voice + anti-AI-detection treatment as on-machine output.
//
// Why this exists: discovery 2026-07-07 found soul.md was NEVER actually injected into the
// n8n writers (they used a generic SYSTEM + role TONE). This wires the documented-but-open
// "feed the writer from soul.md" rule, and is RE-RUNNABLE so it re-syncs when soul.md changes.
//
// Safe by construction (mirrors config/resync-cv pattern): reads soul.md locally (soul is
// gitignored, never embedded in this script), backs up each workflow JSON before touching it,
// injects between idempotent <<<SOUL_VOICE>>> markers (append once, replace on re-sync, never
// duplicate), PUTs only {name,nodes,connections,settings}, then GET-verifies the marker + a
// sample phrase landed and the node count / active flag are unchanged. Rolls nothing forward
// unless every check passes.
//
// Usage:  node scripts/sync-soul-to-n8n.js            (DRY-RUN: shows what would change)
//         node scripts/sync-soul-to-n8n.js --apply    (writes to live n8n + verifies)

const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const BASE = 'https://n8n.shaheenkiarash.com/api/v1';
const KEY = fs.readFileSync(path.join(REPO, 'work/03-application-engine/config/n8n-api-key.txt'), 'utf8').trim();
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };

// Only the WRITER produces human-facing prose (per the model-routing rule). Match/scoring
// nodes are reasoning and are deliberately NOT touched.
const TARGETS = [
  { id: '9XuIEfxS71DEetVR', name: 'Application Engine (BI)' },
  { id: '9x9M3EnEEeX3O8dy', name: 'AI Application Engine' },
  // The Writer Voice Eval (regression harness, 2026-07-07) reuses the writer node VERBATIM, so it
  // is a sync target too: a soul re-sync updates it in lockstep with the live engines, keeping the
  // eval honest (it always tests the CURRENT injected prompt). After --apply, run the eval to check.
  { id: 'grMqmGzzbTXTEdKr', name: 'Writer Voice Eval (regression)' },
];
const NODE = 'Build Writer Request';
const START = '<<<SOUL_VOICE_START';
const END = '<<<SOUL_VOICE_END>>>';

function must(c, m) { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } }

// --- Build the voice block FROM soul.md so a re-run re-syncs the latest corpus ---
function buildVoiceBlock() {
  const soul = fs.readFileSync(path.join(REPO, 'soul.md'), 'utf8');
  // Voice Rules section (includes Detection-proofing): from its heading to the next "## "
  const vr = soul.match(/## Voice Rules \(always active\)[\s\S]*?(?=\n## )/);
  must(vr, 'could not find Voice Rules section in soul.md');
  const rules = vr[0].trim();
  // Real sample lines pulled ONLY from the "My Words" section (his phrasing), NOT the
  // Writing Style / Alex-voice examples above it. Spoken (voice-to-text) samples sort first
  // in the corpus, so these are his truest register.
  const mw = soul.slice(soul.indexOf('## My Words'));
  const samples = (mw.match(/^- "[^"]+"/gm) || []).slice(0, 8).join('\n');
  must(samples.length > 0, 'no My Words samples found in soul.md');
  const day = new Date().toISOString().slice(0, 10);
  return [
    `${START} synced ${day} from soul.md - do not edit by hand, re-run scripts/sync-soul-to-n8n.js>>>`,
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

// Inject/refresh the block inside the node's SYSTEM string literal (idempotent).
function injectIntoSystem(code, block) {
  const head = 'const SYSTEM = ';
  const i = code.indexOf(head);
  if (i < 0) return { code, changed: false, reason: 'no SYSTEM const' };
  const j = code.indexOf(';\nconst TONE', i);
  if (j < 0) return { code, changed: false, reason: 'no SYSTEM terminator (;\\nconst TONE)' };
  const litStart = i + head.length;
  let sys;
  try { sys = JSON.parse(code.slice(litStart, j).trim()); }
  catch (e) { return { code, changed: false, reason: 'SYSTEM literal not JSON-parseable: ' + e.message }; }
  // strip a previous block if present (re-sync), then append fresh
  const s = sys.indexOf(START), e = sys.indexOf(END);
  if (s >= 0 && e > s) sys = (sys.slice(0, s) + sys.slice(e + END.length)).replace(/\n{3,}/g, '\n\n').trimEnd();
  sys = sys.trimEnd() + '\n\n' + block;
  const newCode = code.slice(0, litStart) + JSON.stringify(sys) + code.slice(j);
  return { code: newCode, changed: true };
}

(async () => {
  const block = buildVoiceBlock();
  const sampleMark = (block.match(/^- "([^"]{6,40})/m) || [])[1]; // a phrase we can verify landed
  console.log(`mode: ${APPLY ? 'APPLY (live write)' : 'DRY-RUN'} | voice block ${block.length} chars | verify phrase: "${sampleMark}"`);
  const bdir = path.join(__dirname, 'n8n-backups');
  fs.mkdirSync(bdir, { recursive: true });

  for (const t of TARGETS) {
    const wf = await (await fetch(`${BASE}/workflows/${t.id}`, { headers: HDRS })).json();
    must(wf.nodes, `fetch failed for ${t.name}`);
    const node = wf.nodes.find(n => n.name === NODE);
    must(node && typeof node.parameters.jsCode === 'string', `${t.name}: no "${NODE}" code node`);
    const before = wf.nodes.length;

    const r = injectIntoSystem(node.parameters.jsCode, block);
    if (!r.changed) { console.log(`  [${t.name}] SKIP: ${r.reason}`); continue; }
    node.parameters.jsCode = r.code;

    if (!APPLY) { console.log(`  [${t.name}] would inject into "${NODE}" (dry-run, no write).`); continue; }

    fs.writeFileSync(path.join(bdir, `${t.id}-before-soulsync-${Date.now()}.json`),
                     JSON.stringify(await (await fetch(`${BASE}/workflows/${t.id}`, { headers: HDRS })).json(), null, 2));

    const ALLOWED = ['saveExecutionProgress','saveManualExecutions','saveDataErrorExecution','saveDataSuccessExecution','executionTimeout','errorWorkflow','timezone','executionOrder'];
    const settings = {}; for (const k of ALLOWED) if (wf.settings && wf.settings[k] !== undefined) settings[k] = wf.settings[k];
    if (!settings.executionOrder) settings.executionOrder = 'v1';
    const res = await fetch(`${BASE}/workflows/${t.id}`, { method: 'PUT', headers: HDRS,
      body: JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings }) });
    must(res.ok, `${t.name}: PUT failed ${res.status} ${(await res.text()).slice(0,300)}`);

    const v = await (await fetch(`${BASE}/workflows/${t.id}`, { headers: HDRS })).json();
    const w = v.nodes.find(n => n.name === NODE).parameters.jsCode;
    const ok = w.includes(START) && w.includes(END) && (!sampleMark || w.includes(sampleMark)) && v.nodes.length === before;
    must(ok, `${t.name}: verification failed (marker/phrase/nodecount)`);
    console.log(`  [${t.name}] GREEN: voice block live in "${NODE}"; nodes ${before}->${v.nodes.length}; active=${v.active}`);
  }
  console.log(APPLY ? '\nSYNC COMPLETE - all targets verified.' : '\nDRY-RUN done (no changes). Re-run with --apply to write.');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

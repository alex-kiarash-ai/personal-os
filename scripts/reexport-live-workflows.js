// Re-export the 4 live job-pipeline workflows to docs/n8n/ + the Desktop folder so the
// artifacts match live after the 2026-07-28 audit-fix landing. Pure Node (no /tmp path issues).
const fs = require('fs');
const path = require('path');
const KEY = fs.readFileSync(path.join(__dirname, '../work/03-application-engine/config/n8n-api-key.txt'), 'utf8').trim();
const BASE = 'https://n8n.shaheenkiarash.com/api/v1';
// The optional out-of-repo mirror folder. Genericized 2026-08-05 (bash migration, W5): this was a
// hardcoded Windows Desktop path. It is a CONVENIENCE copy - docs/n8n/ is the real artifact - so an
// unset ALEX_N8N_DESK simply skips that half rather than failing the re-export.
const DESK = process.env.ALEX_N8N_DESK || null;
const WF = [
  { id: '9XuIEfxS71DEetVR', desk: 'Application Engine.json',        docs: 'docs/n8n/03-application-engine/workflow.json' },
  { id: '9x9M3EnEEeX3O8dy', desk: 'AI Application Engine.json',     docs: 'docs/n8n/14-ai-application-engine/workflow.json' },
  { id: 'sxEYRyeHH7i1mHzb', desk: 'Portal Application Engine.json', docs: 'docs/n8n/portal-application-engine/workflow.json' },
  { id: '5tPXbhdpp6PfF56V', desk: 'Portal Scanner.json',           docs: 'docs/n8n/portal-scanner/workflow.json' },
];
(async () => {
  for (const w of WF) {
    const r = await fetch(`${BASE}/workflows/${w.id}`, { headers: { 'X-N8N-API-KEY': KEY } });
    if (r.status !== 200) { console.log(`${w.id} GET ${r.status} - skipped`); continue; }
    const wf = await r.json();
    const deskObj = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings, active: wf.active, id: wf.id };
    const docsObj = { name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings };
    let deskMsg = '(ALEX_N8N_DESK unset - mirror skipped)';
    if (DESK) {
      fs.mkdirSync(DESK, { recursive: true });
      const deskPath = path.join(DESK, w.desk);
      fs.writeFileSync(deskPath, JSON.stringify(deskObj, null, 2));
      deskMsg = `${fs.statSync(deskPath).size}B`;
    }
    let docsMsg = '(no docs dir)';
    const docsDir = path.dirname(path.join(process.cwd(), w.docs));
    if (fs.existsSync(docsDir)) { fs.writeFileSync(path.join(process.cwd(), w.docs), JSON.stringify(docsObj, null, 2)); docsMsg = w.docs; }
    console.log(`${w.desk}: mirror=${deskMsg}  docs=${docsMsg}`);
  }
})();

// Build + activate the "Alex Radar - Collector (15)" n8n workflow (audit step 6 / Update Logic Phase A).
// Daily 06:00 server-side feed collection into data table radar_inbox (GF24ur3Q06IKzJrS):
// 12 free feeds -> normalize + hash -> dedup vs table -> insert -> urgent-lane note to the alex_inbox.
// The Monday /alex-radar --weekly sweep then READS the table instead of fetching live (laptop-independent).
// Idempotent-ish: if a workflow with the same name exists, it is updated (PUT), not duplicated.
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..', '..', '..');
const API = 'https://n8n.shaheenkiarash.com/api/v1';
const KEY = fs.readFileSync(path.join(repo, 'work/03-application-engine/config/n8n-api-key.txt'), 'utf8').trim();
const HQ_TOKEN = fs.readFileSync(path.join(repo, 'work/16-alex-hq/config/alex-hq-token.txt'), 'utf8').trim();
const TABLE_ID = 'GLyqcNyG7iCudXcI'; // radar_inbox (recreated clean 2026-07-06 after the pre-fix pollution)
const ERROR_WF = 'QlGy1BFzdKF852uR'; // Pipeline Error Alert
const NAME = 'Alex Radar - Collector (15)';

const rssFeeds = [
  ['RSS Claude Code', 'https://github.com/anthropics/claude-code/releases.atom'],
  ['RSS MCP Servers', 'https://github.com/modelcontextprotocol/servers/releases.atom'],
  ['RSS MCP Spec', 'https://github.com/modelcontextprotocol/modelcontextprotocol/releases.atom'],
  ['RSS n8n', 'https://github.com/n8n-io/n8n/releases.atom'],
  ['RSS OpenAI', 'https://openai.com/news/rss.xml'],
  ['RSS DeepMind', 'https://deepmind.google/blog/rss.xml'],
  // Product Hunt + Reddit dropped from the collector 2026-07-06: their heavy feeds coincided with
  // container crashes on fires 2-3 (shared production box). They stay Tier 2 LIVE fetches in the
  // Monday sweep, exactly as before the collector existed.
];
const hnQueries = [
  ['HN mcp', 'https://hn.algolia.com/api/v1/search_by_date?query=mcp&tags=story&hitsPerPage=30'],
  ['HN claude', 'https://hn.algolia.com/api/v1/search_by_date?query=claude&tags=story&hitsPerPage=30'],
  ['HN n8n', 'https://hn.algolia.com/api/v1/search_by_date?query=n8n&tags=story&hitsPerPage=20'],
];

const normalizeCode = `
const out = [];
const seen = new Set();
function hash(s){let h=5381;for(let i=0;i<s.length;i++){h=((h<<5)+h+s.charCodeAt(i))>>>0;}return h.toString(16);}
function canon(u){try{const x=new URL(u);x.hash='';x.search='';return x.href.toLowerCase();}catch(e){return (u||'').toLowerCase();}}
function srcOf(u){
  u=(u||'').toLowerCase();
  if(u.includes('github.com/anthropics/claude-code'))return 'claude-code';
  if(u.includes('github.com/modelcontextprotocol/servers'))return 'mcp-servers';
  if(u.includes('github.com/modelcontextprotocol/modelcontextprotocol'))return 'mcp-spec';
  if(u.includes('github.com/n8n-io'))return 'n8n';
  if(u.includes('openai.com'))return 'openai';
  if(u.includes('deepmind.google'))return 'deepmind';
  if(u.includes('producthunt.com'))return 'product-hunt';
  if(u.includes('reddit.com/r/mcp'))return 'r-mcp';
  if(u.includes('reddit.com/r/claudeai'))return 'r-claudeai';
  if(u.includes('reddit.com'))return 'reddit';
  return 'hn';
}
for (const item of $input.all()) {
  const j = item.json;
  if (Array.isArray(j.hits)) {
    for (const h of j.hits) {
      const url = h.url || ('https://news.ycombinator.com/item?id='+h.objectID);
      out.push({title:h.title||'', url, source:'hn', published:h.created_at||'',
                summary:(h.points||0)+' points, '+(h.num_comments||0)+' comments'});
    }
  } else if (j.title || j.link) {
    const url = j.link || '';
    out.push({title:j.title||'', url, source:srcOf(url), published:j.isoDate||j.pubDate||'',
              summary:(j.contentSnippet||j.content||'').toString().slice(0,400)});
  }
}
return out.filter(r=>{
  if(!r.url && !r.title) return false;
  r.hash = hash(canon(r.url||r.title));
  if(seen.has(r.hash)) return false;
  seen.add(r.hash);
  return true;
}).map(r=>({json:r}));
`.trim();

// Dedup design (v1.1, 2026-07-06): NO table read. The dataTable get/returnAll node coincided with
// hard container crashes once the table had rows (see error-log), so the collector filters by a
// 3-day recency window + in-batch hash dedup only. Cross-day duplicates within the window are
// accepted: the Monday sweep dedups by hash anyway (Run Check 1). The table is a buffer, not a ledger.
const filterCode = `
const now = new Date();
const nowIso = now.toISOString();
const cutoff = now.getTime() - 3*24*3600*1000;
const seen = new Set();
const fresh = [];
const T1 = new Set(['claude-code','mcp-servers','mcp-spec','n8n','openai','deepmind']);
const breaking = /(breaking|deprecat|security advisory|CVE-|end[- ]of[- ]life|removed|shutdown|sunset)/i;
const friction = /(airbnb.{0,12}api|whatsapp.{0,20}(api|export|backup)|notion.{0,20}(query|api|mcp)|streamable http|power ?bi.{0,15}mcp)/i;
for (const c of $input.all()) {
  const r = Object.assign({}, c.json);
  if (seen.has(r.hash)) continue;
  const ts = Date.parse(r.published||'');
  if (!isNaN(ts) && ts < cutoff) continue;
  const txt = (r.title||'')+' '+(r.summary||'');
  r.urgent = ((T1.has(r.source) && breaking.test(txt)) || friction.test(txt)) ? 1 : 0;
  r.seen_at = nowIso; r.swept = 0;
  fresh.push({json:r});
  seen.add(r.hash);
}
return fresh;
`.trim();

const urgentCode = `
const urgent = $input.all().filter(i=>i.json.urgent===1).slice(0,5);
if (urgent.length===0) return [];
const lines = urgent.map(u=>'- ['+u.json.source+'] '+u.json.title+' '+u.json.url).join('\\n');
return [{json:{note:'RADAR URGENT (auto, collector): '+urgent.length+' item(s) matched the breaking-change/friction filter today:\\n'+lines+'\\nQueued in radar_inbox; full scoring next Monday sweep.'}}];
`.trim();

function dt(x, y) { return [x, y]; }
const nodes = [];
const connections = {};
function connect(from, to) {
  connections[from] = connections[from] || { main: [[]] };
  connections[from].main[0].push({ node: to, type: 'main', index: 0 });
}

nodes.push({
  name: 'Daily 06:00', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: dt(-400, 300),
  parameters: { rule: { interval: [{ field: 'days', triggerAtHour: 6, triggerAtMinute: 0 }] } },
});
nodes.push({
  name: 'Manual Fire', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: dt(-400, 500),
  parameters: { httpMethod: 'GET', path: 'radar-collect', responseMode: 'onReceived', options: {} },
});

let y = -200;
const fetchNames = [];
for (const [name, url] of rssFeeds) {
  nodes.push({
    name, type: 'n8n-nodes-base.rssFeedRead', typeVersion: 1, position: dt(-100, y),
    parameters: { url, options: {} }, onError: 'continueRegularOutput',
  });
  fetchNames.push(name); y += 120;
}
for (const [name, url] of hnQueries) {
  nodes.push({
    name, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: dt(-100, y),
    parameters: { url, options: {} }, onError: 'continueRegularOutput',
  });
  fetchNames.push(name); y += 120;
}
for (const f of fetchNames) { connect('Daily 06:00', f); connect('Manual Fire', f); connect(f, 'Normalize Items'); }

nodes.push({
  name: 'Normalize Items', type: 'n8n-nodes-base.code', typeVersion: 2, position: dt(200, 300),
  parameters: { jsCode: normalizeCode },
});
nodes.push({
  name: 'Filter New', type: 'n8n-nodes-base.code', typeVersion: 2, position: dt(600, 300),
  parameters: { jsCode: filterCode },
});
nodes.push({
  name: 'Insert Rows', type: 'n8n-nodes-base.dataTable', typeVersion: 1, position: dt(800, 300),
  parameters: {
    resource: 'row', operation: 'insert',
    dataTableId: { __rl: true, value: TABLE_ID, mode: 'id', cachedResultName: 'radar_inbox' },
    columns: { mappingMode: 'autoMapInputData', value: {}, matchingColumns: [], schema: [] },
    options: {},
  },
});
nodes.push({
  name: 'Build Urgent Note', type: 'n8n-nodes-base.code', typeVersion: 2, position: dt(1000, 300),
  parameters: { jsCode: urgentCode },
});
nodes.push({
  name: 'Notify Inbox', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: dt(1200, 300),
  parameters: {
    method: 'POST', url: 'https://n8n.shaheenkiarash.com/webhook/alex-note',
    sendHeaders: true, headerParameters: { parameters: [{ name: 'X-Alex-Token', value: HQ_TOKEN }] },
    sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ text: $json.note, source: "radar-collector" }) }}',
    options: {},
  },
});
connect('Normalize Items', 'Filter New');
connect('Filter New', 'Insert Rows');
connect('Insert Rows', 'Build Urgent Note');
connect('Build Urgent Note', 'Notify Inbox');

const settings = {
  executionOrder: 'v1', timezone: 'Europe/Stockholm', errorWorkflow: ERROR_WF,
  // saveDataSuccessExecution MUST stay 'all': the n8n liveness monitor reads "latest run" per
  // workflow; with success-saving off, a healthy daily collector looks silent >26h = false broken flag.
  saveManualExecutions: true, saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all',
};

async function api(method, p, body) {
  const r = await fetch(API + p, {
    method,
    headers: { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(method + ' ' + p + ' -> ' + r.status + ': ' + text.slice(0, 500));
  return text ? JSON.parse(text) : null;
}

(async () => {
  const list = await api('GET', '/workflows?limit=100');
  const existing = (list.data || []).find(w => w.name === NAME);
  let id;
  if (existing) {
    id = existing.id;
    console.log('updating existing workflow', id);
    await api('PUT', '/workflows/' + id, { name: NAME, nodes, connections, settings });
  } else {
    const created = await api('POST', '/workflows', { name: NAME, nodes, connections, settings });
    id = created.id;
    console.log('created workflow', id);
  }
  await api('POST', '/workflows/' + id + '/activate', {});
  console.log('activated', id);
  // Export for the docs/n8n propagation surface
  const full = await api('GET', '/workflows/' + id);
  const outDir1 = path.join(repo, 'work/15-alex-ai-radar/config');
  const outDir2 = path.join(repo, 'docs/n8n/radar-collector');
  fs.mkdirSync(outDir1, { recursive: true });
  fs.mkdirSync(outDir2, { recursive: true });
  fs.writeFileSync(path.join(outDir1, 'radar-collector.json'), JSON.stringify(full, null, 2));
  fs.writeFileSync(path.join(outDir2, 'workflow.json'), JSON.stringify(full, null, 2));
  console.log('exported to work/15 config + docs/n8n/radar-collector');
})().catch(e => { console.error(e.message); process.exit(1); });

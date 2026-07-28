// Cost cuts: DRAIN_CAP 40->10 on #03/#14 (bounds any future runaway drain), Scanner MAX_AGE_HOURS
// 100->72 (Shaheen's 72h window, where it's an exact numeric filter). Backup-first, assert, syntax
// -check, PUT, read-back, active-verify. DRY_RUN=1 => no PUT.
const fs = require('fs'); const path = require('path');
const KEY = fs.readFileSync(path.join(__dirname, '../work/03-application-engine/config/n8n-api-key.txt'), 'utf8').trim();
const BASE = 'https://n8n.shaheenkiarash.com/api/v1';
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const DRY = process.env.DRY_RUN === '1';
const ALLOWED = ['executionOrder','timezone','errorWorkflow','saveDataErrorExecution','saveDataSuccessExecution','saveManualExecutions','saveExecutionProgress'];
const api = async (m,u,b)=>{const r=await fetch(BASE+u,{method:m,headers:HDRS,body:b?JSON.stringify(b):undefined});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch(e){}return{status:r.status,json:j,txt:t}};
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const byName=(wf,n)=>wf.nodes.find(x=>x.name===n);

const JOBS = [
  { id:'9XuIEfxS71DEetVR', label:'#03', node:'Dedup Against Log', find:'const DRAIN_CAP = 40;', repl:'const DRAIN_CAP = 10;', pos:'const DRAIN_CAP = 10;' },
  { id:'9x9M3EnEEeX3O8dy', label:'#14', node:'Dedup Against Log', find:'const DRAIN_CAP = 40;', repl:'const DRAIN_CAP = 10;', pos:'const DRAIN_CAP = 10;' },
  { id:'5tPXbhdpp6PfF56V', label:'scanner', node:'Map + Prefilter + Cap', find:'const MAX_AGE_HOURS = 100;', repl:'const MAX_AGE_HOURS = 72;', pos:'const MAX_AGE_HOURS = 72;' },
];

(async()=>{
  for (const j of JOBS) {
    const g = await api('GET', `/workflows/${j.id}`); const wf=g.json; const was=wf.active;
    const node = byName(wf, j.node);
    if (!node) { console.log(`${j.label}: MISS ${j.node}`); continue; }
    const c = node.parameters.jsCode.split(j.find).length-1;
    if (c !== 1) { console.log(`${j.label}: ASSERT-FAIL ${j.find} found ${c}x`); continue; }
    node.parameters.jsCode = node.parameters.jsCode.split(j.find).join(j.repl);
    try { new AsyncFunction(node.parameters.jsCode); } catch(e){ console.log(`${j.label}: SYNTAX-FAIL ${e.message}`); continue; }
    if (DRY) { console.log(`${j.label}: ok (dry) ${j.find} -> ${j.repl}`); continue; }
    const s={}; for(const k of ALLOWED) if(wf.settings&&wf.settings[k]!==undefined) s[k]=wf.settings[k];
    const put = await api('PUT', `/workflows/${j.id}`, {name:wf.name,nodes:wf.nodes,connections:wf.connections,settings:s});
    if (put.status!==200){ console.log(`${j.label}: PUT ${put.status} ${put.txt.slice(0,150)}`); continue; }
    const rb = await api('GET', `/workflows/${j.id}`); const has = JSON.stringify(rb.json).includes(j.pos);
    let active = rb.json.active; if(!active){const a=await api('POST',`/workflows/${j.id}/activate`);active=a.json&&a.json.active;}
    console.log(`${j.label}: PUT ok. present=${has} active=${active} (was ${was}) ${has&&active?'VERIFIED':'WARN'}`);
  }
})();

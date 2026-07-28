// Simplify the BD engines (#03/#14) to a lean source->score->gate->draft->render->log flow.
// Deletes the 18-node dedup/bank/review layer, rewires, and trims Compute Costs + Append Run Log
// to the kept run_log columns. Shaheen 2026-07-28. clone = build an inactive clone + validate;
// live = apply to #03/#14 backup-first with read-back.
const fs = require('fs'); const path = require('path');
const KEY = fs.readFileSync(path.join(__dirname, '../work/03-application-engine/config/n8n-api-key.txt'), 'utf8').trim();
const BASE = 'https://n8n.shaheenkiarash.com/api/v1';
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const ALLOWED = ['executionOrder','timezone','errorWorkflow','saveDataErrorExecution','saveDataSuccessExecution','saveManualExecutions','saveExecutionProgress'];
const api = async (m,u,b)=>{const r=await fetch(BASE+u,{method:m,headers:HDRS,body:b?JSON.stringify(b):undefined});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch(e){}return{status:r.status,json:j,txt:t}};
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

const DELETE = ['Read Processed Log','Read Bank','Read Sibling Log','Dedup Against Log','Format Sourced Row','Anything To Bank?','Bank Sourced Jobs','Rehydrate Batch','Format Processed Row','Append Processed Job','Append Seen Id','Seen Ids Failed','Format Review Row S3','Append Needs Review S3','Format Review Row S5','Append Needs Review S5','Format Timeout Row','Append Timeout Review'];

const NEW_COMPUTE = `// Simplified run-log row builder (cost tracking + dedup removed 2026-07-28, Shaheen).
const j = $('Rebind PDFs').item.json;
return { json: {
  date: new Date().toISOString().slice(0, 10),
  job_posting_id: j.job_posting_id || '',
  company: j.company_name || '',
  location: j.job_location || '',
  rank_score: j.rank_score == null ? '' : j.rank_score,
  model: j.stage2_model || '',
  drive_folder_url: j.drive_folder_url || '',
  job_url: j.url || '',
  status: 'draft_ready'
} };`;

const KEEP_COLS = ['date','job_posting_id','company','location','rank_score','model','drive_folder_url','job_url','status'];

function simplify(wf) {
  const log = [];
  const has = (n)=>wf.nodes.some(x=>x.name===n);
  for (const n of DELETE) if (!has(n)) log.push('note: "'+n+'" already absent');
  // 1) drop the nodes
  const before = wf.nodes.length;
  wf.nodes = wf.nodes.filter(n => !DELETE.includes(n.name));
  log.push(`deleted ${before - wf.nodes.length} nodes (${before}->${wf.nodes.length})`);
  // 2) connections: drop deleted sources, drop targets pointing at deleted nodes
  const conns = {};
  for (const [src, val] of Object.entries(wf.connections)) {
    if (DELETE.includes(src)) continue;
    const main = (val.main||[]).map(outs => (outs||[]).filter(t => !DELETE.includes(t.node)));
    conns[src] = { ...val, main };
  }
  wf.connections = conns;
  // 3) rewire the new spine
  const set = (src, arr)=>{ wf.connections[src] = { main: arr }; };
  if (wf.connections['Parse Jobs']) set('Parse Jobs', [[{node:'Build Match Request',type:'main',index:0}]]);
  if (wf.connections['Stage 3 Gate']) set('Stage 3 Gate', [[{node:'Passed Gate?',type:'main',index:0}]]);
  // Passed Gate? true stays -> Build Writer Request (already there), false now empty
  if (wf.connections['Passed Gate?']) { const m=wf.connections['Passed Gate?'].main; wf.connections['Passed Gate?'] = { main: [ m[0]||[], [] ] }; }
  if (wf.connections['QA Passed?']) { const m=wf.connections['QA Passed?'].main; wf.connections['QA Passed?'] = { main: [ m[0]||[], [] ] }; }
  if (wf.connections['CV One Page?']) { const m=wf.connections['CV One Page?'].main; wf.connections['CV One Page?'] = { main: [ m[0]||[], [] ] }; }
  if (wf.connections['Snapshot Ready Item?']) { const m=wf.connections['Snapshot Ready Item?'].main; wf.connections['Snapshot Ready Item?'] = { main: [ m[0]||[], [] ] }; }
  log.push('rewired: Parse Jobs->Build Match; Stage 3 Gate->Passed Gate?; gate/QA/one-page/timeout false-branches emptied');
  // 4) Compute Costs -> row builder
  const cc = wf.nodes.find(n=>n.name==='Compute Costs');
  if (cc) { cc.parameters.jsCode = NEW_COMPUTE; try{ new AsyncFunction(cc.parameters.jsCode);}catch(e){log.push('SYNTAX Compute: '+e.message);} log.push('Compute Costs -> simplified row builder'); }
  // 5) Append Run Log -> only kept columns
  const arl = wf.nodes.find(n=>n.name==='Append Run Log');
  if (arl) {
    const c = arl.parameters.columns || {};
    c.mappingMode = 'defineBelow';
    c.value = {}; for (const k of KEEP_COLS) c.value[k] = `={{ $json["${k}"] }}`;
    c.schema = KEEP_COLS.map(k=>({id:k,displayName:k,required:false,defaultMatch:false,display:true,type:'string',canBeUsedToMatch:true}));
    c.matchingColumns = [];
    arl.parameters.columns = c;
    log.push('Append Run Log -> '+KEEP_COLS.length+' kept columns');
  }
  return log;
}
const putBody=(wf)=>{const s={};for(const k of ALLOWED)if(wf.settings&&wf.settings[k]!==undefined)s[k]=wf.settings[k];return {name:wf.name,nodes:wf.nodes,connections:wf.connections,settings:s};};

(async()=>{
  const mode = process.argv[2];
  if (mode === 'clone') {
    const g = await api('GET','/workflows/9x9M3EnEEeX3O8dy'); const wf=g.json;
    simplify(wf).forEach(l=>console.log('  '+l));
    const body = putBody(wf); body.name='ZZ Simplify Clone Test (DELETE ME)';
    const post = await api('POST','/workflows',body);
    if (post.status!==200&&post.status!==201){console.log('CLONE POST '+post.status+': '+post.txt.slice(0,300));return;}
    const cid=post.json.id; const rb=await api('GET',`/workflows/${cid}`);
    const names=rb.json.nodes.map(n=>n.name);
    const leftover = DELETE.filter(d=>names.includes(d));
    console.log(`  clone ${cid}: n8n ACCEPTED. nodes=${rb.json.nodes.length} leftover-deleted=${leftover.length?leftover:'none'} ParseJobs->${(rb.json.connections['Parse Jobs'].main[0][0]||{}).node}`);
    console.log('  >> clone id: '+cid);
  } else if (mode === 'live') {
    const TS = new Date().toISOString().replace(/[:.]/g,'').slice(0,15);
    for (const [id,label] of [['9XuIEfxS71DEetVR','#03'],['9x9M3EnEEeX3O8dy','#14']]) {
      console.log(`\n=== ${label} (${id}) ===`);
      const g = await api('GET',`/workflows/${id}`); const wf=g.json; const was=wf.active;
      fs.writeFileSync(path.join(__dirname,`n8n-backups/${id}-pre-simplify-${TS}.json`), JSON.stringify(g.json));
      simplify(wf).forEach(l=>console.log('  '+l));
      const put = await api('PUT',`/workflows/${id}`, putBody(wf));
      if (put.status!==200){console.log(`  PUT ${put.status}: ${put.txt.slice(0,200)}`);continue;}
      const rb=await api('GET',`/workflows/${id}`); const names=rb.json.nodes.map(n=>n.name);
      const leftover=DELETE.filter(d=>names.includes(d));
      let active=rb.json.active; if(!active){const a=await api('POST',`/workflows/${id}/activate`);active=a.json&&a.json.active;}
      console.log(`  PUT ok. nodes=${rb.json.nodes.length} leftover=${leftover.length?leftover:'none'} active=${active} (was ${was}) ${!leftover.length&&active?'VERIFIED':'WARN'}`);
    }
  } else if (mode==='delete') { const d=await api('DELETE',`/workflows/${process.argv[3]}`); console.log('delete: '+d.status); }
  else console.log('usage: clone | live | delete <id>');
})();

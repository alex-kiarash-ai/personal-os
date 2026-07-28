// #31 (portal) limited simplification: remove the review queue + trim run_log, but KEEP the
// Scanner-fed dedup/bank layer (it's #31's input, not removable). backup-first, read-back.
const fs=require('fs');const path=require('path');
const KEY=fs.readFileSync(path.join(__dirname,'../work/03-application-engine/config/n8n-api-key.txt'),'utf8').trim();
const BASE='https://n8n.shaheenkiarash.com/api/v1';const HDRS={'X-N8N-API-KEY':KEY,'Content-Type':'application/json'};
const ALLOWED=['executionOrder','timezone','errorWorkflow','saveDataErrorExecution','saveDataSuccessExecution','saveManualExecutions','saveExecutionProgress'];
const api=async(m,u,b)=>{const r=await fetch(BASE+u,{method:m,headers:HDRS,body:b?JSON.stringify(b):undefined});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch(e){}return{status:r.status,json:j,txt:t}};
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const ID='sxEYRyeHH7i1mHzb';
const DELETE=['Format Review Row S3','Append Needs Review S3','Format Review Row S5','Append Needs Review S5'];
const KEEP_COLS=['date','job_posting_id','company','location','rank_score','model','drive_folder_url','job_url','status'];
const NEW_COMPUTE=`// Simplified run-log row builder (cost tracking + review queue removed 2026-07-28, Shaheen).
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
(async()=>{
  const g=await api('GET',`/workflows/${ID}`); const wf=g.json; const was=wf.active;
  const TS=new Date().toISOString().replace(/[:.]/g,'').slice(0,15);
  fs.writeFileSync(path.join(__dirname,`n8n-backups/${ID}-pre-simplify-${TS}.json`),JSON.stringify(g.json));
  const before=wf.nodes.length;
  wf.nodes=wf.nodes.filter(n=>!DELETE.includes(n.name));
  // connections: drop deleted sources + targets
  const conns={};
  for(const [src,val] of Object.entries(wf.connections)){ if(DELETE.includes(src))continue; conns[src]={...val,main:(val.main||[]).map(o=>(o||[]).filter(t=>!DELETE.includes(t.node)))}; }
  wf.connections=conns;
  // empty the reject branches
  for(const gn of ['Passed Gate?','QA Passed?','CV One Page?']){ if(wf.connections[gn]){ const m=wf.connections[gn].main; wf.connections[gn]={main:[m[0]||[],[]]}; } }
  // Compute Costs -> row builder
  const cc=wf.nodes.find(n=>n.name==='Compute Costs'); if(cc){cc.parameters.jsCode=NEW_COMPUTE; try{new AsyncFunction(cc.parameters.jsCode)}catch(e){console.log('SYNTAX '+e.message)};}
  // Append Run Log -> kept cols
  const arl=wf.nodes.find(n=>n.name==='Append Run Log'); if(arl){const c=arl.parameters.columns||{};c.mappingMode='defineBelow';c.value={};for(const k of KEEP_COLS)c.value[k]=`={{ $json["${k}"] }}`;c.schema=KEEP_COLS.map(k=>({id:k,displayName:k,required:false,defaultMatch:false,display:true,type:'string',canBeUsedToMatch:true}));c.matchingColumns=[];arl.parameters.columns=c;}
  console.log(`#31: deleted ${before-wf.nodes.length} review nodes (${before}->${wf.nodes.length}); reject branches emptied; Compute+Append Run Log trimmed; dedup/bank KEPT (Scanner input)`);
  const s={};for(const k of ALLOWED)if(wf.settings&&wf.settings[k]!==undefined)s[k]=wf.settings[k];
  const put=await api('PUT',`/workflows/${ID}`,{name:wf.name,nodes:wf.nodes,connections:wf.connections,settings:s});
  if(put.status!==200){console.log('PUT '+put.status+': '+put.txt.slice(0,200));return;}
  const rb=await api('GET',`/workflows/${ID}`); const names=rb.json.nodes.map(n=>n.name); const leftover=DELETE.filter(d=>names.includes(d));
  let active=rb.json.active; if(!active){const a=await api('POST',`/workflows/${ID}/activate`);active=a.json&&a.json.active;}
  // runtime-ref scan
  let refs=0; for(const n of rb.json.nodes){const sc=JSON.stringify(n.parameters||{});for(const d of DELETE)if(sc.includes("$('"+d+"')"))refs++;}
  console.log(`PUT ok. nodes=${rb.json.nodes.length} leftover=${leftover.length?leftover:'none'} deadRefs=${refs} active=${active} (was ${was}) ${!leftover.length&&!refs&&active?'VERIFIED':'WARN'}`);
})();

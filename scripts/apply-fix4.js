// Fix4 (bank-drain read-guard) applier. Topology change: Read Processed Log -> continueErrorOutput,
// a new "Seen Ids Failed" marker node on the error branch (also -> Read Bank so the pipeline
// continues), Read Bank -> continueRegularOutput, and the Dedup seenErrored/suppressDrain guard.
// Usage: node apply-fix4.js clone      -> create an inactive clone of #03 with Fix4, validate wiring
//        node apply-fix4.js live       -> apply Fix4 to #03/#14/#31, backup-first, read-back
//        node apply-fix4.js delete ID  -> delete the clone
const fs = require('fs');
const path = require('path');
const KEY = fs.readFileSync(path.join(__dirname, '../work/03-application-engine/config/n8n-api-key.txt'), 'utf8').trim();
const BASE = 'https://n8n.shaheenkiarash.com/api/v1';
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const ALLOWED_SETTINGS = ['executionOrder','timezone','errorWorkflow','saveDataErrorExecution','saveDataSuccessExecution','saveManualExecutions','saveExecutionProgress'];
const ENGINES = [{id:'9XuIEfxS71DEetVR',label:'#03 BI'},{id:'9x9M3EnEEeX3O8dy',label:'#14 AI'},{id:'sxEYRyeHH7i1mHzb',label:'#31 portal'}];

const FIX4_FIND = "for (const id of done) drainable.delete(id);";
const FIX4_REPLACE = "for (const id of done) drainable.delete(id);\n// Fix4: if the seen_ids read ERRORED (fail-open on Read Processed Log), the done set is\n// untrustworthy - never re-drain the historical bank; still process + bank new items below.\nlet seenErrored = false;\ntry { seenErrored = $('Seen Ids Failed').all().some(i => i.json && i.json.__seen_ids_error); } catch (e) { seenErrored = false; }\nif (seenErrored) drainable.clear();";
const MARKER_CODE = "// Fix4 marker: fires ONLY on the Read Processed Log error output. Dedup reads $('Seen Ids Failed')\n// to know the seen_ids read failed (vs legitimately empty) and suppress the bank drain.\nreturn [{ json: { __seen_ids_error: true } }];";

async function api(method, url, body) {
  const res = await fetch(BASE + url, { method, headers: HDRS, body: body ? JSON.stringify(body) : undefined });
  const txt = await res.text(); let json=null; try{json=JSON.parse(txt)}catch(e){}
  return { status: res.status, json, txt };
}
const byName = (wf,n)=>wf.nodes.find(x=>x.name===n);
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

// Mutate wf in place; returns {ok, log[]}.
function applyFix4(wf) {
  const log = []; let ok = true;
  const rpl = byName(wf,'Read Processed Log'), rb = byName(wf,'Read Bank'), dedup = byName(wf,'Dedup Against Log');
  if (!rpl || !rb || !dedup) { log.push('MISS a core node'); return {ok:false,log}; }
  if (byName(wf,'Seen Ids Failed')) { log.push('Seen Ids Failed already exists - already applied?'); return {ok:false,log}; }
  // flags
  rpl.onError='continueErrorOutput'; rpl.retryOnFail=true; rpl.maxTries=4; rpl.waitBetweenTries=5000; log.push('ok Read Processed Log continueErrorOutput+retry');
  rb.onError='continueRegularOutput'; log.push('ok Read Bank continueRegularOutput');
  // marker node
  const pos = Array.isArray(rpl.position) ? rpl.position : [1000,-2600];
  wf.nodes.push({ parameters:{jsCode:MARKER_CODE}, id:'fix4-seen-ids-failed', name:'Seen Ids Failed', type:'n8n-nodes-base.code', typeVersion:2, position:[pos[0]+180, pos[1]+180] });
  log.push('ok added Seen Ids Failed node');
  // connections: assert RPL currently -> [Read Bank] only, then add error output -> Seen Ids Failed; Seen Ids Failed -> Read Bank
  const c = wf.connections['Read Processed Log'];
  if (!c || !Array.isArray(c.main) || c.main.length!==1 || !(c.main[0]||[]).some(t=>t.node==='Read Bank')) { log.push('ASSERT-FAIL: Read Processed Log connection not the expected single ->Read Bank'); return {ok:false,log}; }
  c.main[1] = [{ node:'Seen Ids Failed', type:'main', index:0 }];
  wf.connections['Seen Ids Failed'] = { main: [[{ node:'Read Bank', type:'main', index:0 }]] };
  log.push('ok wired error output -> Seen Ids Failed -> Read Bank');
  // Dedup guard
  const hits = dedup.parameters.jsCode.split(FIX4_FIND).length-1;
  if (hits!==1) { log.push(`ASSERT-FAIL: Dedup Fix4 find matched ${hits}x`); return {ok:false,log}; }
  dedup.parameters.jsCode = dedup.parameters.jsCode.split(FIX4_FIND).join(FIX4_REPLACE);
  try { new AsyncFunction(dedup.parameters.jsCode); log.push('ok Dedup guard syntax'); }
  catch(e){ log.push('SYNTAX-FAIL Dedup: '+e.message); ok=false; }
  return {ok,log};
}
function verifyWiring(wf) {
  const issues=[];
  const c=wf.connections['Read Processed Log'];
  if (!c.main[1] || !c.main[1].some(t=>t.node==='Seen Ids Failed')) issues.push('RPL error-output not ->Seen Ids Failed');
  if (!wf.connections['Seen Ids Failed'] || !wf.connections['Seen Ids Failed'].main[0].some(t=>t.node==='Read Bank')) issues.push('Seen Ids Failed not ->Read Bank');
  if (!byName(wf,'Seen Ids Failed')) issues.push('marker node missing');
  if (byName(wf,'Read Processed Log').onError!=='continueErrorOutput') issues.push('RPL onError wrong');
  if (byName(wf,'Read Bank').onError!=='continueRegularOutput') issues.push('RB onError wrong');
  if (!byName(wf,'Dedup Against Log').parameters.jsCode.includes('if (seenErrored) drainable.clear();')) issues.push('Dedup guard missing');
  return issues;
}
const putBody = (wf)=>{ const s={}; for(const k of ALLOWED_SETTINGS) if(wf.settings&&wf.settings[k]!==undefined) s[k]=wf.settings[k]; return {name:wf.name,nodes:wf.nodes,connections:wf.connections,settings:s}; };

(async () => {
  const mode = process.argv[2];
  if (mode==='clone') {
    const g = await api('GET','/workflows/9XuIEfxS71DEetVR'); const wf=g.json;
    const r = applyFix4(wf); r.log.forEach(l=>console.log('  '+l));
    if (!r.ok) { console.log('  >> apply failed, no clone created'); return; }
    const body = putBody(wf); body.name = 'ZZ Fix4 Clone Test (DELETE ME)';
    const post = await api('POST','/workflows', body);
    if (post.status!==200 && post.status!==201) { console.log(`  CLONE POST failed ${post.status}: ${post.txt.slice(0,300)}`); return; }
    const cid = post.json.id; console.log(`  clone created id=${cid} (n8n ACCEPTED the Fix4 topology)`);
    const rb = await api('GET',`/workflows/${cid}`); const issues = verifyWiring(rb.json);
    console.log(`  clone wiring: ${issues.length?('ISSUES '+JSON.stringify(issues)):'ALL GOOD'} | nodes=${rb.json.nodes.length} active=${rb.json.active}`);
    console.log(`  >> clone id for cleanup: ${cid}`);
  } else if (mode==='live') {
    for (const e of ENGINES) {
      console.log(`\n=== ${e.label} (${e.id}) ===`);
      const g = await api('GET',`/workflows/${e.id}`); const wf=g.json; const wasActive=wf.active;
      const r = applyFix4(wf); r.log.forEach(l=>console.log('  '+l));
      if (!r.ok) { console.log(`  >> ${e.label} NOT written`); continue; }
      const issues = verifyWiring(wf);
      if (issues.length) { console.log(`  pre-PUT wiring ISSUES ${JSON.stringify(issues)} - NOT written`); continue; }
      const put = await api('PUT',`/workflows/${e.id}`, putBody(wf));
      if (put.status!==200) { console.log(`  PUT failed ${put.status}: ${put.txt.slice(0,300)}`); continue; }
      const rbk = await api('GET',`/workflows/${e.id}`); const iss2 = verifyWiring(rbk.json);
      let active = rbk.json.active; if (!active){ const a=await api('POST',`/workflows/${e.id}/activate`); active=a.json&&a.json.active; }
      console.log(`  PUT ok. read-back wiring: ${iss2.length?JSON.stringify(iss2):'ALL GOOD'} | nodes=${rbk.json.nodes.length} active=${active} (was ${wasActive})`);
      console.log((iss2.length||!active)?`  >> VERIFY WARNING ${e.label}`:`  >> ${e.label} Fix4 VERIFIED`);
    }
  } else if (mode==='delete') {
    const id = process.argv[3]; const d = await api('DELETE',`/workflows/${id}`);
    console.log(`  delete ${id}: ${d.status}`);
  } else console.log('usage: clone | live | delete <id>');
})();

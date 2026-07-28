// Sheet cleanup for #03/#14: delete orphaned tabs (processed_jobs, needs_review, bank, seen_ids)
// and trim run_log columns BY NAME. One metadata+gridData call per sheet (no fragile cross-refs).
const fs=require('fs');const path=require('path');
const KEY=fs.readFileSync(path.join(__dirname,'../work/03-application-engine/config/n8n-api-key.txt'),'utf8').trim();
const BASE='https://n8n.shaheenkiarash.com/api/v1';const HOST='https://n8n.shaheenkiarash.com';
const HDRS={'X-N8N-API-KEY':KEY,'Content-Type':'application/json'};
const WHPATH='simplify-sheets-'+Math.random().toString(36).slice(2,10);
const api=async(m,u,b)=>{const r=await fetch(BASE+u,{method:m,headers:HDRS,body:b?JSON.stringify(b):undefined});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch(e){}return{status:r.status,json:j,txt:t}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const SHEETS = `return [ { json: { sid: '19puwN6wxFHI7iICrdafiFn1Diqq7qJTe5-5r0Y2XQFY', label:'#03' } }, { json: { sid: '11lvksV5NmLK7vWvt4oHIPTXZ1pwRVi67UrWVI3lrAHQ', label:'#14' } } ];`;
const META_URL = '=https://sheets.googleapis.com/v4/spreadsheets/{{ $json.sid }}?fields=sheets.properties(sheetId,title)';
const BUILD = `const DEL_TABS=['processed_jobs','needs_review','bank','seen_ids'];
const DEL_COLS=['country','target_role','fit_score','interest_score','input_tokens','output_tokens','claude_cost','brightdata_cost','total_cost','stage2_model','stage2_cost','stage4_model','stage4_cost'];
const S=$('Sheets').all(); const M=$input.all(); const out=[];
for(let i=0;i<S.length;i++){
  const sid=S[i].json.sid, label=S[i].json.label;
  let meta=M[i].json.body; if(typeof meta==='string'){try{meta=JSON.parse(meta)}catch(e){}}
  const sheets=(meta&&meta.sheets)||[];
  const byTitle={}; let header=[];
  for(const s of sheets){ const p=s.properties||{}; byTitle[p.title]=p.sheetId;
    if(p.title==='run_log'){ const rows=(s.data&&s.data[0]&&s.data[0].rowData)||[]; const vals=(rows[0]&&rows[0].values)||[]; header=vals.map(v=>v&&v.formattedValue); } }
  const runlogId=byTitle['run_log'];
  const requests=[];
  for(const t of DEL_TABS){ if(byTitle[t]!==undefined) requests.push({deleteSheet:{sheetId:byTitle[t]}}); }
  const idxs=DEL_COLS.map(c=>header.indexOf(c)).filter(x=>x>=0).sort((a,b)=>b-a);
  for(const ci of idxs){ requests.push({deleteDimension:{range:{sheetId:runlogId,dimension:'COLUMNS',startIndex:ci,endIndex:ci+1}}}); }
  out.push({json:{sid,label,tabsFound:DEL_TABS.filter(t=>byTitle[t]!==undefined),colsFound:idxs.length,headerLen:header.length,requests}});
}
return out;`;
const SUMM = `const req=$('Build').all(); const res=$input.all(); const out=[];
for(let i=0;i<res.length;i++){ const b=req[i].json; let body=res[i].json.body; if(typeof body==='string'){try{body=JSON.parse(body)}catch(e){}}
 out.push({label:b.label, tabsDeleted:b.tabsFound, colsDeleted:b.colsFound, status:Number(res[i].json.statusCode), err: Number(res[i].json.statusCode)>=400?JSON.stringify(body).slice(0,150):''}); }
return [{json:{done:out}}];`;

const WF={name:'ZZ Simplify sheets (DELETE ME)',nodes:[
 {parameters:{httpMethod:'GET',path:WHPATH,responseMode:'lastNode',options:{}},id:'wh',name:'Webhook',type:'n8n-nodes-base.webhook',typeVersion:2,position:[0,0],webhookId:WHPATH},
 {parameters:{jsCode:SHEETS},id:'sh',name:'Sheets',type:'n8n-nodes-base.code',typeVersion:2,position:[180,0]},
 {parameters:{method:'GET',url:META_URL,authentication:'predefinedCredentialType',nodeCredentialType:'googleSheetsOAuth2Api',options:{response:{response:{fullResponse:true,neverError:true}},batching:{batch:{batchSize:1}}}},id:'mt',name:'Meta',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[360,0],onError:'continueRegularOutput',credentials:{googleSheetsOAuth2Api:{id:'UhK77WK48hRv85bo',name:'Google Sheets account'}}},
 {parameters:{jsCode:BUILD},id:'bd',name:'Build',type:'n8n-nodes-base.code',typeVersion:2,position:[540,0]},
 {parameters:{method:'POST',url:'=https://sheets.googleapis.com/v4/spreadsheets/{{ $json.sid }}:batchUpdate',authentication:'predefinedCredentialType',nodeCredentialType:'googleSheetsOAuth2Api',sendBody:true,specifyBody:'json',jsonBody:'={{ JSON.stringify({requests: $json.requests}) }}',options:{response:{response:{fullResponse:true,neverError:true}},batching:{batch:{batchSize:1}}}},id:'bu',name:'Batch',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[720,0],onError:'continueRegularOutput',credentials:{googleSheetsOAuth2Api:{id:'UhK77WK48hRv85bo',name:'Google Sheets account'}}},
 {parameters:{jsCode:SUMM},id:'sm',name:'Summarize',type:'n8n-nodes-base.code',typeVersion:2,position:[900,0]},
],connections:{
 'Webhook':{main:[[{node:'Sheets',type:'main',index:0}]]},
 'Sheets':{main:[[{node:'Meta',type:'main',index:0}]]},
 'Meta':{main:[[{node:'Build',type:'main',index:0}]]},
 'Build':{main:[[{node:'Batch',type:'main',index:0}]]},
 'Batch':{main:[[{node:'Summarize',type:'main',index:0}]]},
},settings:{executionOrder:'v1'}};

(async()=>{
 const post=await api('POST','/workflows',WF); if(post.status!==200&&post.status!==201){console.log('CREATE '+post.status+': '+post.txt.slice(0,300));return;}
 const id=post.json.id; await api('POST',`/workflows/${id}/activate`);
 let result=null; for(let a=1;a<=5;a++){await sleep(3500);try{const r=await fetch(`${HOST}/webhook/${WHPATH}`);const t=await r.text();if(r.status===200){try{result=JSON.parse(t)}catch(e){result={raw:t}}break;}else console.log('  attempt '+a+': '+r.status+' '+t.slice(0,80));}catch(e){console.log('  attempt '+a+': '+e.message);}}
 console.log('\n===== SHEET SIMPLIFY ====='); console.log(JSON.stringify(result,null,2));
 const del=await api('DELETE',`/workflows/${id}`); console.log('cleanup '+id+': '+del.status);
})();

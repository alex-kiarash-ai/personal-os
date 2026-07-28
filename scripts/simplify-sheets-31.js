// #31 sheet cleanup (sheet 1hmLHyW0, SHARED with the Scanner): delete ONLY the needs_review tab
// (NOT processed_jobs/seen_ids/company_portals - the Scanner needs those) + trim run_log columns.
// Single hardcoded sid so there is no cross-node reference.
const fs=require('fs');const path=require('path');
const KEY=fs.readFileSync(path.join(__dirname,'../work/03-application-engine/config/n8n-api-key.txt'),'utf8').trim();
const BASE='https://n8n.shaheenkiarash.com/api/v1';const HOST='https://n8n.shaheenkiarash.com';
const HDRS={'X-N8N-API-KEY':KEY,'Content-Type':'application/json'};
const WHPATH='simplify-31-'+Math.random().toString(36).slice(2,10);
const SID='1hmLHyW0Yu6ZV8MpiKrECo2OACk4eC3Eb5xWR73HIeiU';
const api=async(m,u,b)=>{const r=await fetch(BASE+u,{method:m,headers:HDRS,body:b?JSON.stringify(b):undefined});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch(e){}return{status:r.status,json:j,txt:t}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const CRED={googleSheetsOAuth2Api:{id:'UhK77WK48hRv85bo',name:'Google Sheets account'}};
const http=(name,url,pos,extra)=>({parameters:Object.assign({method:'GET',url,authentication:'predefinedCredentialType',nodeCredentialType:'googleSheetsOAuth2Api',options:{response:{response:{fullResponse:true,neverError:true}}}},extra||{}),id:name.toLowerCase(),name,type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:pos,onError:'continueRegularOutput',credentials:CRED});

const BUILD=`const DEL_TABS=['needs_review'];
const DEL_COLS=['country','target_role','fit_score','interest_score','input_tokens','output_tokens','claude_cost','brightdata_cost','total_cost','stage2_model','stage2_cost','stage4_model','stage4_cost'];
let meta=$('Meta').first().json.body; if(typeof meta==='string'){try{meta=JSON.parse(meta)}catch(e){}}
const byTitle={}; (meta&&meta.sheets||[]).forEach(s=>{byTitle[s.properties.title]=s.properties.sheetId;});
let hb=$('Header').first().json.body; if(typeof hb==='string'){try{hb=JSON.parse(hb)}catch(e){}}
const header=((hb&&hb.values&&hb.values[0])||[]);
const runlogId=byTitle['run_log']; const requests=[];
for(const t of DEL_TABS){ if(byTitle[t]!==undefined) requests.push({deleteSheet:{sheetId:byTitle[t]}}); }
const idxs=DEL_COLS.map(c=>header.indexOf(c)).filter(x=>x>=0).sort((a,b)=>b-a);
for(const ci of idxs){ requests.push({deleteDimension:{range:{sheetId:runlogId,dimension:'COLUMNS',startIndex:ci,endIndex:ci+1}}}); }
return [{json:{tabsFound:DEL_TABS.filter(t=>byTitle[t]!==undefined),colsFound:idxs.length,allTabs:Object.keys(byTitle),requests}}];`;
const SUMM=`const b=$('Build').first().json; let body=$input.first().json.body; if(typeof body==='string'){try{body=JSON.parse(body)}catch(e){}}
return [{json:{tabsDeleted:b.tabsFound,colsDeleted:b.colsFound,sheetTabsBefore:b.allTabs,status:Number($input.first().json.statusCode),err:Number($input.first().json.statusCode)>=400?JSON.stringify(body).slice(0,150):''}}];`;

const WF={name:'ZZ Simplify #31 sheet (DELETE ME)',nodes:[
 {parameters:{httpMethod:'GET',path:WHPATH,responseMode:'lastNode',options:{}},id:'wh',name:'Webhook',type:'n8n-nodes-base.webhook',typeVersion:2,position:[0,0],webhookId:WHPATH},
 http('Meta',`https://sheets.googleapis.com/v4/spreadsheets/${SID}?fields=sheets.properties(sheetId,title)`,[180,0]),
 http('Header',`https://sheets.googleapis.com/v4/spreadsheets/${SID}/values/run_log!A1:AZ1`,[360,0]),
 {parameters:{jsCode:BUILD},id:'bd',name:'Build',type:'n8n-nodes-base.code',typeVersion:2,position:[540,0]},
 {parameters:{method:'POST',url:`https://sheets.googleapis.com/v4/spreadsheets/${SID}:batchUpdate`,authentication:'predefinedCredentialType',nodeCredentialType:'googleSheetsOAuth2Api',sendBody:true,specifyBody:'json',jsonBody:'={{ JSON.stringify({requests: $json.requests}) }}',options:{response:{response:{fullResponse:true,neverError:true}}}},id:'bu',name:'Batch',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[720,0],onError:'continueRegularOutput',credentials:CRED},
 {parameters:{jsCode:SUMM},id:'sm',name:'Summarize',type:'n8n-nodes-base.code',typeVersion:2,position:[900,0]},
],connections:{
 'Webhook':{main:[[{node:'Meta',type:'main',index:0}]]},
 'Meta':{main:[[{node:'Header',type:'main',index:0}]]},
 'Header':{main:[[{node:'Build',type:'main',index:0}]]},
 'Build':{main:[[{node:'Batch',type:'main',index:0}]]},
 'Batch':{main:[[{node:'Summarize',type:'main',index:0}]]},
},settings:{executionOrder:'v1'}};

(async()=>{
 const post=await api('POST','/workflows',WF); if(post.status!==200&&post.status!==201){console.log('CREATE '+post.status+': '+post.txt.slice(0,300));return;}
 const id=post.json.id; await api('POST',`/workflows/${id}/activate`);
 let result=null; for(let a=1;a<=5;a++){await sleep(3500);try{const r=await fetch(`${HOST}/webhook/${WHPATH}`);const t=await r.text();if(r.status===200){try{result=JSON.parse(t)}catch(e){result={raw:t}}break;}else console.log('  attempt '+a+': '+r.status+' '+t.slice(0,80));}catch(e){console.log('  attempt '+a+': '+e.message);}}
 console.log('\n===== #31 SHEET SIMPLIFY ====='); console.log(JSON.stringify(result,null,2));
 const del=await api('DELETE',`/workflows/${id}`); console.log('cleanup '+id+': '+del.status);
})();

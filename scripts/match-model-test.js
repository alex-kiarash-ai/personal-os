// Find the cheapest Moonshot model that returns valid scoring JSON for the Match stage.
// Runs the LIVE #14 Build Match Request code with a sample job to get the REAL body, then replays
// it against candidate models through a throwaway webhook (existing Kimi credential). Reports per
// model: status, prompt/completion/cached tokens, and whether the JSON has the gate-load-bearing
// fields. Self-deletes. kimi-k3 kept as the baseline to compare token burn against.
const fs = require('fs'); const path = require('path');
const KEY = fs.readFileSync(path.join(__dirname, '../work/03-application-engine/config/n8n-api-key.txt'), 'utf8').trim();
const BASE = 'https://n8n.shaheenkiarash.com/api/v1'; const HOST = 'https://n8n.shaheenkiarash.com';
const HDRS = { 'X-N8N-API-KEY': KEY, 'Content-Type': 'application/json' };
const WHPATH = 'match-model-test-' + Math.random().toString(36).slice(2, 10);
const api = async (m,u,b)=>{const r=await fetch(BASE+u,{method:m,headers:HDRS,body:b?JSON.stringify(b):undefined});const t=await r.text();let j=null;try{j=JSON.parse(t)}catch(e){}return{status:r.status,json:j,txt:t}};
const sleep = ms => new Promise(r=>setTimeout(r,ms));

const CANDIDATES = ['kimi-k3','kimi-k2.6','kimi-k2.7-code-highspeed'];
const SAMPLE_JOB = { job_title:'AI Automation Engineer', company_name:'Acme Fintech', job_location:'Remote, EU',
  description:'We are hiring an AI Automation Engineer to build production automations with n8n and LLMs (Claude/OpenAI). 3+ years in automation or backend. You will design multi-step agent workflows, integrate APIs, add evals and human-in-the-loop review, and own reliability. Nice to have: Power BI, financial services, Docker, self-hosting. Fully remote within the EU.' };

(async () => {
  // 1) get the REAL match body from the live #14 Build Match Request code
  const g = await api('GET', '/workflows/9x9M3EnEEeX3O8dy');
  const code = g.json.nodes.find(n=>n.name==='Build Match Request').parameters.jsCode;
  let realBody;
  try { const fn = new Function('$json', code); realBody = fn(SAMPLE_JOB).json.body; }
  catch (e) { console.log('could not build real body: ' + e.message); return; }
  console.log('real match body: model='+realBody.model+' max_tokens='+realBody.max_tokens+' msgs='+realBody.messages.length+' sys_chars='+realBody.messages[0].content.length);

  // 2) candidate bodies (swap model; drop reasoning_effort since kimi ignores it and v1 rejects it)
  const BUILD = 'const cands = ' + JSON.stringify(CANDIDATES) + ';\n' +
    'const base = ' + JSON.stringify(realBody) + ';\n' +
    'return cands.map(m => { const b = JSON.parse(JSON.stringify(base)); b.model = m; delete b.reasoning_effort; return { json: { model: m, body: b } }; });';
  const SUMM = `const reqs = $('Build Cands').all(); const res = $input.all(); const out = [];
for (let i=0;i<res.length;i++){ const model=(reqs[i]&&reqs[i].json.model)||'?'; const r=res[i].json||{}; const code=Number(r.statusCode);
  let body=r.body; if(typeof body==='string'){try{body=JSON.parse(body)}catch(e){}}
  const u=(body&&body.usage)||{}; let txt=''; try{txt=body.choices[0].message.content}catch(e){}
  let parsed=null; try{ let s=String(txt).trim().replace(/^\\\`\\\`\\\`json/i,'').replace(/^\\\`\\\`\\\`/,'').replace(/\\\`\\\`\\\`$/,'').trim(); const a=s.indexOf('{'),b=s.lastIndexOf('}'); parsed=JSON.parse(s.slice(a,b+1)); }catch(e){}
  const okJson = !!(parsed && parsed.fit_score!==undefined && parsed.interest_score!==undefined && parsed.target_role!==undefined);
  const err = code>=400 ? (JSON.stringify(body).slice(0,120)) : '';
  out.push({ model, status:code, prompt_tokens:u.prompt_tokens||null, completion_tokens:u.completion_tokens||null, cached:(u.prompt_tokens_details||{}).cached_tokens||null, valid_scoring_json:okJson, err }); }
return [{ json: { results: out } }];`;

  const WF = { name:'ZZ Match model test (DELETE ME)', nodes:[
    { parameters:{httpMethod:'GET',path:WHPATH,responseMode:'lastNode',options:{}}, id:'wh', name:'Webhook', type:'n8n-nodes-base.webhook', typeVersion:2, position:[0,0], webhookId:WHPATH },
    { parameters:{jsCode:BUILD}, id:'bc', name:'Build Cands', type:'n8n-nodes-base.code', typeVersion:2, position:[200,0] },
    { parameters:{method:'POST',url:'https://api.moonshot.ai/v1/chat/completions',authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',sendBody:true,specifyBody:'json',jsonBody:'={{ $json.body }}',options:{response:{response:{fullResponse:true,neverError:true}},batching:{batch:{batchSize:1}},timeout:600000}}, id:'call', name:'Call', type:'n8n-nodes-base.httpRequest', typeVersion:4.2, position:[400,0], onError:'continueRegularOutput', credentials:{httpHeaderAuth:{id:'OffvMkWR01zcpqxo',name:'Kimi K3 (Moonshot header)'}} },
    { parameters:{jsCode:SUMM}, id:'sm', name:'Summarize', type:'n8n-nodes-base.code', typeVersion:2, position:[600,0] },
  ], connections:{ 'Webhook':{main:[[{node:'Build Cands',type:'main',index:0}]]}, 'Build Cands':{main:[[{node:'Call',type:'main',index:0}]]}, 'Call':{main:[[{node:'Summarize',type:'main',index:0}]]} }, settings:{executionOrder:'v1'} };

  const post = await api('POST','/workflows',WF); if(post.status!==200&&post.status!==201){console.log('CREATE '+post.status+' '+post.txt.slice(0,200));return;}
  const id=post.json.id; await api('POST',`/workflows/${id}/activate`);
  let result=null; for(let a=1;a<=5;a++){ await sleep(4000); try{ const r=await fetch(`${HOST}/webhook/${WHPATH}`); const t=await r.text(); if(r.status===200){try{result=JSON.parse(t)}catch(e){result={raw:t}} break;} else console.log('  attempt '+a+': '+r.status);}catch(e){console.log('  attempt '+a+': '+e.message);} }
  console.log('\n===== MATCH MODEL TEST ====='); console.log(JSON.stringify(result,null,2));
  const del=await api('DELETE',`/workflows/${id}`); console.log('cleanup '+id+': '+del.status);
})();

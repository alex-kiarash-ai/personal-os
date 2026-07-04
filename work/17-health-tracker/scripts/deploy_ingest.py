#!/usr/bin/env python3
"""
Build + deploy the "Alex Health - Ingest (17)" n8n workflow.
Webhook (X-Alex-Token) -> Code (Alex Sleep Score v1, one item/day) -> Data Table upsert(date) -> Respond.
Writes a JSON backup to config/wf-health-ingest.json, creates/updates the workflow, activates it.
No secrets printed.
"""
import os, json, urllib.request, urllib.error

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
KEY = open(os.path.join(REPO, "work", "03-application-engine", "config", "n8n-api-key.txt"), encoding="utf-8").read().strip()
BASE = "https://n8n.shaheenkiarash.com/api/v1"
TABLE_ID = open(os.path.join(REPO, "work", "17-health-tracker", "config", "table-id.txt"), encoding="utf-8").read().strip()
CRED_ID = "m6VkVeG9bym6OFID"   # "Alex HQ Token" header-auth (X-Alex-Token)
WF_NAME = "Alex Health - Ingest (17)"
BACKUP = os.path.join(REPO, "work", "17-health-tracker", "config", "wf-health-ingest.json")

# ---- the scoring + normalize node (mirror of backfill_health.py score(), 5-component v1) ----
JS_CODE = r"""
// Alex Sleep Score v1 (5 components; consistency = Phase 2, needs trailing history).
// Mirror of work/17-health-tracker/scripts/backfill_health.py -> keep in sync.
const CFG = {
  duration:    {w:35, band:[420,540], zero_below:300, taper_above:660, floor_above:0.30},
  efficiency:  {w:20, zero_at:0.75, full_at:0.90},
  deep_pct:    {w:15, band:[0.13,0.23], zero_below:0.05, taper_above:0.35, floor_above:0.75},
  rem_pct:     {w:15, band:[0.20,0.25], zero_below:0.10, taper_above:0.35, floor_above:0.80},
  restfulness: {w:10, free:1, penalty:1.5},
};
const num = v => (v === null || v === undefined || v === '') ? null : Number(v);
const clamp = (x, lo=0, hi=1) => Math.max(lo, Math.min(hi, x));
function plateau(x, c){ if(x==null) return null; const [lo,hi]=c.band;
  if(x>=lo && x<=hi) return c.w;
  if(x<lo) return c.w*clamp((x-c.zero_below)/(lo-c.zero_below));
  const frac=clamp((x-hi)/(c.taper_above-hi)); return c.w*(1-(1-c.floor_above)*frac); }
function ramp(x, c){ if(x==null) return null; return c.w*clamp((x-c.zero_at)/(c.full_at-c.zero_at)); }
function scoreNight(d){
  const asleep = num(d.asleep_min);
  if(!asleep || asleep<=0) return {score:null, eff:null};
  const deep=num(d.deep_min)||0, rem=num(d.rem_min)||0, inbed=num(d.inbed_min);
  let eff = (inbed && inbed>=asleep) ? asleep/inbed : (d.efficiency!=null ? num(d.efficiency) : null);
  const comp={};
  comp.duration    = plateau(asleep, CFG.duration);
  comp.efficiency  = eff!=null ? ramp(eff, CFG.efficiency) : null;
  comp.deep_pct    = plateau(deep/asleep, CFG.deep_pct);
  comp.rem_pct     = plateau(rem/asleep, CFG.rem_pct);
  const wakes = d.awakenings!=null ? num(d.awakenings) : null;
  comp.restfulness = wakes!=null ? Math.max(0, CFG.restfulness.w - Math.max(0, wakes-CFG.restfulness.free)*CFG.restfulness.penalty) : null;
  const keys = Object.keys(comp).filter(k => comp[k]!=null);
  const lw = keys.reduce((a,k)=>a+CFG[k].w, 0);
  if(lw===0) return {score:null, eff};
  const raw = keys.reduce((a,k)=>a+comp[k], 0);
  return {score: Math.round(raw/lw*100), eff: eff!=null ? Math.round(eff*1000)/1000 : null};
}

const body = $input.first().json.body ?? {};
let days;
if (Array.isArray(body)) days = body;
else if (Array.isArray(body.days)) days = body.days;
else if (body.day) days = [body.day];
else days = [body];

const now = new Date().toISOString();
const out = [];
for (const d of days) {
  if (!d || !d.date) throw new Error('each day needs a date');
  const {score, eff} = scoreNight(d);
  out.push({ json: {
    date: String(d.date),
    steps: num(d.steps),
    asleep_min: num(d.asleep_min),
    deep_min: num(d.deep_min),
    rem_min: num(d.rem_min),
    core_min: num(d.core_min),
    awake_min: num(d.awake_min),
    inbed_min: num(d.inbed_min),
    awakenings: d.awakenings!=null ? num(d.awakenings) : null,
    efficiency: eff,
    bedtime: d.bedtime != null ? String(d.bedtime) : null,
    waketime: d.waketime != null ? String(d.waketime) : null,
    bedtime_dev_min: num(d.bedtime_dev_min),
    sleep_score: score,
    source: d.source ? String(d.source) : 'phone',
    ts: d.ts ? new Date(d.ts).toISOString() : now
  }});
}
return out;
"""

WF = {
    "name": WF_NAME,
    "nodes": [
        {"id": "wh-h", "name": "Health Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2,
         "position": [0, 0],
         "parameters": {"httpMethod": "POST", "path": "alex-health-ingest", "authentication": "headerAuth",
                        "responseMode": "responseNode", "options": {}},
         "credentials": {"httpHeaderAuth": {"id": CRED_ID, "name": "Alex HQ Token"}}},
        {"id": "code-h", "name": "Score + Normalize", "type": "n8n-nodes-base.code", "typeVersion": 2,
         "position": [240, 0], "parameters": {"jsCode": JS_CODE}},
        {"id": "dt-h", "name": "Insert Health Row", "type": "n8n-nodes-base.dataTable", "typeVersion": 1,
         "position": [480, 0],
         "parameters": {"resource": "row", "operation": "insert",
                        "dataTableId": {"__rl": True, "value": TABLE_ID, "mode": "id", "cachedResultName": "alex_health"},
                        "columns": {"mappingMode": "autoMapInputData", "value": {}, "matchingColumns": [], "schema": []},
                        "options": {}}},
        {"id": "resp-h", "name": "Respond OK", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1,
         "position": [720, 0],
         "parameters": {"respondWith": "json", "responseBody": '{"ok": true, "count": {{ $json.length ? $json.length : 1 }}}', "options": {}}},
    ],
    "connections": {
        "Health Webhook": {"main": [[{"node": "Score + Normalize", "type": "main", "index": 0}]]},
        "Score + Normalize": {"main": [[{"node": "Insert Health Row", "type": "main", "index": 0}]]},
        "Insert Health Row": {"main": [[{"node": "Respond OK", "type": "main", "index": 0}]]},
    },
    "settings": {"executionOrder": "v1"},
}

def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, data=(json.dumps(body).encode() if body is not None else None), method=method)
    req.add_header("X-N8N-API-KEY", KEY); req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read().decode(); return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:500]
    except Exception as e:
        return 0, str(e)

def main():
    os.makedirs(os.path.dirname(BACKUP), exist_ok=True)
    with open(BACKUP, "w", encoding="utf-8") as f:
        json.dump(WF, f, indent=2)
    print("backup ->", BACKUP)

    # find existing by name
    st, d = api("GET", "/workflows?limit=250")
    existing = None
    for w in (d.get("data", []) if isinstance(d, dict) else []):
        if w.get("name") == WF_NAME:
            existing = w["id"]; break

    payload = {"name": WF["name"], "nodes": WF["nodes"], "connections": WF["connections"], "settings": WF["settings"]}
    if existing:
        st, d = api("PUT", f"/workflows/{existing}", payload)
        print(f"UPDATED {existing} -> HTTP {st}", str(d)[:150])
        wid = existing
    else:
        st, d = api("POST", "/workflows", payload)
        print(f"CREATE -> HTTP {st}", str(d)[:200])
        wid = d.get("id") if isinstance(d, dict) else None
    if not wid:
        print("no workflow id; aborting"); return
    st, d = api("POST", f"/workflows/{wid}/activate")
    print(f"ACTIVATE {wid} -> HTTP {st}", str(d)[:150])
    print("WEBHOOK: https://n8n.shaheenkiarash.com/webhook/alex-health-ingest")
    print("WORKFLOW_ID:", wid)

if __name__ == "__main__":
    main()

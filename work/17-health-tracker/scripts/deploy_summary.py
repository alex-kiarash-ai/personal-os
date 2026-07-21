#!/usr/bin/env python3
"""
Extend the LIVE "Alex HQ - Summary API (16)" workflow to also expose a `health` project
(steps_today + sleep_score_today, each with 14-day history) from alex_health.

Safe: backs up the current live workflow to config/wf-summary-backup-pre-health.json BEFORE
touching it. New data flow (avoids per-item fan-out):
  Webhook -> Get Health Rows -> Stash Health (collapse to 1 item) -> Get Metrics Rows -> Reduce -> Respond
Reduce keeps the metrics logic verbatim and appends the health block.
No secrets printed.
"""
import os, json, urllib.request, urllib.error

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
KEY = open(os.path.join(REPO, "work", "03-application-engine", "config", "n8n-api-key.txt"), encoding="utf-8").read().strip()
HTID = open(os.path.join(REPO, "work", "17-health-tracker", "config", "table-id.txt"), encoding="utf-8").read().strip()
METRICS_TID = "etzrOnviaxXQFPll"
BASE = "https://n8n.shaheenkiarash.com/api/v1"
WF_NAME = "Alex HQ - Summary API (16)"
BACKUP = os.path.join(REPO, "work", "16-alex-hq", "config", "wf-summary-backup-pre-health.json")
NEWCOPY = os.path.join(REPO, "work", "16-alex-hq", "config", "wf-summary.json")

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

STASH_JS = "return [{ json: { health: $input.all().map(i => i.json).filter(r => r.date) } }];"

REDUCE_JS = r"""
// ---- metrics (unchanged from the original) ----
const rows = $input.all().map(i => i.json).filter(r => r.project && r.metric_key);
rows.sort((a, b) => (String(a.ts) < String(b.ts) ? -1 : 1));
const latest = {}; const history = {};
for (const r of rows) {
  const k = r.project + ':' + r.metric_key;
  latest[k] = r;
  (history[k] = history[k] || []).push({ ts: r.ts, value_num: r.value_num ?? null });
}
const rank = { green: 0, amber: 1, red: 2 };
const projects = {};
for (const k of Object.keys(latest)) {
  const r = latest[k];
  const p = r.project;
  projects[p] = projects[p] || { project: p, metrics: {}, last_ts: null, status: 'green' };
  projects[p].metrics[r.metric_key] = {
    value_num: r.value_num ?? null, value_text: r.value_text || '', headline: r.headline || '',
    status: r.status || 'green', ts: r.ts, history: (history[k] || []).slice(-14)
  };
  if (!projects[p].last_ts || String(r.ts) > String(projects[p].last_ts)) projects[p].last_ts = r.ts;
  if ((rank[r.status] ?? 0) > (rank[projects[p].status] ?? 0)) projects[p].status = r.status;
}

// ---- health (alex_health via the Stash Health node) ----
// Merge by field per date (latest non-null wins) so partial rows coalesce:
// the phone can send yesterday's steps and last night's sleep as separate objects.
const hrows = ($('Stash Health').first().json.health || []).filter(r => r.date).filter(r => !/test/i.test(String(r.source || '')));  // drop synthetic *-test rows: never surface as real health (fix 2026-07-07)
hrows.sort((a, b) => (String(a.ts) < String(b.ts) ? -1 : 1));
const HFIELDS = ['steps','asleep_min','deep_min','rem_min','core_min','awake_min','inbed_min','awakenings','efficiency','sleep_score','bedtime','waketime'];
const byDate = {};
for (const r of hrows) {
  const d = r.date;
  const cur = byDate[d] || (byDate[d] = { date: d, ts: r.ts });
  for (const f of HFIELDS) if (r[f] != null) cur[f] = r[f];
  if (String(r.ts) > String(cur.ts)) cur.ts = r.ts;
}
const dates = Object.keys(byDate).sort();
const todayStr = new Date().toISOString().slice(0, 10);
// A PHANTOM reading = the iPhone Shortcut fired but HealthKit returned nothing (steps 0,
// sleep a handful of minutes -> the Score node still emits a fake ~38). Never surface a
// fabricated number off one: if the freshest reading is phantom, the tile says the phone
// sync is stalled (the actual truth, fixable only phone-side) and shows no score, keeping
// the real history behind it. If the freshest reading is real, behave as before.
// (2026-07-21 fix; the phone POSTs nightly but HealthKit has been empty since ~07-09.)
const MIN_REAL_SLEEP_MIN = 60;   // < 1h asleep for a whole night = no real HealthKit data
const isRealNight   = (r) => r.asleep_min != null && Number(r.asleep_min) >= MIN_REAL_SLEEP_MIN;
const isRealStepDay = (r) => r.steps != null && Number(r.steps) > 0;

// STEPS: completed days only (exclude today's partial); freshest complete day = "yesterday".
const realStepDates = dates.filter(d => d < todayStr && isRealStepDay(byDate[d]));
const anyStepDates  = dates.filter(d => d < todayStr && byDate[d].steps != null);
const stepSeries = realStepDates.map(d => ({ ts: d, value_num: Number(byDate[d].steps) }));
const lastRealStepDay = realStepDates.length ? realStepDates[realStepDates.length - 1] : null;
const freshStepDay    = anyStepDates.length  ? anyStepDates[anyStepDates.length - 1]   : null;

// SLEEP: keep today (wake-date today = last night, the freshest and wanted).
const realNightDates = dates.filter(d => isRealNight(byDate[d]) && byDate[d].sleep_score != null);
const anyNightDates  = dates.filter(d => byDate[d].sleep_score != null || byDate[d].asleep_min != null);
const scoreSeries = realNightDates.map(d => ({ ts: d, value_num: Number(byDate[d].sleep_score) }));
const lastRealNight = realNightDates.length ? realNightDates[realNightDates.length - 1] : null;
const freshNight    = anyNightDates.length  ? anyNightDates[anyNightDates.length - 1]   : null;

if (stepSeries.length || scoreSeries.length || freshStepDay || freshNight) {
  const hp = { project: 'health', metrics: {}, last_ts: null, status: 'green' };

  const stepsStalled = freshStepDay && (!lastRealStepDay || freshStepDay > lastRealStepDay);
  const todayHasSteps = byDate[todayStr] && isRealStepDay(byDate[todayStr]);
  if (lastRealStepDay && !stepsStalled) {
    // best case: the last COMPLETE real day, shown as "yesterday"
    const v = Number(byDate[lastRealStepDay].steps); const row = byDate[lastRealStepDay];
    const st = v >= 10000 ? 'green' : v >= 5000 ? 'amber' : 'red';
    hp.metrics.steps_today = { value_num: v, value_text: 'steps',
      headline: 'yesterday · ' + lastRealStepDay, status: st, ts: row.ts || lastRealStepDay, history: stepSeries.slice(-14) };
  } else if (todayHasSteps) {
    // no fresh COMPLETE day yet, but steps are flowing TODAY -> show "today so far" instead of a
    // misleading "stalled". Proves the sync is alive now; reverts to "yesterday" once today completes.
    const v = Number(byDate[todayStr].steps);
    hp.metrics.steps_today = { value_num: v, value_text: 'today so far',
      headline: 'today so far · ' + todayStr, status: 'green',
      ts: byDate[todayStr].ts, history: stepSeries.slice(-14) };
  } else if (freshStepDay) {
    // a completed day landed but empty, and nothing today either -> genuinely stalled
    hp.metrics.steps_today = { value_num: null, value_text: 'stalled',
      headline: 'phone sync stalled - no HealthKit steps' + (lastRealStepDay ? ' since ' + lastRealStepDay : ''),
      status: 'red', ts: byDate[freshStepDay].ts, history: stepSeries.slice(-14) };
  }

  const sleepStalled = freshNight && (!lastRealNight || freshNight > lastRealNight);
  if (sleepStalled) {
    hp.metrics.sleep_score_today = { value_num: null, value_text: 'stalled',
      headline: 'phone sync stalled - no HealthKit sleep' + (lastRealNight ? ' since ' + lastRealNight : ''),
      status: 'red', ts: byDate[freshNight].ts, history: scoreSeries.slice(-14) };
  } else if (lastRealNight) {
    const v = Number(byDate[lastRealNight].sleep_score); const row = byDate[lastRealNight];
    const hrs = row.asleep_min ? (Number(row.asleep_min) / 60).toFixed(1) + 'h' : '';
    const st = v >= 85 ? 'green' : v >= 70 ? 'amber' : 'red';
    hp.metrics.sleep_score_today = { value_num: v, value_text: '/ 100',
      headline: 'night of ' + lastRealNight + (hrs ? ' · ' + hrs : ''), status: st, ts: row.ts || lastRealNight, history: scoreSeries.slice(-14) };
  }

  for (const m of Object.values(hp.metrics)) {
    if (!hp.last_ts || String(m.ts) > String(hp.last_ts)) hp.last_ts = m.ts;
    if ((rank[m.status] ?? 0) > (rank[hp.status] ?? 0)) hp.status = m.status;
  }
  projects['health'] = hp;
}

return [{ json: { generated_at: new Date().toISOString(), row_count: rows.length, projects } }];
"""

def main():
    st, d = api("GET", "/workflows?limit=250")
    wid = None
    for w in (d.get("data", []) if isinstance(d, dict) else []):
        if w.get("name") == WF_NAME:
            wid = w["id"]; break
    if not wid:
        print("summary workflow not found"); return
    st, live = api("GET", f"/workflows/{wid}")
    with open(BACKUP, "w", encoding="utf-8") as f:
        json.dump(live, f, indent=2)
    print(f"backed up live workflow {wid} -> {BACKUP}")

    nodes = [
        {"id": "wh-2", "name": "Summary Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0],
         "parameters": {"httpMethod": "GET", "path": "alex-hq-summary", "authentication": "headerAuth",
                        "responseMode": "responseNode", "options": {}},
         "credentials": {"httpHeaderAuth": {"id": "m6VkVeG9bym6OFID", "name": "Alex HQ Token"}}},
        {"id": "dt-health", "name": "Get Health Rows", "type": "n8n-nodes-base.dataTable", "typeVersion": 1, "position": [220, 120],
         "parameters": {"resource": "row", "operation": "get",
                        "dataTableId": {"__rl": True, "value": HTID, "mode": "id", "cachedResultName": "alex_health"},
                        "returnAll": True, "filters": {"conditions": []}, "options": {}}},
        {"id": "code-stash", "name": "Stash Health", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [440, 120],
         "parameters": {"jsCode": STASH_JS}},
        {"id": "dt-2", "name": "Get All Rows", "type": "n8n-nodes-base.dataTable", "typeVersion": 1, "position": [660, 0],
         "parameters": {"resource": "row", "operation": "get",
                        "dataTableId": {"__rl": True, "value": METRICS_TID, "mode": "id", "cachedResultName": "alex_metrics"},
                        "returnAll": True, "filters": {"conditions": []}, "options": {}}},
        {"id": "code-2", "name": "Reduce To Summary", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [880, 0],
         "parameters": {"jsCode": REDUCE_JS}},
        {"id": "resp-2", "name": "Respond Summary", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1, "position": [1100, 0],
         "parameters": {"respondWith": "firstIncomingItem", "options": {}}},
    ]
    connections = {
        "Summary Webhook": {"main": [[{"node": "Get Health Rows", "type": "main", "index": 0}]]},
        "Get Health Rows": {"main": [[{"node": "Stash Health", "type": "main", "index": 0}]]},
        "Stash Health": {"main": [[{"node": "Get All Rows", "type": "main", "index": 0}]]},
        "Get All Rows": {"main": [[{"node": "Reduce To Summary", "type": "main", "index": 0}]]},
        "Reduce To Summary": {"main": [[{"node": "Respond Summary", "type": "main", "index": 0}]]},
    }
    payload = {"name": WF_NAME, "nodes": nodes, "connections": connections, "settings": live.get("settings", {"executionOrder": "v1"})}
    with open(NEWCOPY, "w", encoding="utf-8") as f:
        json.dump({"name": WF_NAME, "nodes": nodes, "connections": connections, "settings": payload["settings"]}, f, indent=2)

    st, d = api("PUT", f"/workflows/{wid}", payload)
    print(f"PUT summary -> HTTP {st}", str(d)[:120])
    st, d = api("POST", f"/workflows/{wid}/activate")
    print(f"ACTIVATE -> HTTP {st}")
    print("BACKUP kept at", BACKUP, "(restore with restore_summary if needed)")

if __name__ == "__main__":
    main()

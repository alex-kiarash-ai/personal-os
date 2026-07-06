#!/usr/bin/env python3
"""
n8n API helper for the Health Tracker build (native Windows Python, urllib only
so there is no MSYS/Windows path or curl-quirk to fight).

Reads the n8n API key from work/03-application-engine/config/n8n-api-key.txt.
Subcommands:
  list-tables                  list all data tables (id | name | project)
  ensure-table                 create alex_health if it does not exist; print its id
  seed <rows.json>             upsert rows (from backfill --emit-rows) via the rows API
No secrets are printed.
"""
import sys, os, json, urllib.request, urllib.error

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
KEY_FILE = os.path.join(REPO, "work", "03-application-engine", "config", "n8n-api-key.txt")
BASE = "https://n8n.shaheenkiarash.com/api/v1"
TABLE = "alex_health"

COLUMNS = [
    {"name": "date", "type": "string"},
    {"name": "steps", "type": "number"},
    {"name": "asleep_min", "type": "number"},
    {"name": "deep_min", "type": "number"},
    {"name": "rem_min", "type": "number"},
    {"name": "core_min", "type": "number"},
    {"name": "awake_min", "type": "number"},
    {"name": "inbed_min", "type": "number"},
    {"name": "awakenings", "type": "number"},
    {"name": "efficiency", "type": "number"},
    {"name": "bedtime", "type": "string"},
    {"name": "waketime", "type": "string"},
    {"name": "bedtime_dev_min", "type": "number"},
    {"name": "sleep_score", "type": "number"},
    {"name": "source", "type": "string"},
    {"name": "ts", "type": "string"},
]

def key():
    with open(KEY_FILE, encoding="utf-8") as f:
        return f.read().strip()

def api(method, path, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("X-N8N-API-KEY", key())
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            raw = r.read().decode()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:400]}
    except Exception as e:
        return 0, {"error": str(e)}

def list_tables():
    st, d = api("GET", "/data-tables")
    tables = d.get("data", []) if isinstance(d, dict) else []
    return tables

def find_table(name):
    for t in list_tables():
        if t.get("name") == name:
            return t
    return None

def cmd_list():
    for t in list_tables():
        print(t["id"], "|", t["name"], "| proj=", t.get("projectId"))

ID_FILE = os.path.join(os.path.dirname(__file__), "..", "config", "table-id.txt")

def _save_id(tid):
    with open(ID_FILE, "w", encoding="utf-8") as f:
        f.write(tid.strip() + "\n")

def cmd_ensure():
    existing = find_table(TABLE)
    if existing:
        print(f"EXISTS {existing['id']}"); _save_id(existing["id"])
        return existing["id"]
    proj = None
    for t in list_tables():
        if t.get("projectId"):
            proj = t["projectId"]; break
    body = {"name": TABLE, "columns": COLUMNS}
    # try project-scoped create first, then global
    attempts = []
    if proj:
        attempts.append(("POST", f"/projects/{proj}/data-tables", body))
    attempts.append(("POST", "/data-tables", dict(body, projectId=proj) if proj else body))
    for method, path, b in attempts:
        st, d = api(method, path, b)
        if st in (200, 201) and isinstance(d, dict) and d.get("id"):
            print(f"CREATED {d['id']} via {path}"); _save_id(d["id"])
            return d["id"]
        print(f"  attempt {method} {path} -> HTTP {st}: {json.dumps(d)[:200]}")
    print("FAILED to create table")
    return None

def cmd_seed(path):
    tid = (find_table(TABLE) or {}).get("id")
    if not tid:
        print("no alex_health table; run ensure-table first"); return
    days = json.load(open(path, encoding="utf-8")).get("days", [])
    ok = fail = 0
    for r in days:
        # rows API: insert one row (backfill = fresh table, so plain insert)
        row = {k: (v if v is not None else None) for k, v in r.items()}
        row.setdefault("source", "backfill")
        import datetime
        row.setdefault("ts", datetime.datetime.utcnow().isoformat() + "Z")
        st, d = api("POST", f"/data-tables/{tid}/insert", {"data": [row]})
        if st in (200, 201):
            ok += 1
        else:
            fail += 1
            if fail <= 3:
                print(f"  insert HTTP {st}: {json.dumps(d)[:200]}  (row {r.get('date')})")
    print(f"seed done: {ok} ok, {fail} failed, into {tid}")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list-tables"
    if cmd == "list-tables":
        cmd_list()
    elif cmd == "ensure-table":
        cmd_ensure()
    elif cmd == "seed":
        cmd_seed(sys.argv[2])
    else:
        print(__doc__)

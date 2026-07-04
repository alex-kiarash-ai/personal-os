#!/usr/bin/env python3
"""Seed the full backfill history through the live ingest webhook (n8n scores each night).
POSTs in chunks; tags rows source=backfill; verifies the final table. No secrets printed."""
import os, json, time, urllib.request, urllib.error

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
TOKEN = open(os.path.join(REPO, "work", "16-alex-hq", "config", "alex-hq-token.txt"), encoding="utf-8").read().strip()
NKEY = open(os.path.join(REPO, "work", "03-application-engine", "config", "n8n-api-key.txt"), encoding="utf-8").read().strip()
TID = open(os.path.join(REPO, "work", "17-health-tracker", "config", "table-id.txt"), encoding="utf-8").read().strip()
SEED = os.path.join(REPO, "vault", "projects", "health-tracker", "seed-rows.json")
WEBHOOK = "https://n8n.shaheenkiarash.com/webhook/alex-health-ingest"
API = "https://n8n.shaheenkiarash.com/api/v1"
CHUNK = 150

def post(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST")
    for k, v in headers.items():
        req.add_header(k, v)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, r.read().decode()[:120]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]
    except Exception as e:
        return 0, str(e)

def main():
    days = json.load(open(SEED, encoding="utf-8"))["days"]
    for d in days:
        d["source"] = "backfill"
    print(f"seeding {len(days)} days in chunks of {CHUNK} ...")
    ok = 0
    for i in range(0, len(days), CHUNK):
        chunk = days[i:i + CHUNK]
        st, body = post(WEBHOOK, {"days": chunk}, {"X-Alex-Token": TOKEN})
        print(f"  chunk {i//CHUNK+1}: rows {i}-{i+len(chunk)-1} -> HTTP {st} {body}")
        if st == 200:
            ok += len(chunk)
        else:
            print("  STOPPING on error"); break
        time.sleep(0.4)
    print(f"posted {ok}/{len(days)} rows")

    # verify
    req = urllib.request.Request(f"{API}/data-tables/{TID}/rows?limit=1", method="GET")
    req.add_header("X-N8N-API-KEY", NKEY)
    # count via full fetch (paged)
    total, cursor = 0, None
    scored = 0
    while True:
        url = f"{API}/data-tables/{TID}/rows?limit=200" + (f"&cursor={cursor}" if cursor else "")
        rq = urllib.request.Request(url, method="GET"); rq.add_header("X-N8N-API-KEY", NKEY)
        with urllib.request.urlopen(rq, timeout=60) as r:
            d = json.loads(r.read().decode())
        rows = d.get("data", [])
        total += len(rows)
        scored += sum(1 for x in rows if x.get("sleep_score") is not None)
        cursor = d.get("nextCursor")
        if not cursor:
            break
    print(f"TABLE now has {total} rows ({scored} with a sleep_score)")

if __name__ == "__main__":
    main()

#!/usr/bin/env python
# Item 2 (2026-07-20): the verdict step for the 15 July vault-read experiment.
# `_log_read` in vault_search.py writes one row per search to system/vault-reads.jsonl
# ({ts, query, results}); until now nothing consumed it, so the experiment would silently expire and
# answer nothing. This zero-token analyzer closes the loop: over a trailing window it reports whether
# the vault's RECALL path is actually exercised, and the zero-result rate (the primary signal).
#
# NOT a recovery C-check: the Monday sweep appends this one line to its human report, but it never
# becomes a drift item - a soft usage metric must not touch the checker's 0/2/1 drift semantics.
#
# Honest scope: `_log_read` fires only on `vault_search.py search` (the BM25 path). Reads by grep or by
# opening a file directly are invisible, so this measures the SEARCH path, not all reads. Stated in the
# output so it never overclaims. Below a data floor it reports "insufficient data", not a false verdict.
#
# The threshold + whether zero-result-rate or volume is the headline signal are Shaheen's open
# questions (story-upgrade plan Q1); until he sets manifest.meta.vault_read_min_per_week the floor is a
# labelled PROVISIONAL default. Exit 0 always (informational; never drives drift).
import json, sys, argparse, os
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
# Same env override vault_search.py's _log_read uses, so a test can point at a sandbox file.
READS = Path(os.environ.get("ALEX_READS_LOG", str(REPO / "system" / "vault-reads.jsonl")))
MANIFEST = REPO / "system" / "manifest.json"
DATA_FLOOR = 8          # need at least this many searches in the window before asserting a verdict
DEFAULT_MIN_PER_WEEK = 3.0

def load_threshold():
    try:
        meta = json.loads(MANIFEST.read_text(encoding="utf-8")).get("meta", {})
        v = meta.get("vault_read_min_per_week")
        if v is not None:
            return float(v), False   # (value, is_provisional)
    except Exception:
        pass
    return DEFAULT_MIN_PER_WEEK, True

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=60)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if not READS.exists():
        line = "vault-read health: no reads log yet (system/vault-reads.jsonl absent) [BM25 search path only]"
        print(json.dumps({"status": "no-log"}) if args.json else line)
        return 0

    cutoff = datetime.now() - timedelta(days=args.days)
    total = 0; zero = 0
    for ln in READS.read_text(encoding="utf-8", errors="replace").splitlines():
        ln = ln.strip()
        if not ln:
            continue
        try:
            r = json.loads(ln)
            ts = datetime.strptime(r["ts"][:19], "%Y-%m-%dT%H:%M:%S")
        except Exception:
            continue
        if ts < cutoff:
            continue
        total += 1
        if int(r.get("results", 0)) == 0:
            zero += 1

    per_week = round(total / (args.days / 7.0), 2) if args.days else 0
    zero_rate = round(zero / total * 100) if total else 0
    threshold, provisional = load_threshold()
    thr_label = f"{threshold}/wk" + (" provisional" if provisional else "")

    if total < DATA_FLOOR:
        verdict = f"insufficient data ({total} searches over {args.days}d, need >={DATA_FLOOR})"
        status = "insufficient"
    elif per_week >= threshold:
        verdict = f"recall path exercised ({per_week}/wk >= {thr_label})"
        status = "read"
    else:
        verdict = f"recall path UNDERUSED ({per_week}/wk < {thr_label}) - the vault is written more than searched"
        status = "underused"

    line = (f"vault-read health: {verdict}; {zero_rate}% of {total} searches returned nothing "
            f"(zero-result rate = the primary signal) [BM25 search path only, not grep/direct reads]")
    if args.json:
        print(json.dumps({"status": status, "window_days": args.days, "total": total,
                          "per_week": per_week, "zero_result_pct": zero_rate,
                          "threshold_per_week": threshold, "threshold_provisional": provisional}))
    else:
        print(line)
    return 0

if __name__ == "__main__":
    sys.exit(main())

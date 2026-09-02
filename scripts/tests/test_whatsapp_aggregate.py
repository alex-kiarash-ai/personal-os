#!/usr/bin/env python3
"""
Self-test for scripts/whatsapp-aggregate.py (#11 WhatsApp harvest).

Builds synthetic ChatStorage / ContactsV2 / CallHistory databases with known values,
runs the aggregator against them, and asserts every derived field.

Why this exists: the real databases live inside an ENCRYPTED iPhone backup, so the
parser cannot be exercised without Shaheen, his phone and the backup password. A
silent zero (schema drift after a WhatsApp update) would look identical to a healthy
run. This test makes the parser falsifiable at any time, on any machine, offline.

Run:  python scripts/tests/test_whatsapp_aggregate.py
Exit: 0 all passed, 1 a failure.
"""

import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
AGGREGATOR = os.path.join(REPO, "scripts", "whatsapp-aggregate.py")
APPLE_EPOCH_OFFSET = 978307200
AS_OF = "2026-09-02"

FAILURES = []


def check(label, actual, expected):
    if actual == expected:
        print(f"  PASS  {label:28s} {actual}")
    else:
        print(f"  FAIL  {label:28s} got {actual!r}, expected {expected!r}")
        FAILURES.append(label)


def ats(stamp):
    """'YYYY-MM-DD HH:MM:SS' UTC -> Core Data seconds."""
    dt = datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    return dt.timestamp() - APPLE_EPOCH_OFFSET


def build_fixtures(d):
    con = sqlite3.connect(os.path.join(d, "ChatStorage.sqlite"))
    con.execute("""CREATE TABLE ZWACHATSESSION (Z_PK INTEGER PRIMARY KEY, ZCONTACTJID TEXT,
                   ZPARTNERNAME TEXT, ZSESSIONTYPE INTEGER, ZARCHIVED INTEGER,
                   ZLASTMESSAGEDATE REAL)""")
    con.execute("""CREATE TABLE ZWAMESSAGE (Z_PK INTEGER PRIMARY KEY, ZCHATSESSION INTEGER,
                   ZISFROMME INTEGER, ZMESSAGEDATE REAL, ZTEXT TEXT, ZMESSAGETYPE INTEGER)""")
    con.executemany("INSERT INTO ZWACHATSESSION VALUES (?,?,?,?,?,?)", [
        (1, "1000001@s.whatsapp.net", "Chat-List Name", 0, 0, ats("2026-09-01 10:05:00")),
        (2, "123-456@g.us", "A Group", 1, 0, ats("2025-01-01 10:00:00")),
        (3, "1000002@s.whatsapp.net", "Silent Contact", 0, 0, None),  # zero messages
    ])
    con.executemany("INSERT INTO ZWAMESSAGE VALUES (?,?,?,?,?,?)", [
        (1, 1, 0, ats("2026-01-01 09:00:00"), "inside 12 months but not 8 weeks", 0),
        (2, 1, 0, ats("2026-08-25 12:00:00"), None, 3),                      # voice note
        (3, 1, 0, ats("2026-09-01 10:00:00"), "are we still on for friday", 0),
        (4, 1, 1, ats("2026-09-01 10:05:00"), "yes lets do friday", 0),      # reply +300s
        (5, 2, 1, ats("2025-01-01 09:00:00"), "old group msg", 0),
        (6, 2, 0, ats("2025-01-01 10:00:00"), "another old one", 0),
        (7, 1, 1, None, "null date, must be skipped", 0),
    ])
    con.commit()
    con.close()

    con = sqlite3.connect(os.path.join(d, "ContactsV2.sqlite"))
    con.execute("""CREATE TABLE ZWAADDRESSBOOKCONTACT (Z_PK INTEGER PRIMARY KEY,
                   ZWHATSAPPID TEXT, ZFULLNAME TEXT, ZGIVENNAME TEXT,
                   ZFAMILYNAME TEXT, ZPHONENUMBER TEXT)""")
    con.execute("INSERT INTO ZWAADDRESSBOOKCONTACT VALUES "
                "(1,'1000001@s.whatsapp.net','Saved Real Name','Saved','Real Name','+1000001')")
    con.commit()
    con.close()

    con = sqlite3.connect(os.path.join(d, "CallHistory.sqlite"))
    con.execute("""CREATE TABLE ZWACDCALLEVENT (Z_PK INTEGER PRIMARY KEY, ZDATE REAL,
                   ZCONTACTJID TEXT, ZOUTGOING INTEGER)""")
    con.executemany("INSERT INTO ZWACDCALLEVENT VALUES (?,?,?,?)", [
        (1, ats("2026-08-30 20:00:00"), "1000001@s.whatsapp.net", 1),
        (2, ats("2026-06-30 20:00:00"), "1000001@s.whatsapp.net", 0),
        (3, ats("2024-06-30 20:00:00"), "1000001@s.whatsapp.net", 1),  # outside 12m
    ])
    con.commit()
    con.close()


def main():
    if not os.path.exists(AGGREGATOR):
        print(f"FATAL: aggregator not found at {AGGREGATOR}")
        return 1

    tmp = tempfile.mkdtemp(prefix="wa-aggregate-test-")
    try:
        build_fixtures(tmp)
        out = os.path.join(tmp, "stats.json")
        proc = subprocess.run(
            [sys.executable, AGGREGATOR, "--skip-extract", "--extract-dir", tmp,
             "--out", out, "--as-of", AS_OF],
            capture_output=True, text=True)
        if proc.returncode != 0:
            print("FATAL: aggregator exited", proc.returncode)
            print(proc.stderr)
            return 1

        data = json.load(open(out, encoding="utf-8"))
        t = data["totals"]
        by_jid = {c["jid"]: c for c in data["chats"]}

        print("\nTotals")
        check("chats (silent one dropped)", t["chats"], 2)
        check("messages (null date skipped)", t["messages"], 6)
        check("active_12m", t["active_12m"], 1)
        check("active_8w", t["active_8w"], 1)
        check("one_to_one", t["one_to_one"], 1)
        check("groups", t["groups"], 1)
        check("saved_contact_names", t["saved_contact_names"], 1)
        check("voice_notes_8w", t["voice_notes_8w"], 1)

        print("\n1:1 chat")
        one = by_jid["1000001@s.whatsapp.net"]
        # The whole point of reading ContactsV2: the address book beats the chat-list label.
        check("saved name wins", one["saved_contact_name"], "Saved Real Name")
        check("chat-list name kept too", one["display_name"], "Chat-List Name")
        check("phone from jid", one["phone"], "+1000001")
        check("is_group", one["is_group"], False)
        check("msgs_total", one["msgs_total"], 4)
        check("msgs_12m", one["msgs_12m"], 4)
        check("msgs_8w", one["msgs_8w"], 3)
        check("from_me", one["from_me"], 1)
        check("from_them", one["from_them"], 3)
        check("first_msg", one["first_msg"], "2026-01-01")
        check("last_msg", one["last_msg"], "2026-09-01")
        check("last_sender", one["last_sender"], "me")
        check("median_reply_secs", one["median_reply_secs"], 300)
        check("voice_notes", one["voice_notes"], 1)
        check("voice_notes_8w", one["voice_notes_8w"], 1)
        check("calls total", one["calls"], 3)
        check("calls_12m (old excluded)", one["calls_12m"], 2)
        check("last_call", one["last_call"], "2026-08-30")
        check("language", one["language"], "en")

        print("\nGroup chat")
        grp = by_jid["123-456@g.us"]
        check("is_group", grp["is_group"], True)
        check("msgs_total", grp["msgs_total"], 2)
        check("msgs_12m (all stale)", grp["msgs_12m"], 0)
        check("no phone for group", grp["phone"], None)
        check("no reply latency", grp["median_reply_secs"], None)

        print()
        if FAILURES:
            print(f"FAILED: {len(FAILURES)} check(s): {', '.join(FAILURES)}")
            return 1
        print("All checks passed.")
        return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())

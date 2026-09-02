#!/usr/bin/env python3
"""
WhatsApp harvest (#11) - deterministic per-chat aggregator.

Reads an ENCRYPTED iOS backup, extracts only the three WhatsApp sqlite databases
(never media), and emits one aggregate row per chat. Zero model tokens.

Why this exists: harvest run 1 (2026-07-10) was done ad-hoc in-session and left no
script, so run 2 would have rebuilt the whole pipeline from scratch. This is the
tiering layer that makes reading every chat affordable, and it makes the monthly
re-sync a repeatable job.

Why not wtsexporter: its own --help says "-c, --move-media  Move the media directory
to output directory if the flag is set, otherwise copy it". There is no skip. Run 1
extracted 8.66 GB of media that then had to be deleted. Pulling only the sqlite files
honours the NO MEDIA hard rule by construction instead of by cleanup.

PRIVACY: this file lives in a PUBLIC repo. It must never contain a phone number, a
name, or a personal path. Every location is an argument. Its OUTPUT carries personal
data and must land on a gitignored path.

Usage:
  python scripts/whatsapp-aggregate.py --backup "<UDID folder>" --out system/whatsapp-chat-stats.json
  python scripts/whatsapp-aggregate.py --extract-dir <dir> --skip-extract --out <file>

Password: prompted, or via the WA_BACKUP_PASSWORD env var. Never logged, never written.
"""

import argparse
import json
import os
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

APPLE_EPOCH_OFFSET = 978307200  # seconds between 1970-01-01 and 2001-01-01

WA_DBS = {
    "messages": "ChatStorage.sqlite",
    "contacts": "ContactsV2.sqlite",
    "calls": "CallHistory.sqlite",
}


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def apple_ts(value):
    """Core Data timestamp -> aware UTC datetime. Tolerates None and ms-scaled values."""
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v <= 0:
        return None
    # Some builds store milliseconds; anything this large is not a 2001-epoch second count.
    if v > 1e11:
        v /= 1000.0
    try:
        return datetime.fromtimestamp(v + APPLE_EPOCH_OFFSET, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def iso(dt):
    return dt.date().isoformat() if dt else None


# ---------------------------------------------------------------- extraction

def extract_databases(backup_path, extract_dir, password):
    """Pull ONLY the WhatsApp sqlite files out of the encrypted backup. No media, ever."""
    try:
        from iphone_backup_decrypt import EncryptedBackup, RelativePath
        try:
            from iphone_backup_decrypt import DomainLike
        except ImportError:
            DomainLike = None
    except ImportError:
        log("FATAL: iphone_backup_decrypt not installed. pip install iphone_backup_decrypt")
        sys.exit(2)

    os.makedirs(extract_dir, exist_ok=True)
    log(f"Opening encrypted backup: {backup_path}")
    backup = EncryptedBackup(backup_directory=backup_path, passphrase=password)

    domain = getattr(DomainLike, "WHATSAPP", "%net.whatsapp.%") if DomainLike else "%net.whatsapp.%"
    wanted = {
        "messages": getattr(RelativePath, "WHATSAPP_MESSAGES", "ChatStorage.sqlite"),
        "contacts": getattr(RelativePath, "WHATSAPP_CONTACTS", "ContactsV2.sqlite"),
        "calls": getattr(RelativePath, "WHATSAPP_CALLS", "CallHistory.sqlite"),
    }

    found = {}
    for key, relpath in wanted.items():
        dest = os.path.join(extract_dir, WA_DBS[key])
        try:
            backup.extract_file(relative_path=relpath, output_filename=dest)
            size = os.path.getsize(dest)
            found[key] = dest
            log(f"  extracted {WA_DBS[key]:24s} {size/1e6:9.1f} MB")
        except Exception as exc:  # a missing optional DB must not kill the run
            if key == "messages":
                log(f"FATAL: could not extract {relpath}: {exc}")
                log("Likely causes: wrong password, an unencrypted backup (which contains NO")
                log("WhatsApp data at all), or Advanced Data Protection / end-to-end backup.")
                sys.exit(2)
            log(f"  SKIP {WA_DBS[key]}: not in backup ({type(exc).__name__})")

        # SQLite WAL sidecars. Uncheckpointed writes live in -wal, so the NEWEST
        # messages can be missing entirely if it is not extracted alongside the db.
        # That is silent data loss: the run looks clean and simply does not know
        # about the last few days. sqlite replays the wal automatically on open.
        for suffix in ("-wal", "-shm"):
            side_dest = dest + suffix
            try:
                backup.extract_file(relative_path=relpath + suffix,
                                    domain_like=domain,
                                    output_filename=side_dest)
                log(f"    + sidecar {os.path.basename(side_dest):22s} "
                    f"{os.path.getsize(side_dest)/1e6:7.1f} MB")
            except Exception:
                pass  # absent sidecar = already checkpointed, which is normal
    return found


# ---------------------------------------------------------------- backup preflight

def read_backup_plists(backup_path):
    """Status.plist + Manifest.plist. Both are binary plists; plistlib handles them."""
    import plistlib
    out = {}
    for name in ("Status.plist", "Manifest.plist"):
        fp = os.path.join(backup_path, name)
        if not os.path.exists(fp):
            return None, f"{name} missing from {backup_path}"
        try:
            with open(fp, "rb") as fh:
                out[name] = plistlib.load(fh)
        except Exception as exc:
            return None, f"could not parse {name}: {exc}"
    return out, None


def verify_backup(backup_path, password, max_age_hours=24):
    """
    Pre-flight before anything long-running. Returns 0 ok, 2 stop.

    The staleness check is the whole reason harvest run 2 exists: the backup on
    disk was 54 days old and nothing in the documented method would have noticed.
    A stale snapshot parses perfectly and reports a fresh harvest.
    """
    plists, err = read_backup_plists(backup_path)
    if err:
        log(f"FAIL  {err}")
        return 2

    status = plists["Status.plist"]
    manifest = plists["Manifest.plist"]
    snapshot = status.get("SnapshotState")
    date = status.get("Date")
    encrypted = manifest.get("IsEncrypted")
    ok = True

    log(f"  SnapshotState  {snapshot}")
    log(f"  Date           {date}")
    log(f"  IsFullBackup   {status.get('IsFullBackup')}   (False is normal for an incremental)")
    log(f"  IsEncrypted    {encrypted}")
    log(f"  ProductVersion {manifest.get('Lockdown', {}).get('ProductVersion')}")

    if snapshot != "finished":
        log(f"FAIL  snapshot is '{snapshot}', not 'finished'. The backup is mid-flight.")
        ok = False
    if not encrypted:
        log("FAIL  backup is NOT encrypted. Unencrypted iOS backups contain NO WhatsApp data.")
        log("      Turn on 'Encrypt local backup' in Apple Devices and back up again.")
        ok = False
    if date is not None:
        age_h = (datetime.now(timezone.utc) - date.replace(tzinfo=timezone.utc)).total_seconds() / 3600
        log(f"  age            {age_h/24:.1f} days")
        if age_h > max_age_hours:
            log(f"FAIL  backup is {age_h/24:.1f} days old. Back Up Now first, then re-run.")
            log("      Parsing a stale snapshot while reporting a fresh harvest is the")
            log("      exact failure this check exists to prevent.")
            ok = False
    else:
        log("FAIL  Status.plist carries no Date")
        ok = False

    mdb = os.path.join(backup_path, "Manifest.db")
    if os.path.exists(mdb):
        log(f"  Manifest.db    {datetime.fromtimestamp(os.path.getmtime(mdb)):%Y-%m-%d %H:%M} "
            f"({os.path.getsize(mdb)/1e6:.0f} MB)")
    else:
        log("FAIL  Manifest.db missing")
        ok = False

    if password:
        try:
            from iphone_backup_decrypt import EncryptedBackup
            b = EncryptedBackup(backup_directory=backup_path, passphrase=password)
            if b.test_decryption():
                log("  password       OK")
            else:
                log("FAIL  password rejected by the backup keybag.")
                ok = False
        except Exception as exc:
            log(f"FAIL  password test raised {type(exc).__name__}: {exc}")
            ok = False

    log("")
    log("VERDICT: PASS - safe to extract" if ok else "VERDICT: STOP - do not extract")
    return 0 if ok else 2


# ---------------------------------------------------------------- schema helpers

def table_exists(cur, name):
    cur.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,))
    return cur.fetchone() is not None


def columns(cur, table):
    try:
        cur.execute(f'PRAGMA table_info("{table}")')
        return {r[1] for r in cur.fetchall()}
    except Exception:
        return set()


def pick(available, *candidates):
    """First candidate column that actually exists, else None."""
    for c in candidates:
        if c in available:
            return c
    return None


def find_table(cur, *candidates):
    for t in candidates:
        if table_exists(cur, t):
            return t
    return None


# ---------------------------------------------------------------- language guess

def guess_language(samples):
    """Cheap deterministic script/language guess over the owner's own outgoing text."""
    arabic = latin = 0
    swedish_hits = 0
    sv_markers = (" och ", " att ", " jag ", " inte ", " det ", " som ", " har ", " tack",
                  " hej", " vi ", " du ", " kan ", " ska ", " med ")
    for s in samples:
        if not s:
            continue
        for ch in s:
            o = ord(ch)
            if 0x0600 <= o <= 0x06FF or 0x0750 <= o <= 0x077F or 0xFB50 <= o <= 0xFDFF:
                arabic += 1
            elif ch.isalpha() and o < 0x250:
                latin += 1
        low = " " + s.lower() + " "
        if any(m in low for m in sv_markers) or any(c in low for c in "åäö"):
            swedish_hits += 1
    total = arabic + latin
    if total == 0:
        return "unknown"
    ar_share = arabic / total
    if ar_share > 0.60:
        return "ar"
    if ar_share > 0.15:
        return "ar+en"  # heavy code-switching, his documented register
    if swedish_hits >= max(2, len(samples) * 0.15):
        return "sv"
    return "en"


# ---------------------------------------------------------------- messages DB

def parse_messages(db_path, now, window_12m, window_8w):
    import sqlite3
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.text_factory = lambda b: b.decode("utf-8", "replace")
    cur = con.cursor()

    sess_t = find_table(cur, "ZWACHATSESSION")
    msg_t = find_table(cur, "ZWAMESSAGE")
    if not sess_t or not msg_t:
        log(f"FATAL: expected tables missing in {os.path.basename(db_path)} "
            f"(session={sess_t}, message={msg_t})")
        sys.exit(2)

    sc = columns(cur, sess_t)
    mc = columns(cur, msg_t)

    c_jid = pick(sc, "ZCONTACTJID", "ZJID")
    c_name = pick(sc, "ZPARTNERNAME", "ZDISPLAYNAME")
    c_stype = pick(sc, "ZSESSIONTYPE")
    c_arch = pick(sc, "ZARCHIVED")

    m_sess = pick(mc, "ZCHATSESSION")
    m_from_me = pick(mc, "ZISFROMME")
    m_date = pick(mc, "ZMESSAGEDATE", "ZSENTDATE")
    m_text = pick(mc, "ZTEXT")
    m_type = pick(mc, "ZMESSAGETYPE")
    if not (m_sess and m_from_me and m_date):
        log(f"FATAL: {msg_t} missing required columns "
            f"(session={m_sess}, fromMe={m_from_me}, date={m_date})")
        sys.exit(2)

    # --- sessions
    sel = ["Z_PK"] + [c for c in (c_jid, c_name, c_stype, c_arch) if c]
    cur.execute(f'SELECT {",".join(sel)} FROM "{sess_t}"')
    chats = {}
    for row in cur.fetchall():
        rec = dict(zip(sel, row))
        pk = rec["Z_PK"]
        jid = rec.get(c_jid) or ""
        chats[pk] = {
            "chat_pk": pk,
            "jid": jid,
            "display_name": rec.get(c_name) or "",
            "is_group": jid.endswith("@g.us") or (rec.get(c_stype) == 1),
            "archived": bool(rec.get(c_arch)),
        }
    log(f"  sessions: {len(chats)}")

    # --- messages, one ordered pass per chat
    agg = defaultdict(lambda: {
        "total": 0, "m12": 0, "m8w": 0, "from_me": 0, "from_them": 0,
        "first": None, "last": None, "last_from_me": None,
        "voice_notes": 0, "voice_notes_8w": 0, "media_msgs": 0,
        "my_text_samples": [], "latencies": [],
    })

    cols = [m_sess, m_from_me, m_date] + [c for c in (m_text, m_type) if c]
    cur.execute(f'SELECT {",".join(cols)} FROM "{msg_t}" ORDER BY {m_sess}, {m_date}')

    prev_chat = None
    prev_dt = None
    prev_from_me = None
    total_msgs = 0

    for row in cur:
        rec = dict(zip(cols, row))
        pk = rec[m_sess]
        if pk is None:
            continue
        dt = apple_ts(rec[m_date])
        if dt is None:
            continue
        total_msgs += 1
        a = agg[pk]
        from_me = bool(rec[m_from_me])
        mtype = rec.get(m_type) if m_type else None
        text = rec.get(m_text) if m_text else None

        a["total"] += 1
        if dt >= window_12m:
            a["m12"] += 1
        if dt >= window_8w:
            a["m8w"] += 1
        if from_me:
            a["from_me"] += 1
            if text and len(a["my_text_samples"]) < 40 and dt >= window_12m:
                a["my_text_samples"].append(text)
        else:
            a["from_them"] += 1

        if mtype == 3:  # audio / voice note
            a["voice_notes"] += 1
            if dt >= window_8w:
                a["voice_notes_8w"] += 1
        elif mtype in (1, 2, 5, 8, 15):
            a["media_msgs"] += 1

        if a["first"] is None or dt < a["first"]:
            a["first"] = dt
        if a["last"] is None or dt >= a["last"]:
            a["last"] = dt
            a["last_from_me"] = from_me

        # reply latency: their message -> my next message, same chat
        if pk == prev_chat and prev_from_me is False and from_me and prev_dt:
            delta = (dt - prev_dt).total_seconds()
            if 0 < delta < 7 * 86400:
                a["latencies"].append(delta)
        prev_chat, prev_dt, prev_from_me = pk, dt, from_me

    log(f"  messages: {total_msgs}")
    con.close()
    return chats, agg, total_msgs


# ---------------------------------------------------------------- contacts DB

def parse_contacts(db_path):
    """jid -> saved address-book name. This is the phone-to-person map the vault lacks."""
    import sqlite3
    out = {}
    if not db_path or not os.path.exists(db_path):
        return out
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.text_factory = lambda b: b.decode("utf-8", "replace")
    cur = con.cursor()
    t = find_table(cur, "ZWAADDRESSBOOKCONTACT", "ZWACONTACT")
    if not t:
        log("  contacts: no address-book table found")
        con.close()
        return out
    cc = columns(cur, t)
    c_jid = pick(cc, "ZWHATSAPPID", "ZJID", "Zid")
    c_full = pick(cc, "ZFULLNAME", "ZDISPLAYNAME")
    c_given = pick(cc, "ZGIVENNAME")
    c_family = pick(cc, "ZFAMILYNAME")
    c_phone = pick(cc, "ZPHONENUMBER", "ZNORMALIZEDPHONE")
    if not c_jid:
        log(f"  contacts: {t} has no jid column")
        con.close()
        return out
    sel = [c for c in (c_jid, c_full, c_given, c_family, c_phone) if c]
    cur.execute(f'SELECT {",".join(sel)} FROM "{t}"')
    for row in cur.fetchall():
        rec = dict(zip(sel, row))
        jid = rec.get(c_jid)
        if not jid:
            continue
        name = (rec.get(c_full) or "").strip()
        if not name:
            name = " ".join(x for x in (rec.get(c_given), rec.get(c_family)) if x).strip()
        if name:
            out.setdefault(str(jid), {"saved_name": name, "phone": rec.get(c_phone)})
    log(f"  contacts: {len(out)} saved names")
    con.close()
    return out


# ---------------------------------------------------------------- calls DB

def parse_calls(db_path, now):
    """jid -> call counts. Who he actually calls is a stronger closeness signal than volume."""
    import sqlite3
    out = defaultdict(lambda: {"calls": 0, "calls_12m": 0, "last_call": None, "outgoing": 0})
    if not db_path or not os.path.exists(db_path):
        return out
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    con.text_factory = lambda b: b.decode("utf-8", "replace")
    cur = con.cursor()
    t = find_table(cur, "ZWACDCALLEVENT", "ZWACALLEVENT")
    if not t:
        log("  calls: no call-event table found")
        con.close()
        return out
    cc = columns(cur, t)
    c_date = pick(cc, "ZDATE", "ZCALLDATE")
    c_jid = pick(cc, "ZimeiJid", "ZCONTACTJID", "ZCALLERJID", "ZPEERJID",
                 "ZGROUPCALLCREATORUSERJIDSTRING", "ZJID")
    c_out = pick(cc, "ZOUTGOING", "ZISOUTGOING")
    if not c_date or not c_jid:
        log(f"  calls: {t} lacks usable date/jid columns (date={c_date}, jid={c_jid})")
        con.close()
        return out
    sel = [c for c in (c_date, c_jid, c_out) if c]
    cur.execute(f'SELECT {",".join(sel)} FROM "{t}"')
    twelve = now - timedelta(days=365)
    n = 0
    for row in cur.fetchall():
        rec = dict(zip(sel, row))
        jid = rec.get(c_jid)
        dt = apple_ts(rec.get(c_date))
        if not jid or dt is None:
            continue
        n += 1
        e = out[str(jid)]
        e["calls"] += 1
        if dt >= twelve:
            e["calls_12m"] += 1
        if c_out and rec.get(c_out):
            e["outgoing"] += 1
        if e["last_call"] is None or dt > e["last_call"]:
            e["last_call"] = dt
    log(f"  calls: {n} events across {len(out)} peers")
    con.close()
    return out


# ---------------------------------------------------------------- assembly

def build_rows(chats, agg, contacts, calls, now, window_12m, window_8w):
    rows = []
    for pk, meta in chats.items():
        a = agg.get(pk)
        if not a or a["total"] == 0:
            continue
        jid = meta["jid"]
        contact = contacts.get(jid, {})
        call = calls.get(jid, {})
        lat = a["latencies"]
        phone = None
        if jid and "@" in jid and not meta["is_group"]:
            local = jid.split("@", 1)[0]
            if local.isdigit():
                phone = "+" + local
        rows.append({
            "chat_pk": pk,
            "jid": jid,
            "display_name": meta["display_name"],
            "saved_contact_name": contact.get("saved_name"),
            "phone": phone or contact.get("phone"),
            "is_group": meta["is_group"],
            "archived": meta["archived"],
            "msgs_total": a["total"],
            "msgs_12m": a["m12"],
            "msgs_8w": a["m8w"],
            "from_me": a["from_me"],
            "from_them": a["from_them"],
            "first_msg": iso(a["first"]),
            "last_msg": iso(a["last"]),
            "last_sender": ("me" if a["last_from_me"] else "them") if a["last_from_me"] is not None else None,
            "days_since_last": (now - a["last"]).days if a["last"] else None,
            "median_reply_secs": int(statistics.median(lat)) if lat else None,
            "voice_notes": a["voice_notes"],
            "voice_notes_8w": a["voice_notes_8w"],
            "media_msgs": a["media_msgs"],
            "calls": call.get("calls", 0),
            "calls_12m": call.get("calls_12m", 0),
            "last_call": iso(call.get("last_call")),
            "language": guess_language(a["my_text_samples"]),
        })
    rows.sort(key=lambda r: (-r["msgs_12m"], -r["msgs_total"]))
    return rows


def main():
    ap = argparse.ArgumentParser(description="WhatsApp per-chat aggregator (harvest #11)")
    ap.add_argument("--backup", help="iOS backup UDID folder (encrypted)")
    ap.add_argument("--extract-dir", default="outputs/whatsapp-harvest/_db",
                    help="where the three sqlite files land (must be gitignored)")
    ap.add_argument("--out", help="output JSON path (must be gitignored)")
    ap.add_argument("--skip-extract", action="store_true",
                    help="reuse databases already in --extract-dir")
    ap.add_argument("--as-of", help="YYYY-MM-DD, defaults to today (UTC)")
    ap.add_argument("--verify-backup", action="store_true",
                    help="preflight only: plists + password test, then exit. Extracts nothing.")
    ap.add_argument("--password-only", action="store_true",
                    help="test ONLY the encryption password; skip the freshness check. "
                         "Run this BEFORE making a new backup: if the password is gone the "
                         "whole day changes shape, and finding out after a 40-minute backup "
                         "is the worst ordering.")
    ap.add_argument("--no-password-test", action="store_true",
                    help="skip the decryption test (plist checks only, never prompts)")
    ap.add_argument("--max-age-hours", type=float, default=24.0,
                    help="fail the freshness check above this age (default 24)")
    args = ap.parse_args()

    if args.verify_backup:
        if not args.backup:
            log("FATAL: --verify-backup needs --backup")
            sys.exit(2)
        if args.no_password_test:
            pw = ""
        elif "WA_BACKUP_PASSWORD" in os.environ:
            pw = os.environ["WA_BACKUP_PASSWORD"]  # deliberately set, empty means skip
        else:
            import getpass
            try:
                pw = getpass.getpass("iPhone backup encryption password (blank to skip test): ")
            except Exception:
                pw = ""
        max_age = float('inf') if args.password_only else args.max_age_hours
        sys.exit(verify_backup(args.backup, pw, max_age))

    if not args.out:
        log("FATAL: --out is required")
        sys.exit(2)

    now = (datetime.strptime(args.as_of, "%Y-%m-%d").replace(tzinfo=timezone.utc)
           if args.as_of else datetime.now(timezone.utc))
    window_12m = now - timedelta(days=365)
    window_8w = now - timedelta(days=56)

    if args.skip_extract:
        found = {k: os.path.join(args.extract_dir, v) for k, v in WA_DBS.items()
                 if os.path.exists(os.path.join(args.extract_dir, v))}
        if "messages" not in found:
            log(f"FATAL: {WA_DBS['messages']} not found in {args.extract_dir}")
            sys.exit(2)
        log(f"Reusing {len(found)} database(s) from {args.extract_dir}")
    else:
        if not args.backup:
            log("FATAL: --backup is required unless --skip-extract is given")
            sys.exit(2)
        if not os.path.isdir(args.backup):
            log(f"FATAL: backup folder not found: {args.backup}")
            sys.exit(2)
        password = os.environ.get("WA_BACKUP_PASSWORD")
        if not password:
            import getpass
            password = getpass.getpass("iPhone backup encryption password: ")
        if not password:
            log("FATAL: no password given; the WhatsApp DB only exists in an ENCRYPTED backup")
            sys.exit(2)
        found = extract_databases(args.backup, args.extract_dir, password)
        del password

    log("Parsing messages...")
    chats, agg, total_msgs = parse_messages(found["messages"], now, window_12m, window_8w)
    log("Parsing contacts...")
    contacts = parse_contacts(found.get("contacts"))
    log("Parsing calls...")
    calls = parse_calls(found.get("calls"), now)

    rows = build_rows(chats, agg, contacts, calls, now, window_12m, window_8w)

    active_12m = sum(1 for r in rows if r["msgs_12m"] > 0)
    active_8w = sum(1 for r in rows if r["msgs_8w"] > 0)
    people = [r for r in rows if not r["is_group"]]
    payload = {
        "generated": now.isoformat(),
        "source_backup": os.path.abspath(args.backup) if args.backup else None,
        "totals": {
            "chats": len(rows),
            "messages": total_msgs,
            "active_12m": active_12m,
            "active_8w": active_8w,
            "one_to_one": len(people),
            "groups": len(rows) - len(people),
            "saved_contact_names": len(contacts),
            "voice_notes_8w": sum(r["voice_notes_8w"] for r in rows),
        },
        "chats": rows,
    }

    os.makedirs(os.path.dirname(os.path.abspath(args.out)) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=1)

    t = payload["totals"]
    log("")
    log(f"  chats {t['chats']}  messages {t['messages']}")
    log(f"  active 12m {t['active_12m']}   active 8w {t['active_8w']}")
    log(f"  1:1 {t['one_to_one']}   groups {t['groups']}   saved names {t['saved_contact_names']}")
    log(f"  voice notes in last 8w: {t['voice_notes_8w']}")
    log(f"  -> {args.out}")


if __name__ == "__main__":
    main()

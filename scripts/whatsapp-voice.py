#!/usr/bin/env python3
"""
WhatsApp harvest (#11) - voice-note transcription, local and disposable.

Shaheen opted in on 2026-09-02, reversing the old "voice notes are IGNORED" default.
Some of his closest people talk almost entirely in voice notes (43, 41 and 30 notes
in one 8-week window for the top three), so a text-only harvest leaves them half blank.

Three rules this file exists to enforce:

1. ONE audio file on disk at a time, ever. Media is extracted per note by exact path,
   never by pattern. Extracting the whole attachment domain is how harvest run 1 ended
   up with 8.66 GB it then had to delete.
2. The delete happens in a finally block, so a crash or an interrupt cannot leave audio
   behind. "Delete right after" is not the same guarantee.
3. The Python API, not the whisper CLI. The CLI writes .txt/.vtt/.srt/.json next to its
   input by default: four undeleted transcripts per note, which is exactly the leak the
   no-media rule exists to stop.

Language handling is ASYMMETRIC, and the asymmetry was learned the hard way. Whisper
auto-detect on 30 seconds of Levantine Arabic is unreliable, so a non-English language is
forced when the chat's evidence supports it. English is never forced: the chat's language
guess comes from Shaheen's outgoing TEXT, and text language is not voice language. He
texts one family member in English and speaks Arabic with him, and forcing en onto that
audio produced 14 fluent, confident, entirely wrong transcripts on the first real run.
A wrong forced language fails silently; auto-detect at least reports what it heard, and
the run now prints every disagreement between the guess and what Whisper actually heard.

Output is working material. It holds other people's verbatim words and is deleted at
close-out; only conclusions reach the vault.

PRIVACY: no phone number, name or personal path in this file. Everything is an argument.
"""

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone

APPLE_EPOCH_OFFSET = 978307200

# NEVER force "en". The chat's language guess is derived from Shaheen's outgoing TEXT, and
# text language is not voice language: he texts one family member in English and speaks
# Arabic with him. Forcing en onto that produced 14 confidently fluent, entirely wrong
# transcripts on 2026-09-02, with transliterated Arabic ("Fain sa'a fi mahalat maftooh")
# and outright hallucination ("PAGE LINE PAGE LINE") rendered as English sentences.
#
# The asymmetry is the point. Whisper already leans English, so forcing a NON-English
# language corrects that bias, while forcing English amplifies it and removes the only
# signal that anything went wrong. Where the evidence says English, pass None and let
# Whisper detect, then compare `detected_language` against the guess afterwards.
LANG_MAP = {"ar": "ar", "ar+en": "ar", "sv": "sv", "tr": "tr", "en": None}


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def load_targets(db_path, stats_path, days, min_msgs_8w, only_theirs=False):
    import sqlite3
    stats = json.load(open(stats_path, encoding="utf-8"))
    rows = stats["chats"] if isinstance(stats, dict) else stats
    tier2 = {c["chat_pk"]: c for c in rows
             if c.get("kind") == "person" and c.get("msgs_8w", 0) >= min_msgs_8w}

    cut = (datetime.now(timezone.utc) - timedelta(days=days)).timestamp() - APPLE_EPOCH_OFFSET
    con = sqlite3.connect("file:" + db_path + "?mode=ro", uri=True)
    con.text_factory = lambda b: b.decode("utf-8", "replace")
    cur = con.cursor()
    cur.execute(
        "SELECT m.Z_PK, m.ZCHATSESSION, m.ZISFROMME, m.ZMESSAGEDATE, "
        "       mi.ZMEDIALOCALPATH, mi.ZMOVIEDURATION "
        "FROM ZWAMESSAGE m JOIN ZWAMEDIAITEM mi ON mi.ZMESSAGE = m.Z_PK "
        "WHERE m.ZMESSAGETYPE = 3 AND m.ZMESSAGEDATE >= ? "
        "      AND mi.ZMEDIALOCALPATH IS NOT NULL "
        "ORDER BY m.ZMESSAGEDATE DESC", (cut,))
    out = []
    for pk, sess, from_me, ts, path, dur in cur.fetchall():
        chat = tier2.get(sess)
        if not chat:
            continue
        if only_theirs and from_me:
            continue
        name = (chat.get("_name") or chat.get("saved_contact_name")
                or chat.get("display_name") or str(sess))
        out.append({
            "msg_pk": pk,
            "chat_pk": sess,
            "chat": name,
            "page": chat.get("_page"),
            "from_me": bool(from_me),
            "date": datetime.fromtimestamp(ts + APPLE_EPOCH_OFFSET,
                                           tz=timezone.utc).isoformat(),
            "media_path": path,
            "seconds": dur or 0,
            "lang": LANG_MAP.get(chat.get("language")),
        })
    con.close()
    return out


def main():
    ap = argparse.ArgumentParser(description="Transcribe WhatsApp voice notes locally")
    ap.add_argument("--backup", required=True, help="encrypted iOS backup folder")
    ap.add_argument("--db", default="outputs/whatsapp-harvest/_db/ChatStorage.sqlite")
    ap.add_argument("--stats", default="system/whatsapp-chat-stats.enriched.json")
    ap.add_argument("--out", required=True,
                    help="transcripts .jsonl (gitignored, deleted at close-out)")
    ap.add_argument("--model", default="small",
                    help="whisper model; small is the practical floor for Arabic")
    ap.add_argument("--days", type=int, default=56)
    ap.add_argument("--min-msgs-8w", type=int, default=6)
    ap.add_argument("--limit", type=int, default=0, help="stop after N notes (0 = all)")
    ap.add_argument("--cap-minutes", type=float, default=120.0)
    ap.add_argument("--only-theirs", action="store_true")
    ap.add_argument("--dry-run", action="store_true",
                    help="list what would run, extract nothing, no password needed")
    args = ap.parse_args()

    targets = load_targets(args.db, args.stats, args.days, args.min_msgs_8w,
                           args.only_theirs)
    total_s = sum(t["seconds"] for t in targets)
    log("voice notes in scope: %d  (%.0f min of audio)" % (len(targets), total_s / 60.0))
    if args.limit:
        targets = targets[:args.limit]
        log("  limited to %d" % len(targets))

    if args.dry_run:
        for t in targets[:25]:
            who = "me" if t["from_me"] else "them"
            log("  %s  %-26s %-5s %4ds  lang=%s"
                % (t["date"][:10], t["chat"][:24], who, t["seconds"], t["lang"]))
        log("dry run, nothing extracted")
        return 0

    password = os.environ.get("WA_BACKUP_PASSWORD")
    if not password:
        import getpass
        password = getpass.getpass("iPhone backup encryption password: ")
    if not password:
        log("FATAL: no password; media lives inside the encrypted backup")
        return 2

    from iphone_backup_decrypt import EncryptedBackup, DomainLike
    import whisper

    backup = EncryptedBackup(backup_directory=args.backup, passphrase=password)
    del password

    log("loading whisper '%s' (CPU)..." % args.model)
    t0 = time.time()
    model = whisper.load_model(args.model)
    log("  loaded in %.0fs" % (time.time() - t0))

    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    done = 0
    done_s = 0.0
    failed = 0
    tmpdir = tempfile.mkdtemp(prefix="wa-voice-")
    started = time.time()
    try:
        with open(args.out, "a", encoding="utf-8") as sink:
            for i, t in enumerate(targets, 1):
                if done_s / 60.0 >= args.cap_minutes:
                    log("CAP reached (%.0f min). %d notes NOT transcribed."
                        % (args.cap_minutes, len(targets) - i + 1))
                    break
                tmp = os.path.join(tmpdir, "%s.opus" % t["msg_pk"])
                try:
                    backup.extract_file(relative_path="Message/" + t["media_path"],
                                        domain_like=DomainLike.WHATSAPP,
                                        output_filename=tmp)
                    res = model.transcribe(tmp, language=t["lang"], fp16=False)
                    rec = dict(t)
                    rec.pop("media_path", None)   # never persist a media location
                    rec["text"] = (res.get("text") or "").strip()
                    rec["detected_language"] = res.get("language")
                    sink.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    sink.flush()                  # checkpoint push, per the budget rule
                    done += 1
                    done_s += t["seconds"]
                except Exception as exc:
                    failed += 1
                    log("  [%d/%d] FAIL %s: %s: %s"
                        % (i, len(targets), t["chat"][:20], type(exc).__name__, exc))
                finally:
                    # in finally, not after: a crash must not leave audio on disk
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
                if done and done % 10 == 0:
                    rate = done_s / max(1e-9, time.time() - started)
                    log("  [%d/%d] %d done, %.0f min audio, %.2fx realtime"
                        % (i, len(targets), done, done_s / 60.0, rate))
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
        if os.path.exists(tmpdir):
            log("WARNING: temp dir survived: %s" % tmpdir)
        else:
            log("temp audio dir removed and verified gone")

    log("")
    log("transcribed %d, failed %d, %.0f min of audio in %.0f min"
        % (done, failed, done_s / 60.0, (time.time() - started) / 60.0))

    # Report where Whisper disagreed with the chat's text-derived guess. A disagreement is
    # not an error, it is the signal that this chat is spoken in a different language than
    # it is typed in, and those transcripts deserve a second look before anything is
    # derived from them.
    try:
        seen = {}
        with open(args.out, encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                r = json.loads(line)
                det = r.get("detected_language")
                if det:
                    seen.setdefault((r.get("chat"), r.get("lang"), det), 0)
                    seen[(r.get("chat"), r.get("lang"), det)] += 1
        odd = [(c, g, d, n) for (c, g, d), n in seen.items() if g and g != d]
        if odd:
            log("")
            log("LANGUAGE DISAGREEMENTS (guess vs what Whisper heard) - review before use:")
            for c, g, d, n in sorted(odd, key=lambda x: -x[3]):
                log("  %-28s guessed %s, heard %s  (%d notes)" % (c[:28], g, d, n))
    except Exception as exc:
        log("  (could not summarise languages: %s)" % exc)

    log("-> %s" % args.out)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

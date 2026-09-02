#!/usr/bin/env python3
"""
WhatsApp harvest (#11) - per-chat digests for the deep-read pass.

Turns the last N weeks of each tier-2 chat into a bounded, markable digest so a model
can read plans and commitments out of 8 weeks of conversation without loading 476k
messages.

REDACTION IS NOT OPTIONAL, and this is why the file exists rather than being done
inline. On the 2026-09-02 run the ad-hoc version wrote Shaheen's full payment card
(PAN, expiry, CVV, cardholder name, sent as four consecutive WhatsApp messages) into
plaintext digest files, because nobody had thought to look for one. The digests were
gitignored, so it was never a public-repo risk, but it was a live card copied onto disk
by an automation that had no reason to hold it.

Anything Luhn-valid in card-number shape is replaced before a byte reaches disk, and an
expiry or 3-digit CVV sitting within three lines of a redaction goes with it, because
those arrive as separate messages and are worthless to an attacker only while separated.

Output is working material: it holds other people's verbatim words, it is gitignored, and
it is deleted at close-out. Only conclusions reach the vault.

PRIVACY: no phone number, name or personal path in this file. Everything is an argument.
"""

import argparse
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

APPLE_EPOCH_OFFSET = 978307200

MEDIA_MARKER = {1: "[image]", 2: "[video]", 3: "[voice]", 4: "[contact]",
                5: "[location]", 8: "[doc]", 15: "[sticker]"}

# Commitment and scheduling markers across the languages actually present in this
# corpus (English, Levantine Arabic, Swedish, Turkish). A marked line is where a plan
# or an action point is most likely to live; the reader jumps to these first.
COMMITMENT = re.compile(
    r"("
    r"monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight|"
    r"weekend|next week|next month|let'?s|we said|i'?ll |i will |see you|meet|"
    r"booking|book |ticket|flight|visit|come over|pick you up|"
    r"imorgon|ikv[ae]ll|vi ses|ska vi|n[aä]sta vecka|boka|"
    r"yar[ıi]n|g[oö]r[uü][sş][uü]r[uü]z|hafta|bilet|"
    r"بكرا|منشوف|نلتقي|موعد|الاسبوع|السبت|الاحد|الجمعة|رايح|جاي|تعال|بدنا|منروح|حجز|تذكرة|مطار"
    r"|\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}/\d{1,2}\b"
    r")", re.I)

PAN_RE = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
EXPIRY_RE = re.compile(r"(?<![\d/])(0[1-9]|1[0-2])/(\d{2}|20\d{2})(?![\d/])")
CVV_RE = re.compile(r"(?<![\d/])\d{3}(?![\d/])")
REDACTION_RADIUS = 3   # lines either side of a redacted PAN to sweep for expiry/CVV
# The year half is \d{2}, not 2\d: the card found on 2026-09-02 expired 09/30, and a
# pattern that only matched 2x years let the expiry through while redacting the PAN and
# CVV around it. Near a card this deliberately over-matches, so an ordinary date within
# three lines of a redacted PAN is scrubbed too. That is the correct direction to err.


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def luhn_ok(digits):
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2:
            n *= 2
            if n > 9:
                n -= 9
        total += n
    return total % 10 == 0


def redact_pans(text, counter):
    def repl(m):
        digits = re.sub(r"\D", "", m.group())
        if 13 <= len(digits) <= 19 and luhn_ok(digits):
            counter[0] += 1
            return "[CARD-REDACTED-%s]" % digits[-4:]
        return m.group()
    return PAN_RE.sub(repl, text)


def redact_lines(lines, counter):
    """PANs everywhere; expiry and CVV only near a PAN, so ordinary numbers survive."""
    out = [redact_pans(ln, counter) for ln in lines]
    for i, ln in enumerate(out):
        if "CARD-REDACTED" in ln:
            continue
        lo = max(0, i - REDACTION_RADIUS)
        hi = min(len(out), i + REDACTION_RADIUS + 1)
        if any("CARD-REDACTED" in out[j] for j in range(lo, hi)):
            new = EXPIRY_RE.sub("[EXP-REDACTED]", ln)
            new = CVV_RE.sub("[CVV-REDACTED]", new)
            if new != ln:
                counter[1] += 1
                out[i] = new
    return out


def build(db_path, stats_path, out_dir, days, min_msgs_8w, max_lines, max_chars):
    import sqlite3
    stats = json.load(open(stats_path, encoding="utf-8"))
    rows = stats["chats"] if isinstance(stats, dict) else stats
    tier2 = [c for c in rows
             if c.get("kind") == "person" and c.get("msgs_8w", 0) >= min_msgs_8w]
    tier2.sort(key=lambda c: -c.get("msgs_8w", 0))

    cut = (datetime.now(timezone.utc) - timedelta(days=days)).timestamp() - APPLE_EPOCH_OFFSET
    con = sqlite3.connect("file:" + db_path + "?mode=ro", uri=True)
    con.text_factory = lambda b: b.decode("utf-8", "replace")
    cur = con.cursor()
    os.makedirs(out_dir, exist_ok=True)

    counter = [0, 0]
    written = []
    for c in tier2:
        cur.execute(
            "SELECT m.ZISFROMME, m.ZMESSAGEDATE, m.ZTEXT, m.ZMESSAGETYPE, mi.ZMOVIEDURATION "
            "FROM ZWAMESSAGE m LEFT JOIN ZWAMEDIAITEM mi ON mi.ZMESSAGE = m.Z_PK "
            "WHERE m.ZCHATSESSION = ? AND m.ZMESSAGEDATE >= ? "
            "ORDER BY m.ZMESSAGEDATE", (c["chat_pk"], cut))
        lines = []
        flagged = 0
        for from_me, ts, txt, mtype, dur in cur.fetchall():
            when = datetime.fromtimestamp(ts + APPLE_EPOCH_OFFSET, tz=timezone.utc)
            body = (txt or "").replace("\n", " ").strip()
            if not body:
                body = MEDIA_MARKER.get(mtype, "[media]")
                if mtype == 3 and dur:
                    body = "[voice %ds]" % int(dur)
            if len(body) > max_chars:
                body = body[:max_chars] + "..."
            mark = ">> " if COMMITMENT.search(body) else "   "
            if mark == ">> ":
                flagged += 1
            lines.append("%s%s %s: %s"
                         % (mark, when.strftime("%m-%d %H:%M"),
                            "me " if from_me else "them", body))

        if len(lines) > max_lines:
            keep_head = max_lines // 3
            keep_tail = max_lines - keep_head
            elided = len(lines) - max_lines
            lines = (lines[:keep_head]
                     + ["   [... %d lines elided ...]" % elided]
                     + lines[-keep_tail:])

        lines = redact_lines(lines, counter)

        name = c.get("_name") or c.get("saved_contact_name") or str(c["chat_pk"])
        slug = re.sub(r"[^A-Za-z0-9]+", "-", name)[:40].strip("-").lower() or "chat"
        path = os.path.join(out_dir, "%s-%s.md" % (c["chat_pk"], slug))
        header = (
            "# %s\n"
            "page: %s | jid: %s\n"
            "8w:%s 12m:%s share_me_12m:%s last:%s by:%s voice8w:%s calls12m:%s lang:%s\n"
            "commitment-marked lines: %d\n\n"
            % (name, c.get("_page") or "NONE", c.get("jid"),
               c.get("msgs_8w"), c.get("msgs_12m"), c.get("from_me_share_12m"),
               c.get("last_msg"), c.get("last_sender"), c.get("voice_notes_8w"),
               c.get("calls_12m"), c.get("language"), flagged))
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(header + "\n".join(lines) + "\n")
        written.append((name, len(lines), flagged))
    con.close()
    return written, counter


def verify_clean(out_dir):
    """Fail loud if anything card-shaped survived. A redactor nobody checks is decoration."""
    leaks = []
    for f in sorted(os.listdir(out_dir)):
        txt = open(os.path.join(out_dir, f), encoding="utf-8").read()
        for m in PAN_RE.finditer(txt):
            digits = re.sub(r"\D", "", m.group())
            if 13 <= len(digits) <= 19 and luhn_ok(digits):
                leaks.append((f, digits[-4:]))
    return leaks


def main():
    ap = argparse.ArgumentParser(description="Build per-chat digests for the deep read")
    ap.add_argument("--db", default="outputs/whatsapp-harvest/_db/ChatStorage.sqlite")
    ap.add_argument("--stats", default="system/whatsapp-chat-stats.enriched.json")
    ap.add_argument("--out", required=True, help="digest directory (must be gitignored)")
    ap.add_argument("--days", type=int, default=56)
    ap.add_argument("--min-msgs-8w", type=int, default=6)
    ap.add_argument("--max-lines", type=int, default=600)
    ap.add_argument("--max-chars", type=int, default=400)
    args = ap.parse_args()

    written, counter = build(args.db, args.stats, args.out, args.days,
                             args.min_msgs_8w, args.max_lines, args.max_chars)
    log("digests written: %d" % len(written))
    log("  total lines   : %d" % sum(w[1] for w in written))
    log("  flagged lines : %d" % sum(w[2] for w in written))
    log("  cards redacted: %d   expiry/CVV lines scrubbed: %d" % (counter[0], counter[1]))

    leaks = verify_clean(args.out)
    if leaks:
        log("FATAL: card-shaped data survived redaction in %d place(s):" % len(leaks))
        for f, last4 in leaks:
            log("   %s (ending %s)" % (f, last4))
        return 2
    log("  verified: no Luhn-valid card numbers remain in any digest")
    return 0


if __name__ == "__main__":
    sys.exit(main())

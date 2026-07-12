#!/usr/bin/env python3
r"""
notify_hook.py - Claude Code Notification hook: say "I need permission" out loud
(Alex Voice v3). Prevents the silent-stall failure: a hands-off Shaheen hears that
the session is waiting on a permission dialog instead of assuming she's thinking.

Same contract as speak_hook.py: flag-gated, filters on the notification text,
30-second cooldown so a re-fired notification doesn't nag, detached worker, exits
fast. Wired in .claude/settings.json (Notification).
"""

import json
import os
import subprocess
import sys
import time

# v3 sits at work/voice/v3/, so the repo root is FOUR levels up from this file.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
FLAG = os.path.join(REPO, "outputs", "voice", "voice-on.flag")
STATE = os.path.join(REPO, "outputs", "voice", ".state")
PYW = os.path.join(REPO, "work", "voice", ".venv", "Scripts", "pythonw.exe")
WORKER = os.path.join(REPO, "work", "voice", "v3", "speak_worker.py")
COOLDOWN_S = 30
TRIGGERS = ("permission", "waiting for your input", "approval")
LINE = "Shaheen, I need your permission on screen."


def main():
    if not os.path.exists(FLAG):
        return 0
    try:
        # utf-8-sig: tolerate a BOM (PowerShell pipes prepend one; harmless if absent).
        payload = json.loads(sys.stdin.buffer.read().decode("utf-8-sig", errors="replace"))
    except Exception:
        return 0
    message = (payload.get("message") or "").lower()
    if message and not any(t in message for t in TRIGGERS):
        return 0

    os.makedirs(STATE, exist_ok=True)
    stamp = os.path.join(STATE, "notify-last.ts")
    now = time.time()
    try:
        with open(stamp, "r", encoding="utf-8") as f:
            if now - float(f.read().strip() or 0) < COOLDOWN_S:
                return 0
    except OSError:
        pass
    try:
        with open(stamp, "w", encoding="utf-8") as f:
            f.write(str(now))
    except OSError:
        pass

    tmp = os.path.join(STATE, f"notify-{os.getpid()}.txt")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(LINE)
    flags = 0x00000008 | 0x08000000  # DETACHED_PROCESS | CREATE_NO_WINDOW
    subprocess.Popen([PYW, WORKER, tmp], creationflags=flags, close_fds=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, cwd=REPO)
    return 0


if __name__ == "__main__":
    sys.exit(main())

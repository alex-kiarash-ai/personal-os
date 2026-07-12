#!/usr/bin/env python3
r"""
speak_hook.py - Claude Code Stop hook: speak Alex's reply aloud (Alex Voice v3).

Design contract (research-team run 22): this process must be FAST and DETERMINISTIC.
It reads the Stop-hook JSON from stdin, gates on the voice flag file, filters
empty/duplicate payloads (Stop also fires around /clear and /compact), then hands the
text to a DETACHED worker and exits immediately, so the prompt is never held hostage
to 20 seconds of speech. No model cooperation anywhere: hook = configuration.

Voice off (no flag file) costs one python startup and zero audio. Scheduled headless
`claude -p` runs never have the flag set, so they are unaffected by construction.

Wired in .claude/settings.json (Stop). Flag: outputs/voice/voice-on.flag
("voice on" / "voice off" to Alex, or work/voice/v3/voice-on.cmd / voice-off.cmd).
"""

import hashlib
import json
import os
import subprocess
import sys

# v3 sits at work/voice/v3/, so the repo root is FOUR levels up from this file.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
FLAG = os.path.join(REPO, "outputs", "voice", "voice-on.flag")
STATE = os.path.join(REPO, "outputs", "voice", ".state")
PYW = os.path.join(REPO, "work", "voice", ".venv", "Scripts", "pythonw.exe")
WORKER = os.path.join(REPO, "work", "voice", "v3", "speak_worker.py")


def _log(msg):
    """Best-effort breadcrumb. v2 died silently behind stderr=DEVNULL; never again."""
    try:
        os.makedirs(STATE, exist_ok=True)
        import time
        with open(os.path.join(STATE, "hook.log"), "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] speak_hook: {msg}\n")
    except OSError:
        pass


def main():
    if not os.path.exists(FLAG):
        return 0

    try:
        # utf-8-sig: tolerate a BOM (PowerShell pipes prepend one; harmless if absent).
        payload = json.loads(sys.stdin.buffer.read().decode("utf-8-sig", errors="replace"))
    except Exception as e:
        _log(f"stdin parse failed: {e}")
        return 0

    text = (payload.get("last_assistant_message") or "").strip()
    if not text:
        return 0  # /clear- or /compact-class fire, or an errored turn: nothing to say

    os.makedirs(STATE, exist_ok=True)

    # Dedup: the same message re-delivered (e.g. around /compact) is spoken once.
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    last_path = os.path.join(STATE, "last-spoken.hash")
    try:
        with open(last_path, "r", encoding="utf-8") as f:
            if f.read().strip() == digest:
                return 0
    except OSError:
        pass
    try:
        with open(last_path, "w", encoding="utf-8") as f:
            f.write(digest)
    except OSError:
        pass

    # Hand off to the detached worker; the hook returns before a word is spoken.
    tmp = os.path.join(STATE, f"say-{os.getpid()}.txt")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    flags = 0x00000008 | 0x08000000  # DETACHED_PROCESS | CREATE_NO_WINDOW
    subprocess.Popen([PYW, WORKER, tmp], creationflags=flags, close_fds=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                     stderr=subprocess.DEVNULL, cwd=REPO)
    return 0


if __name__ == "__main__":
    sys.exit(main())

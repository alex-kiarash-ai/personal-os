#!/usr/bin/env python3
r"""
speak_worker.py - detached speaker for Alex Voice v3.

Reads a UTF-8 text file (arg 1), speaks it through the never-mute chain
(Edge-TTS -> SAPI floor, tts_chain.py), deletes the file, exits. One instance
speaks at a time: a lock directory serializes overlapping replies instead of
letting two workers talk over each other. Lives for one reply, so there is no
long-lived audio process to crash (the v2 lesson).
"""

import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

# v3 sits at work/voice/v3/, so the repo root is FOUR levels up from this file.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
LOCK = os.path.join(REPO, "outputs", "voice", ".state", "speak.lock")
LOG = os.path.join(REPO, "outputs", "voice", ".state", "speak.log")


def log(msg):
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    except OSError:
        pass


def acquire_lock(max_wait=90, stale=180):
    t0 = time.time()
    while True:
        try:
            os.makedirs(LOCK)
            return True
        except OSError:
            try:
                if time.time() - os.path.getmtime(LOCK) > stale:
                    os.rmdir(LOCK)
                    continue
            except OSError:
                pass
            if time.time() - t0 > max_wait:
                return False
            time.sleep(0.25)


def release_lock():
    try:
        os.rmdir(LOCK)
    except OSError:
        pass


def main():
    if len(sys.argv) < 2:
        return 1
    path = sys.argv[1]
    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        log(f"could not read {path}: {e}")
        return 1
    finally:
        try:
            os.remove(path)
        except OSError:
            pass

    if not acquire_lock():
        log("gave up waiting for the speak lock")
        return 1
    try:
        import tts_chain
        n = tts_chain.speak(text)
        log(f"spoke {n} sentence(s), {len(text)} chars in")
    except Exception as e:
        log(f"speak failed: {e}")
        return 1
    finally:
        release_lock()
    return 0


if __name__ == "__main__":
    sys.exit(main())

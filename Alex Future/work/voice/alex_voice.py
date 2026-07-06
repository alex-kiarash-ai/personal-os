#!/usr/bin/env python3
"""
alex_voice.py - Alex's two-way voice conversation loop (v1).

Replaces the old one-way Stop-hook TTS (speak-hook.ps1) with a real back-and-forth:
you talk, Alex talks back, you can cut in with Esc, and it loops.

Architecture (decided from research-team run 13 + measured on this box):
  - ONE persistent `claude` process in stream-json mode = the full Alex brain
    (soul.md persona, CLAUDE.md protocols, MCP, vault) loaded ONCE, so turns are
    fast. Per-turn `claude -p` was 5-11s; this keeps the process warm instead.
  - Local Whisper for speech-in (nothing leaves the box).
  - OpenAI gpt-4o-mini-tts ("sage") for speech-out, one sentence at a time so the
    first audio starts fast and each chunk is interruptible.
  - Barge-in v1 = press Esc while Alex is speaking. (Hands-free voice barge-in is
    v2; it needs the Jabra headset on so the speaker doesn't retrigger the mic.)

Run it:  python work/voice/alex_voice.py     (from the repo root, in a normal terminal)
Quit:    say/type nothing and press 'q' then Enter at the prompt, or Ctrl-C.

Requires: OPENAI_API_KEY in the environment (it's a User env var on this box),
          the `claude` CLI on PATH, and: pip install sounddevice soundfile  (done).
"""

import io
import json
import os
import re
import shutil
import subprocess
import sys
import time

import numpy as np
import sounddevice as sd
import soundfile as sf

try:
    import msvcrt  # Windows key polling for the Esc barge-in
except ImportError:
    msvcrt = None

# ------------------------- config (tune here) -------------------------
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WHISPER_MODEL = "base"          # base = good CPU balance + multilingual (EN/AR/SV). "small" = better, slower.
TTS_BACKEND = "openai"         # the "sage" Alex voice via gpt-4o-mini-tts (Shaheen topping up credits 2026-07-05). Auto-falls back to local SAPI if the account is dry, so it's safe even before the top-up lands. Set "sapi" to force the free/local/robotic voice.
TTS_MODEL = "gpt-4o-mini-tts"
TTS_VOICE = "coral"             # warm feminine voice (Shaheen 2026-07-05: wants a female voice for Alex). Swap: nova=brighter, shimmer=softer, sage=calmer/neutral. Only used when TTS_BACKEND="openai".
TTS_INSTRUCTIONS = ("Speak as Alex, a warm feminine voice: calm, incisive, warm but direct, with dry wit. "
                    "Unhurried, natural human pacing. A wise mentor who cuts through noise. "
                    "Never robotic or announcer-like.")
SAMPLE_RATE = 16000             # Whisper wants 16k mono
SILENCE_HANG_S = 1.2            # stop recording after this much silence once you've started talking
MAX_RECORD_S = 40               # hard cap per utterance
CALIBRATE_S = 1.0               # ambient-noise sample to set the silence threshold
CLAUDE_PERMISSION_MODE = "default"  # "default" is safe; set "bypassPermissions" ONLY if you want
                                    # voice-Alex to run tools without asking (risky: a misheard command).
TURN_TIMEOUT_S = 90             # if a turn doesn't finish (e.g. stuck on a tool permission), bail gracefully
# ---------------------------------------------------------------------

OPENAI_URL = "https://api.openai.com/v1/audio/speech"
ESC = b"\x1b"


def die(msg):
    print(f"\n[alex-voice] {msg}", file=sys.stderr)
    sys.exit(1)


# ------------------------- speech OUT (TTS) -------------------------
_tts_state = {"fallback": False}


def openai_tts_wav(text):
    """One sentence -> WAV bytes via OpenAI gpt-4o-mini-tts (the 'sage' Alex voice). Needs OpenAI credits."""
    import urllib.request
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("OPENAI_API_KEY not set")
    body = json.dumps({
        "model": TTS_MODEL, "voice": TTS_VOICE, "input": text,
        "instructions": TTS_INSTRUCTIONS, "response_format": "wav",
    }).encode("utf-8")
    req = urllib.request.Request(OPENAI_URL, data=body, headers={
        "Authorization": f"Bearer {key}", "Content-Type": "application/json",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def sapi_tts_wav(text):
    """One sentence -> WAV bytes via built-in Windows SAPI. Free, offline, robotic, always available."""
    import tempfile
    path = os.path.join(tempfile.gettempdir(), f"alex_sapi_{os.getpid()}.wav")
    safe = text.replace('"', "'")
    ps = ("Add-Type -AssemblyName System.Speech; "
          "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
          f'$s.SetOutputToWaveFile("{path}"); $s.Speak("{safe}"); $s.Dispose()')
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True, capture_output=True)
    with open(path, "rb") as f:
        data = f.read()
    try:
        os.remove(path)
    except OSError:
        pass
    return data


def tts_wav(text):
    """Dispatch to the configured backend; auto-fall back to local SAPI so Alex never goes mute."""
    if TTS_BACKEND == "openai" and not _tts_state["fallback"]:
        try:
            return openai_tts_wav(text)
        except Exception as e:
            print(f"[alex-voice] OpenAI TTS unavailable ({e}); using local SAPI voice for the rest of this session.")
            _tts_state["fallback"] = True
    return sapi_tts_wav(text)


_MD = [
    (re.compile(r"(?s)```.*?```"), " "), (re.compile(r"`([^`]*)`"), r"\1"),
    (re.compile(r"!?\[([^\]]*)\]\([^\)]*\)"), r"\1"), (re.compile(r"(?m)^\s{0,3}#{1,6}\s*"), ""),
    (re.compile(r"(?m)^\s*[-*+]\s+"), ""), (re.compile(r"\*\*([^*]+)\*\*"), r"\1"),
    (re.compile(r"\*([^*]+)\*"), r"\1"), (re.compile(r"\|"), " "),
]


def clean_for_speech(text):
    for pat, rep in _MD:
        text = pat.sub(rep, text)
    return re.sub(r"[ \t]+", " ", text).strip()


def split_sentences(text):
    parts = re.split(r"(?<=[.!?])\s+", text)
    out = []
    for p in parts:
        p = p.strip()
        while len(p) > 240:  # keep chunks short so first audio + interrupts stay snappy
            cut = p.rfind(" ", 0, 240)
            cut = cut if cut > 0 else 240
            out.append(p[:cut]); p = p[cut:].strip()
        if p:
            out.append(p)
    return out


def esc_pressed():
    if msvcrt and msvcrt.kbhit():
        return msvcrt.getch() == ESC
    return False


def speak(text):
    """Speak text sentence-by-sentence. Returns True if interrupted with Esc."""
    for sentence in split_sentences(clean_for_speech(text)):
        try:
            data, sr = sf.read(io.BytesIO(tts_wav(sentence)), dtype="float32")
        except Exception as e:
            print(f"[alex-voice] TTS failed on a chunk ({e}); skipping it.")
            continue
        sd.play(data, sr)
        stream = sd.get_stream()
        while stream is not None and stream.active:
            if esc_pressed():
                sd.stop()
                return True
            time.sleep(0.03)
    return False


# ------------------------- speech IN (mic + Whisper) -------------------------
def calibrate_threshold():
    print("[alex-voice] calibrating mic (stay quiet 1s)...", end="", flush=True)
    rec = sd.rec(int(CALIBRATE_S * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype="float32")
    sd.wait()
    ambient = float(np.sqrt(np.mean(rec ** 2)) + 1e-9)
    thr = max(ambient * 3.0, 0.012)
    print(f" done (ambient={ambient:.4f}, threshold={thr:.4f})")
    return thr


def record_until_silence(threshold):
    """Record from the mic; stop after SILENCE_HANG_S of quiet once you've begun speaking."""
    import queue
    q = queue.Queue()

    def cb(indata, frames, t, status):
        q.put(indata.copy())

    frames, started, silence_start, t0 = [], False, None, time.time()
    block = int(SAMPLE_RATE * 0.05)
    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32", blocksize=block, callback=cb):
        while True:
            chunk = q.get()
            frames.append(chunk)
            rms = float(np.sqrt(np.mean(chunk ** 2)) + 1e-9)
            if rms > threshold:
                started, silence_start = True, None
            elif started:
                silence_start = silence_start or time.time()
                if time.time() - silence_start > SILENCE_HANG_S:
                    break
            if time.time() - t0 > MAX_RECORD_S:
                break
    return np.concatenate(frames).flatten() if frames else np.array([], dtype="float32")


# ------------------------- the Alex brain (persistent claude) -------------------------
class Alex:
    def __init__(self):
        exe = shutil.which("claude") or "claude"
        cli_args = ["-p", "--input-format", "stream-json", "--output-format",
                    "stream-json", "--verbose", "--permission-mode", CLAUDE_PERMISSION_MODE]
        # On Windows `claude` is a .cmd shim; a bare CreateProcess can't launch it (WinError 2),
        # so route .cmd/.bat through cmd.exe. A real .exe (or non-Windows) launches directly.
        if os.name == "nt" and exe.lower().endswith((".cmd", ".bat")):
            args = ["cmd", "/c", exe] + cli_args
        else:
            args = [exe] + cli_args
        self.p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  cwd=REPO, text=True, encoding="utf-8", bufsize=1,
                                  stderr=subprocess.DEVNULL)
        # claude emits nothing until it receives the first message, so we do NOT drain
        # startup events here (that would block forever). The first ask() reads through
        # the startup system events and harmlessly skips them; the first reply is a few
        # seconds slower while MCP + vault load.
        print("[alex-voice] Alex is up (first reply loads MCP + vault, give it a few seconds).")

    def ask(self, text):
        msg = {"type": "user", "message": {"role": "user", "content": text}}
        self.p.stdin.write(json.dumps(msg) + "\n")
        self.p.stdin.flush()
        parts, deadline = [], time.time() + TURN_TIMEOUT_S
        for line in self.p.stdout:
            if time.time() > deadline:
                parts.append(" (I stalled on that one, probably a tool I can't run by voice. Ask me in the main session.)")
                break
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = ev.get("type")
            if t == "assistant":
                for b in ev.get("message", {}).get("content", []):
                    if b.get("type") == "text" and b.get("text"):
                        parts.append(b["text"])
            elif t == "result":
                break
        return "".join(parts).strip()

    def close(self):
        try:
            self.p.stdin.close()
            self.p.terminate()
        except Exception:
            pass


# ------------------------- main loop -------------------------
def main():
    print("=" * 60)
    print(" Alex Voice v1  -  talk to Alex")
    print("  Enter = start talking (auto-stops when you go quiet)")
    print("  Esc   = cut Alex off mid-reply")
    print("  q+Enter or Ctrl-C = quit")
    print("=" * 60)

    print("[alex-voice] loading Whisper '%s' (first run may download)..." % WHISPER_MODEL, end="", flush=True)
    import whisper
    model = whisper.load_model(WHISPER_MODEL)
    print(" ready.")

    threshold = calibrate_threshold()
    alex = Alex()
    speak("Hey Shaheen. I'm here. Talk to me.")

    try:
        while True:
            cmd = input("\n[Enter to talk / q to quit] ").strip().lower()
            if cmd in ("q", "quit", "exit"):
                break
            print("[alex-voice] listening...", flush=True)
            audio = record_until_silence(threshold)
            if audio.size < SAMPLE_RATE * 0.3:
                print("[alex-voice] (didn't catch that)")
                continue
            result = model.transcribe(audio, fp16=False)
            you = (result.get("text") or "").strip()
            if not you:
                print("[alex-voice] (silence)")
                continue
            print(f"  you: {you}")
            reply = alex.ask(you)
            if not reply:
                print("[alex-voice] (Alex said nothing)")
                continue
            print(f"  Alex: {reply}")
            if speak(reply):
                print("[alex-voice] (interrupted)")
    except KeyboardInterrupt:
        pass
    finally:
        alex.close()
        print("\n[alex-voice] later, Shaheen. Siga siga.")


if __name__ == "__main__":
    main()

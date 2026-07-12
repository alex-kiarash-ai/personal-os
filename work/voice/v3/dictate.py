#!/usr/bin/env python3
r"""
dictate.py - Alex Voice v3, the trilingual side-lane (Arabic / Swedish / English).

Native /voice covers EN/SV dictation but has NO Arabic and no per-utterance language
auto-detect. This lane keeps v2's crown jewel: press the hotkey with the Claude Code
terminal focused, speak in ANY of the three languages, and the local whisper "base"
model (auto-detect, nothing leaves the box) types the transcript into the prompt at
your cursor. It NEVER presses Enter - you read the text and submit it yourself
(the run-22 QC bar: with acceptEdits on, a mishear must not be able to execute).

Safety chain, in order:
  1. The foreground window handle is captured at launch and re-checked right before
     injection; if focus moved, NOTHING is typed - the text goes to the clipboard
     instead (double beep = "it's on the clipboard, paste it").
  2. Injection is SendInput with KEYEVENTF_UNICODE through Microsoft-signed
     user32.dll (ctypes; verified loadable under Smart App Control, run 22).
     Text is collapsed to one line first, so no character can act as Enter.
  3. Short-lived process: records, transcribes, types, exits. Nothing stays alive
     to crash (the v2 lesson). Whisper loads DURING recording to hide the ~5s
     torch cold start behind your own speaking time.

Launch: hotkey on the "Alex Dictate" desktop shortcut (Ctrl+Alt+D), or
work\voice\v3\dictate.cmd. Cues: two-tone chime = recording, talk now;
low chime = heard you, transcribing; typed text = done;
double low beep = focus moved, transcript is on the clipboard.
Log: outputs/voice/.state/dictate.log. Raw lines also append to
outputs/voice/transcripts/YYYY-MM-DD.md (the soul.md My Words corpus source).
"""

import ctypes
import os
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
# v3 sits at work/voice/v3/, so the repo root is FOUR levels up from this file.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
STATE = os.path.join(REPO, "outputs", "voice", ".state")
LOG = os.path.join(STATE, "dictate.log")

WHISPER_MODEL = "base"       # multilingual EN/AR/SV auto-detect (v2-proven)
SAMPLE_RATE = 16000
SILENCE_HANG_S = 0.9         # stop after this much quiet once you've started talking
MAX_RECORD_S = 40
WAIT_FOR_SPEECH_S = 8.0      # abort if you press the hotkey and say nothing


def log(msg):
    try:
        os.makedirs(STATE, exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    except OSError:
        pass


# ------------------------- Win32 (signed user32 only) -------------------------
user32 = ctypes.windll.user32

PUL = ctypes.POINTER(ctypes.c_ulong)


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", ctypes.c_ushort), ("wScan", ctypes.c_ushort),
                ("dwFlags", ctypes.c_ulong), ("time", ctypes.c_ulong),
                ("dwExtraInfo", PUL)]


class _INPUTUNION(ctypes.Union):
    _fields_ = [("ki", KEYBDINPUT), ("padding", ctypes.c_ubyte * 32)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", ctypes.c_ulong), ("union", _INPUTUNION)]


INPUT_KEYBOARD = 1
KEYEVENTF_UNICODE = 0x0004
KEYEVENTF_KEYUP = 0x0002


def send_unicode_text(text):
    """Type text into the focused window via SendInput, one UTF-16 code unit at a time
    (surrogate pairs included, so Arabic and any emoji survive). No VK codes, no Enter."""
    units = text.encode("utf-16-le")
    events = []
    for i in range(0, len(units), 2):
        cu = int.from_bytes(units[i:i + 2], "little")
        for flags in (KEYEVENTF_UNICODE, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP):
            inp = INPUT()
            inp.type = INPUT_KEYBOARD
            inp.union.ki = KEYBDINPUT(0, cu, flags, 0, None)
            events.append(inp)
    arr = (INPUT * len(events))(*events)
    sent = user32.SendInput(len(events), arr, ctypes.sizeof(INPUT))
    return sent == len(events)


def clipboard_fallback(text):
    """Focus moved: never inject blind. Put the transcript on the clipboard via
    PowerShell (UTF-8 file round-trip keeps Arabic intact)."""
    path = os.path.join(tempfile.gettempdir(), f"alex_dictate_{os.getpid()}.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    ps = f"Get-Content -Raw -Encoding utf8 '{path}' | Set-Clipboard"
    subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                   check=True, capture_output=True)
    try:
        os.remove(path)
    except OSError:
        pass


# ------------------------- mic (ported from v2, per-invocation) -------------------------
def calibrate_threshold():
    import numpy as np
    import sounddevice as sd
    rec = sd.rec(int(0.6 * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype="float32")
    sd.wait()
    ambient = float(np.sqrt(np.mean(rec ** 2)) + 1e-9)
    return max(ambient * 3.0, 0.012)


def record_until_silence(threshold):
    import queue

    import numpy as np
    import sounddevice as sd
    q = queue.Queue()

    def cb(indata, frames, t, status):
        q.put(indata.copy())

    block = int(SAMPLE_RATE * 0.05)
    keep = int(0.4 / 0.05)
    frames, preroll = [], []
    started, over, silence_start, t_start = False, 0.0, None, None
    t0 = time.time()
    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32",
                        blocksize=block, callback=cb):
        while True:
            chunk = q.get()
            rms = float(np.sqrt(np.mean(chunk ** 2)) + 1e-9)
            if not started:
                preroll.append(chunk)
                if len(preroll) > keep:
                    preroll.pop(0)
                if rms > threshold:
                    over += len(chunk) / SAMPLE_RATE
                    if over >= 0.15:
                        started, t_start = True, time.time()
                        frames = list(preroll)
                else:
                    over = 0.0
                if time.time() - t0 > WAIT_FOR_SPEECH_S:
                    break
            else:
                frames.append(chunk)
                if rms > threshold:
                    silence_start = None
                else:
                    silence_start = silence_start or time.time()
                    if time.time() - silence_start > SILENCE_HANG_S:
                        break
                if time.time() - t_start > MAX_RECORD_S:
                    break
    return np.concatenate(frames).flatten() if frames else None


def save_transcript(text):
    """Raw spoken line -> outputs/voice/transcripts/YYYY-MM-DD.md (soul corpus source)."""
    try:
        day = time.strftime("%Y-%m-%d")
        d = os.path.join(REPO, "outputs", "voice", "transcripts")
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, f"{day}.md")
        if not os.path.exists(path):
            with open(path, "w", encoding="utf-8") as f:
                f.write(f"# Voice transcript {day} (raw spoken lines, for soul.md My Words harvest)\n\n")
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"- [{time.strftime('%H:%M')}] {text}\n")
    except Exception as e:
        log(f"transcript save skipped ({e})")


def main():
    import tts_chain

    target_hwnd = user32.GetForegroundWindow()
    log(f"launch: foreground hwnd={target_hwnd}")

    # Hide the torch/whisper cold start behind the user's own speaking time.
    model_box = {}

    def load():
        import whisper
        model_box["m"] = whisper.load_model(WHISPER_MODEL)

    loader = threading.Thread(target=load, daemon=True)
    loader.start()

    threshold = calibrate_threshold()
    tts_chain.chime("ready")                      # two-tone: recording, talk now
    audio = record_until_silence(threshold)
    if audio is None or audio.size < SAMPLE_RATE * 0.35:
        log("no speech; abort")
        return 0
    tts_chain.chime("heard")                      # low: got it, transcribing

    loader.join()
    model = model_box["m"]
    # Constrain language detection to Shaheen's three. Free auto-detect on short/noisy
    # clips mislabels wildly (live 2026-07-12: real speech tagged pt and fr, transcribed
    # as garbage). Detect first, then FORCE the best of en/ar/sv into transcribe.
    import whisper as _w
    lang = None
    try:
        padded = _w.pad_or_trim(audio)
        try:
            mel = _w.log_mel_spectrogram(padded, model.dims.n_mels).to(model.device)
        except TypeError:
            mel = _w.log_mel_spectrogram(padded).to(model.device)
        _, probs = model.detect_language(mel)
        three = {l: float(probs.get(l, 0.0)) for l in ("en", "ar", "sv")}
        lang = max(three, key=three.get)
        log(f"lang probs en/ar/sv = {three['en']:.2f}/{three['ar']:.2f}/{three['sv']:.2f} -> {lang}")
    except Exception as e:
        log(f"detect_language failed ({e}); falling back to free auto-detect")
    result = model.transcribe(audio, fp16=False, language=lang)
    text = " ".join(((result.get("text") or "").strip()).split())  # ONE line, no Enter-able chars
    lang = result.get("language", lang or "?")
    if not text:
        log("empty transcript; abort")
        return 0
    save_transcript(text)

    if user32.GetForegroundWindow() != target_hwnd:
        clipboard_fallback(text)
        tts_chain.chime("heard"); tts_chain.chime("heard")   # double beep = clipboard
        log(f"focus moved; clipboard fallback ({lang}, {len(text)} chars)")
        return 0

    ok = send_unicode_text(text)
    log(f"injected ({lang}, {len(text)} chars, ok={ok})")
    if not ok:
        clipboard_fallback(text)
        tts_chain.chime("heard"); tts_chain.chime("heard")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        log(f"CRASH: {e!r}")
        sys.exit(1)

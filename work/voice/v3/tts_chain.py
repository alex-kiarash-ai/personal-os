#!/usr/bin/env python3
r"""
tts_chain.py - Alex Voice v3 shared speech-out module.

The proven v2 organs (alex_voice.py, 2026-07-07), lifted into a reusable module for the
in-session voice build (research-team run 22, vault/research/alex-voice-in-session.md):
Edge-TTS neural voice -> Windows SAPI floor (never-mute), markdown sanitizer, sentence
splitter, and a pipelined speak() so multi-sentence replies have no dead air between
sentences. No mic code here; speech-in lives in dictate.py (whisper lane) and Claude
Code's native /voice (primary lane).

Used by: speak_worker.py (Stop-hook TTS), notify_hook.py (permission announcements),
dictate.py (chimes). Runs on work/voice/.venv (edge-tts + sounddevice + soundfile).
"""

import asyncio
import io
import re
import subprocess
import threading
import time

# -- voice config (same values as v2; change here, not in callers) --
TTS_CHAIN = ["edge", "sapi"]
EDGE_VOICE = "en-US-AvaMultilingualNeural"   # multilingual: speaks EN/AR/SV
EDGE_RATE = "+0%"
EDGE_PITCH = "+0Hz"
TTS_LOOKAHEAD = 2
MAX_SENTENCES = 8            # the monologue seatbelt, v2's live-test lesson

# ------------------------- text -> speakable -------------------------
_MD = [
    (re.compile(r"(?s)```.*?```"), " "),               # fenced code: never read aloud
    (re.compile(r"`([^`]*)`"), r"\1"),
    (re.compile(r"!?\[([^\]]*)\]\([^\)]*\)"), r"\1"),  # md links -> text
    (re.compile(r"\[\[([^\]|]*)\|([^\]]*)\]\]"), r"\2"),  # [[page|label]] -> label
    (re.compile(r"\[\[([^\]]*)\]\]"), r"\1"),
    (re.compile(r"https?://\S+"), " "),                # bare URLs: unspeakable
    (re.compile(r"(?m)^\s{0,3}#{1,6}\s*"), ""),
    (re.compile(r"(?m)^\s*[-*+]\s+"), ""),
    (re.compile(r"(?m)^\s*\d+\.\s+"), ""),
    (re.compile(r"\*\*([^*]+)\*\*"), r"\1"),
    (re.compile(r"\*([^*]+)\*"), r"\1"),
    (re.compile(r"\|"), " "),
    (re.compile(r"—"), ", "),                     # em-dash -> comma (the voice rule)
    (re.compile(r"(?m)^Close-Out .*$"), " "),          # never read the close-out report aloud
]


def clean_for_speech(text):
    for pat, rep in _MD:
        text = pat.sub(rep, text)
    return re.sub(r"[ \t]+", " ", text).strip()


def _hard_wrap(sentence, limit=240):
    out = []
    p = sentence.strip()
    while len(p) > limit:
        cut = p.rfind(" ", 0, limit)
        cut = cut if cut > 0 else limit
        out.append(p[:cut]); p = p[cut:].strip()
    if p:
        out.append(p)
    return out


def split_sentences(text):
    out = []
    for part in re.split(r"(?<=[.!?])\s+", text):
        for piece in _hard_wrap(part):
            if piece.strip():
                out.append(piece.strip())
    return out


# ------------------------- TTS chain (Edge -> SAPI floor) -------------------------
async def _edge_bytes(text):
    import edge_tts
    buf = bytearray()
    comm = edge_tts.Communicate(text, EDGE_VOICE, rate=EDGE_RATE, pitch=EDGE_PITCH)
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            buf += chunk["data"]
    return bytes(buf)


def edge_tts_mp3(text):
    return asyncio.run(_edge_bytes(text))


def sapi_tts_wav(text):
    import os
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


_tts_dead = set()


def synth_pcm(text):
    """Chain until a tier yields audio; a failed tier is dropped for this process's life.
    SAPI is local and cannot die, so the voice can never silently mute (v1's failure class)."""
    import soundfile as sf
    last_err = None
    for tier in TTS_CHAIN:
        if tier in _tts_dead:
            continue
        try:
            raw = edge_tts_mp3(text) if tier == "edge" else sapi_tts_wav(text)
            data, sr = sf.read(io.BytesIO(raw), dtype="float32")
            if data.ndim > 1:
                data = data.mean(axis=1)
            return data, sr
        except Exception as e:
            last_err = e
            _tts_dead.add(tier)
    try:
        import soundfile as sf
        data, sr = sf.read(io.BytesIO(sapi_tts_wav(text)), dtype="float32")
        return (data.mean(axis=1) if data.ndim > 1 else data), sr
    except Exception:
        raise RuntimeError(f"all TTS tiers failed; last error: {last_err}")


def speak(text, max_sentences=MAX_SENTENCES):
    """Sanitize + split + speak, pipelined (synthesize ahead while one sentence plays).
    Blocking; returns sentences spoken. Safe for short-lived worker processes."""
    import queue

    import sounddevice as sd
    sentences = split_sentences(clean_for_speech(text))
    if max_sentences:
        sentences = sentences[:max_sentences]
    if not sentences:
        return 0

    audio_q = queue.Queue(maxsize=max(1, TTS_LOOKAHEAD))
    DONE = object()

    def producer():
        try:
            for s in sentences:
                try:
                    audio_q.put(synth_pcm(s))
                except Exception:
                    continue
        finally:
            audio_q.put(DONE)

    t = threading.Thread(target=producer, daemon=True)
    t.start()
    spoken = 0
    while True:
        item = audio_q.get()
        if item is DONE:
            break
        data, sr = item
        sd.play(data, sr)
        sd.wait()
        spoken += 1
    t.join()
    return spoken


def chime(kind="heard"):
    """Short cue tone: 'heard' (low, recording done) or 'ready' (two-tone, recording live)."""
    import numpy as np
    import sounddevice as sd
    sr = 16000
    freqs, dur = ([880, 1320], 0.09) if kind == "ready" else ([660], 0.06)
    tone = np.concatenate([
        0.18 * np.sin(2 * np.pi * f * np.linspace(0, dur, int(sr * dur), False))
        for f in freqs]).astype("float32")
    fade = int(sr * 0.01)
    tone[:fade] *= np.linspace(0, 1, fade)
    tone[-fade:] *= np.linspace(1, 0, fade)
    sd.play(tone, sr)
    sd.wait()


if __name__ == "__main__":
    import sys
    line = " ".join(sys.argv[1:]) or "Voice three chain check. If you hear this, speech out works."
    t0 = time.time()
    n = speak(line)
    print(f"spoke {n} sentence(s) in {time.time() - t0:.1f}s")

#!/usr/bin/env python3
r"""
alex_voice.py - Alex's hands-free two-way voice conversation loop (v2).

You say "hey jarvis" (or just start talking in VAD mode), Alex hears you, thinks,
and talks back in a natural voice while still generating - and you can cut her off
by just speaking. Zero keyboard.

Built 2026-07-07 from research-team run 16 (vault/research/alex-voice-handsfree.md),
Option A "own the whole loop," evolving the v1 loop in place.

--- THE SMART APP CONTROL PIVOT (build-time discovery, 2026-07-07) ---
This ThinkPad runs Windows Smart App Control ENFORCED. SAC blocks unsigned third-party
native binaries from loading. That killed two pieces of the researched plan:
  * faster-whisper -> its PyAV/FFmpeg DLL is unsigned -> blocked. STT stays openai-whisper
    (torch, already proven on this box, multilingual EN/AR/SV).
  * Kokoro local neural TTS -> its espeak-ng phonemizer DLL is unsigned -> blocked.
So the natural voice is Edge-TTS (Microsoft's neural voices over HTTPS - no local binary,
SAC-safe, free, and multilingual so Alex can actually REPLY in Arabic/Swedish, which Kokoro
could not). onnxruntime is Microsoft-signed, so the wake word (openWakeWord) runs fine.
Disabling SAC is a one-way security downgrade and is Shaheen's call, not the build's - the
Kokoro path can be swapped back in later if he ever turns SAC off. See the research page.

Architecture:
  - Wake word: openWakeWord "hey_jarvis" (onnx, SAC-safe) OR open-mic VAD (INPUT_MODE).
  - STT: openai-whisper "base" (local, multilingual, torch - SAC-proven).
  - Brain: ONE persistent `claude` process in stream-json mode = the full Alex (soul.md,
    CLAUDE.md, MCP, vault) loaded once. --include-partial-messages so she starts speaking
    sentence 1 while still writing the rest (talks-while-thinking).
  - TTS: Edge-TTS neural -> Windows SAPI floor. Never-mute chain; SAPI is the can't-die floor.
  - Barge-in: while Alex speaks, the mic is watched; sustained speech stops her and the
    turn tells her she was cut off. Needs the Jabra HEADSET (no echo cancellation) - on
    open speakers her own voice would interrupt her.

Run:   work\voice\talk.ps1      (or: .venv\Scripts\python.exe work\voice\alex_voice.py)
Self-test (no mic, no wake word):  ...python alex_voice.py --selftest
Quit:  Ctrl-C, or say "goodbye Alex" / "quit".
"""

import argparse
import asyncio
import io
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time

import numpy as np
import sounddevice as sd
import soundfile as sf

# ============================= CONFIG (tune here) =============================
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# -- input / hands-free --
INPUT_MODE = "vad"           # "wake" = require the wake word; "vad" = open-mic, just start talking.
                             # vad chosen 2026-07-07 (Shaheen): no "hey alex" pretrained wake model exists,
                             # so open-mic = say her name conversationally ("Alex, ..."). Wants the headset.
WAKE_WORD = "hey_jarvis"     # pretrained openWakeWord model (also: alexa, hey_mycroft, hey_rhasspy).
WAKE_THRESHOLD = 0.5         # 0-1; raise if it triggers on nothing, lower if it misses you.
WAKE_VAD_THRESHOLD = 0.5     # openWakeWord's built-in speech gate (suppresses non-speech activations).

# -- speech in (STT) --
WHISPER_MODEL = "base"       # base = good CPU balance + multilingual (EN/AR/SV). "small" = better/slower.
SAMPLE_RATE = 16000          # Whisper + wake word both want 16k mono.
SILENCE_HANG_S = 0.8         # stop recording after this much quiet once you've started talking.
MAX_RECORD_S = 40            # hard cap per utterance.
MIN_SPEECH_S = 0.35          # ignore blips shorter than this.

# -- speech out (TTS) : the never-mute chain, primary first --
TTS_CHAIN = ["edge", "sapi"]     # Edge neural (natural) -> SAPI (offline floor, can't die). Free/local.
EDGE_VOICE = "en-US-AvaMultilingualNeural"  # warm, natural, MULTILINGUAL (speaks AR/SV too).
                                            # alts: en-US-EmmaMultilingualNeural, en-US-AriaNeural,
                                            # en-US-JennyNeural. Run --voices to hear samples.
EDGE_RATE = "+0%"            # "-10%" slower / "+10%" faster.
EDGE_PITCH = "+0Hz"
TTS_LOOKAHEAD = 2            # sentences synthesized AHEAD while one plays (kills mid-reply gaps).

# -- barge-in (needs the Jabra headset; on speakers Alex interrupts herself) --
BARGE_IN = False             # OFF 2026-07-07 (Shaheen live test): without echo cancellation, open
                             # speakers self-trigger barge-in and every turn died. Re-enable only with
                             # the headset on; the mid-turn drain (speak_stream) now makes that safe.
BARGE_MIN_SPEECH_S = 0.3     # sustained speech this long over threshold = you cut in.

# -- brain --
CLAUDE_MODEL = "sonnet"      # pin the voice brain for LATENCY (2026-07-07). Voice is a snappy
                             # channel: sonnet thinks fast and is plenty for vault lookups.
                             # "haiku" = fastest, "" = whatever the CLI default is (can be slow).
CLAUDE_PERMISSION_MODE = "default"   # "default" is safe. "bypassPermissions" lets a MISHEARD
                                     # command run tools unattended - do not, on a mic channel.
ALLOWED_TOOLS = "Read,Grep,Glob,LS"  # read-only surface so voice-Alex can do vault lookups but
                                     # can't send mail / write files off a mishear. "" = none.
STREAM_PARTIALS = True       # start speaking sentence 1 while the rest still generates.
TURN_TIMEOUT_S = 120         # bail gracefully if a turn stalls (e.g. a permission-gated tool).
VOICE_STYLE = ("This is a live VOICE conversation, spoken aloud, not text. Talk like a person: "
               "one to three short sentences, then STOP and let Shaheen respond. Never lists, "
               "never markdown, never headings. If the real answer is long, give the one-line "
               "version and ask if he wants the rest. Ask at most one question back per turn.")
                             # added 2026-07-07 (live test: "she never stopped talking") - injected
                             # via --append-system-prompt so every turn knows it's a conversation.
VOICE_MAX_SENTENCES = 8      # deterministic seatbelt: hard-stop a reply after this many spoken
                             # sentences even if the model ignores VOICE_STYLE. 0 = no cap.
# NOTE: the old OpenAI TTS tier (v1's gpt-4o-mini-tts, "the original OpenAI mini-based setup")
# was removed 2026-07-07 - it died on quota, was the whole reason v1 got parked, and needed a
# paid key. The chain is now fully free/local: Edge neural over HTTPS with SAPI as the floor.
# =============================================================================


def log(msg):
    print(f"[alex] {msg}", flush=True)


def die(msg):
    print(f"\n[alex] {msg}", file=sys.stderr)
    sys.exit(1)


# ------------------------- text -> speakable chunks -------------------------
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
        out.extend(_hard_wrap(part))
    return out


# ------------------------- speech OUT (TTS chain) -------------------------
async def _edge_bytes(text):
    import edge_tts
    buf = bytearray()
    comm = edge_tts.Communicate(text, EDGE_VOICE, rate=EDGE_RATE, pitch=EDGE_PITCH)
    async for chunk in comm.stream():
        if chunk["type"] == "audio":
            buf += chunk["data"]
    return bytes(buf)


def edge_tts_mp3(text):
    """One chunk -> MP3 bytes via Edge neural voice (free, multilingual, SAC-safe HTTP)."""
    return asyncio.run(_edge_bytes(text))


def sapi_tts_wav(text):
    """One chunk -> WAV bytes via built-in Windows SAPI. Free, offline, robotic, the floor."""
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


_tts_dead = set()   # tiers that failed this session -> skip them for the rest of it


def synth_pcm(text):
    """Run the TTS chain until one tier yields audio. Returns (float32 samples, samplerate).
    A tier that fails is dropped for the session so we don't retry a dead quota every sentence."""
    last_err = None
    for tier in TTS_CHAIN:
        if tier in _tts_dead:
            continue
        try:
            if tier == "edge":
                raw = edge_tts_mp3(text)
            elif tier == "sapi":
                raw = sapi_tts_wav(text)
            else:
                continue
            data, sr = sf.read(io.BytesIO(raw), dtype="float32")
            if data.ndim > 1:
                data = data.mean(axis=1)
            return data, sr
        except Exception as e:
            last_err = e
            log(f"TTS tier '{tier}' failed ({e}); dropping it, falling through.")
            _tts_dead.add(tier)
    # everything in the chain died - last-ditch raw SAPI (not marked dead)
    try:
        data, sr = sf.read(io.BytesIO(sapi_tts_wav(text)), dtype="float32")
        return (data.mean(axis=1) if data.ndim > 1 else data), sr
    except Exception:
        raise RuntimeError(f"all TTS tiers failed; last error: {last_err}")


# ------------------------- mic energy (record + barge-in) -------------------------
def calibrate_threshold():
    log("calibrating mic (stay quiet ~1s)...")
    rec = sd.rec(int(1.0 * SAMPLE_RATE), samplerate=SAMPLE_RATE, channels=1, dtype="float32")
    sd.wait()
    ambient = float(np.sqrt(np.mean(rec ** 2)) + 1e-9)
    thr = max(ambient * 3.0, 0.012)
    log(f"ambient={ambient:.4f}, speech threshold={thr:.4f}")
    return thr


class BargeMonitor:
    """Watches the mic during playback; .triggered goes True on sustained speech.
    Assumes the headset (no echo cancellation) - on speakers Alex's own voice trips it."""
    def __init__(self, threshold):
        self.threshold = threshold
        self.triggered = False
        self._stop = threading.Event()
        self._t = None

    def _run(self):
        import queue
        q = queue.Queue()
        block = int(SAMPLE_RATE * 0.03)
        over = 0.0

        def cb(indata, frames, t, status):
            q.put(indata.copy())

        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32",
                            blocksize=block, callback=cb):
            while not self._stop.is_set():
                try:
                    chunk = q.get(timeout=0.1)
                except queue.Empty:
                    continue
                rms = float(np.sqrt(np.mean(chunk ** 2)) + 1e-9)
                if rms > self.threshold:
                    over += len(chunk) / SAMPLE_RATE
                    if over >= BARGE_MIN_SPEECH_S:
                        self.triggered = True
                        return
                else:
                    over = 0.0

    def start(self):
        self.triggered = False
        self._stop.clear()
        self._t = threading.Thread(target=self._run, daemon=True)
        self._t.start()

    def stop(self):
        self._stop.set()
        if self._t:
            self._t.join(timeout=0.5)


def record_until_silence(threshold, wait_s=6.0):
    """Record from the mic; stop after SILENCE_HANG_S of quiet once you've begun speaking.
    Waits up to wait_s for speech to start (None = wait forever, i.e. open-mic listening) and
    keeps a ~0.4s pre-roll so the first word isn't clipped. Only speech is kept: leading
    silence is trimmed, which also makes Whisper faster (2026-07-07 latency pass)."""
    import queue
    q = queue.Queue()

    def cb(indata, frames, t, status):
        q.put(indata.copy())

    block = int(SAMPLE_RATE * 0.05)
    keep = int(0.4 / 0.05)                    # pre-roll blocks kept from before speech onset
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
                    if over >= 0.15:          # sustained speech = a turn is starting
                        started, t_start = True, time.time()
                        frames = list(preroll)
                else:
                    over = 0.0
                if wait_s is not None and time.time() - t0 > wait_s:
                    break                     # nobody spoke; give up (wake mode)
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
    return np.concatenate(frames).flatten() if frames else np.array([], dtype="float32")


# ------------------------- playback (interruptible) -------------------------
def play_interruptible(samples, sr, monitor):
    """Play one chunk; return True if the barge monitor fired mid-playback."""
    sd.play(samples, sr)
    stream = sd.get_stream()
    while stream is not None and stream.active:
        if monitor is not None and monitor.triggered:
            sd.stop()
            return True
        time.sleep(0.02)
    return False


def speak_stream(sentences, threshold, stop_event=None, max_sentences=None):
    """Consume a stream of sentence strings, speak each, watch for barge-in.
    PIPELINED (2026-07-07, Shaheen's live test: "gaps between sentences are long"): a producer
    thread synthesizes TTS_LOOKAHEAD sentences ahead while the current one PLAYS, so the old
    synth->play->synth serial gap (one Edge round-trip of dead air per sentence) is gone.
    The producer also runs the brain generator to exhaustion even after an interrupt, keeping
    the claude subprocess byte-aligned for the next turn (the same-day desync fix, now built in).
    Returns (interrupted, spoken_count)."""
    import queue
    monitor = BargeMonitor(threshold) if BARGE_IN else None
    if monitor:
        monitor.start()
    audio_q = queue.Queue(maxsize=max(1, TTS_LOOKAHEAD))
    DONE = object()

    def producer():
        try:
            for sentence in sentences:          # exhausting this IS the drain on interrupt
                sentence = (sentence or "").strip()
                if not sentence or (stop_event is not None and stop_event.is_set()):
                    continue
                try:
                    data, sr = synth_pcm(sentence)
                except Exception as e:
                    log(f"could not speak a chunk ({e}); skipping.")
                    continue
                audio_q.put((data, sr))
        finally:
            audio_q.put(DONE)

    prod = threading.Thread(target=producer, daemon=True)
    prod.start()

    spoken = 0
    interrupted = False
    capped = False
    try:
        while True:
            item = audio_q.get()
            if item is DONE:
                break
            if interrupted or capped:
                continue                        # keep draining so the producer never blocks on put
            data, sr = item
            if play_interruptible(data, sr, monitor):
                interrupted = True
                if stop_event is not None:
                    stop_event.set()
            else:
                spoken += 1
                if max_sentences and spoken >= max_sentences:
                    capped = True               # monologue seatbelt: stop speaking, drain silently
                    if stop_event is not None:
                        stop_event.set()
    finally:
        if monitor:
            monitor.stop()
        prod.join()                             # returns once the brain turn is fully read
    return interrupted, spoken


# ------------------------- the Alex brain (persistent claude) -------------------------
class Alex:
    def __init__(self):
        exe = shutil.which("claude") or "claude"
        cli = ["-p", "--input-format", "stream-json", "--output-format", "stream-json",
               "--verbose", "--permission-mode", CLAUDE_PERMISSION_MODE]
        if CLAUDE_MODEL:
            cli += ["--model", CLAUDE_MODEL]
        if VOICE_STYLE:
            cli += ["--append-system-prompt", VOICE_STYLE]
        if STREAM_PARTIALS:
            cli.append("--include-partial-messages")
        if ALLOWED_TOOLS:
            cli += ["--allowedTools", ALLOWED_TOOLS]
        # On Windows `claude` is a .cmd shim; a bare CreateProcess can't launch it (WinError 2),
        # so route .cmd/.bat through cmd.exe. A real .exe launches directly.
        if os.name == "nt" and exe.lower().endswith((".cmd", ".bat")):
            args = ["cmd", "/c", exe] + cli
        else:
            args = [exe] + cli
        self.p = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  cwd=REPO, text=True, encoding="utf-8", bufsize=1,
                                  stderr=subprocess.DEVNULL)
        log("Alex is up (first reply loads MCP + vault; give it a few seconds).")

    def warmup(self):
        """Burn one trivial turn in the background right after boot, so MCP + the vault load
        while Shaheen is still settling in. His first REAL question then skips the ~8s cold
        start and only pays normal thinking time (added 2026-07-07, live-test feedback)."""
        stop = threading.Event()
        try:
            for _ in self.ask_stream("Warm-up ping from the voice loop. Reply with exactly: ok", stop):
                pass
        except Exception:
            pass

    def ask_stream(self, text, stop_event):
        """Yield complete sentences as Alex writes them. Keeps draining stdout to the turn's
        `result` even after stop_event (barge-in) so the process stays aligned for next turn."""
        msg = {"type": "user", "message": {"role": "user", "content": text}}
        self.p.stdin.write(json.dumps(msg) + "\n")
        self.p.stdin.flush()

        buf = ""            # unsent text accumulating toward the next sentence boundary
        full = []           # every text delta, for the non-streaming fallback
        saw_delta = False
        deadline = time.time() + TURN_TIMEOUT_S
        boundary = re.compile(r"(.+?[.!?])(\s+)", re.S)

        def emit_ready():
            nonlocal buf
            while True:
                m = boundary.match(buf)
                if not m:
                    break
                sent = clean_for_speech(m.group(1))
                buf = buf[m.end():]
                for piece in _hard_wrap(sent):
                    if piece:
                        yield piece

        for line in self.p.stdout:
            if time.time() > deadline:
                if not stop_event.is_set():
                    yield "I stalled on that one. Ask me in the main session."
                break
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            t = ev.get("type")
            if t == "stream_event":
                sub = ev.get("event", {})
                if sub.get("type") == "content_block_delta":
                    delta = sub.get("delta", {})
                    if delta.get("type") == "text_delta":
                        piece = delta.get("text", "")
                        if piece:
                            saw_delta = True
                            full.append(piece)
                            if not stop_event.is_set():
                                buf += piece
                                for s in emit_ready():
                                    yield s
                                    if stop_event.is_set():
                                        break
            elif t == "assistant" and not saw_delta:
                # partials off / unsupported: fall back to the whole assistant message.
                for b in ev.get("message", {}).get("content", []):
                    if b.get("type") == "text" and b.get("text"):
                        full.append(b["text"])
                        if not stop_event.is_set():
                            for s in split_sentences(clean_for_speech(b["text"])):
                                yield s
                                if stop_event.is_set():
                                    break
            elif t == "result":
                break
        # flush any trailing partial sentence
        tail = clean_for_speech(buf)
        if tail and not stop_event.is_set():
            for piece in _hard_wrap(tail):
                yield piece

    def close(self):
        try:
            self.p.stdin.close()
            self.p.terminate()
        except Exception:
            pass


# ------------------------- wake word -------------------------
class WakeListener:
    def __init__(self):
        from openwakeword.model import Model
        self.model = Model(wakeword_models=[WAKE_WORD], inference_framework="onnx",
                           vad_threshold=WAKE_VAD_THRESHOLD)
        self.key = next(iter(self.model.models.keys()))

    def wait(self):
        """Block until the wake word is heard. Returns when triggered."""
        import queue
        q = queue.Queue()
        frame = 1280   # 80ms @ 16k, openWakeWord's expected step

        def cb(indata, frames, t, status):
            q.put((indata[:, 0] * 32767).astype(np.int16))

        self.model.reset()
        with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32",
                            blocksize=frame, callback=cb):
            while True:
                chunk = q.get()
                scores = self.model.predict(chunk)
                if scores.get(self.key, 0.0) >= WAKE_THRESHOLD:
                    return


def chime(kind="wake"):
    sr = 16000
    if kind == "wake":
        freqs, dur = [880, 1320], 0.09
    else:
        freqs, dur = [660], 0.06
    tone = np.concatenate([
        0.18 * np.sin(2 * np.pi * f * np.linspace(0, dur, int(sr * dur), False))
        for f in freqs]).astype("float32")
    fade = int(sr * 0.01)
    tone[:fade] *= np.linspace(0, 1, fade)
    tone[-fade:] *= np.linspace(1, 0, fade)
    sd.play(tone, sr); sd.wait()


# ------------------------- STT -------------------------
def transcribe(model, audio):
    result = model.transcribe(audio, fp16=False)
    return (result.get("text") or "").strip()


# ------------------------- device sanity -------------------------
def output_looks_like_speakers():
    try:
        out = sd.query_devices()[sd.default.device[1]]["name"].lower()
        headset_hint = any(k in out for k in ("jabra", "headset", "headphone"))
        speaker_hint = any(k in out for k in ("speaker", "realtek", "laptop"))
        return speaker_hint and not headset_hint
    except Exception:
        return False


# ------------------------- self-test (no mic, no wake word) -------------------------
def selftest():
    print("=" * 64)
    print(" Alex Voice v2 self-test  (no mic / no wake word needed)")
    print("=" * 64)
    ok = True

    print("\n[1/4] TTS chain -> decode -> play a line...")
    try:
        t0 = time.time()
        data, sr = synth_pcm("Self test. If you can hear this, the voice pipeline works.")
        dt = time.time() - t0
        print(f"      synth+decode OK in {dt:.2f}s ({len(data)/sr:.1f}s of audio @ {sr}Hz)")
        sd.play(data, sr); sd.wait()
        print("      played to the default output device.")
    except Exception as e:
        ok = False; print(f"      FAIL: {e}")

    print("\n[2/4] STT round-trip (TTS a known phrase, transcribe it back)...")
    try:
        import whisper
        m = whisper.load_model(WHISPER_MODEL)
        phrase = "the quick brown fox jumps"
        data, sr = synth_pcm(phrase)
        if sr != SAMPLE_RATE:  # linear resample to 16k for whisper
            n = int(len(data) * SAMPLE_RATE / sr)
            data = np.interp(np.linspace(0, len(data), n, False),
                             np.arange(len(data)), data).astype("float32")
        heard = transcribe(m, data).lower()
        hit = sum(w in heard for w in phrase.split()) >= 3
        print(f"      heard: '{heard}'  -> {'OK' if hit else 'WEAK (check mic/model)'}")
        ok = ok and hit
    except Exception as e:
        ok = False; print(f"      FAIL: {e}")

    print("\n[3/4] Wake word model loads + runs inference...")
    try:
        wl = WakeListener()
        wl.model.predict((np.random.randn(1280) * 500).astype(np.int16))
        print(f"      openWakeWord '{wl.key}' loaded + predicted (onnx, SAC-safe).")
    except Exception as e:
        ok = False; print(f"      FAIL: {e}")

    print("\n[4/4] Brain: one real turn through the persistent claude process...")
    try:
        alex = Alex()
        stop = threading.Event()
        t0 = time.time()
        first = None
        got = []
        for s in alex.ask_stream("In one short sentence, say hi to Shaheen as Alex.", stop):
            if first is None:
                first = time.time() - t0
            got.append(s)
        alex.close()
        print(f"      first sentence in {first:.1f}s; full reply: {' '.join(got)[:160]}")
    except Exception as e:
        ok = False; print(f"      FAIL: {e}")

    print("\n" + "=" * 64)
    print(" SELF-TEST:", "ALL PASS - ready for the live mic test." if ok else "SOME FAILURES (see above).")
    print("=" * 64)
    return ok


def voices_demo():
    """Generate short samples of the candidate voices so Shaheen can pick one."""
    outdir = os.path.join(REPO, "outputs", "voice", "samples")
    os.makedirs(outdir, exist_ok=True)
    line = "Hey Shaheen, it's Alex. This is the voice you'd be talking to. Which one sounds right?"
    cands = ["en-US-AvaMultilingualNeural", "en-US-EmmaMultilingualNeural",
             "en-US-AriaNeural", "en-US-JennyNeural"]
    global EDGE_VOICE
    for v in cands:
        EDGE_VOICE = v
        try:
            data, sr = synth_pcm(line)
            sf.write(os.path.join(outdir, f"{v}.wav"), data, sr)
            print(f"  wrote {v}.wav")
        except Exception as e:
            print(f"  {v} FAIL: {e}")
    print(f"\nSamples in {outdir} - listen and set EDGE_VOICE at the top of alex_voice.py.")


# ------------------------- main loop -------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true", help="verify the stack without a mic")
    ap.add_argument("--voices", action="store_true", help="write voice samples to outputs/voice/samples")
    args = ap.parse_args()

    if args.selftest:
        sys.exit(0 if selftest() else 1)
    if args.voices:
        voices_demo(); sys.exit(0)

    print("=" * 64)
    print(f"  Alex Voice v2  -  hands-free  ({'wake word: say \"hey jarvis\"' if INPUT_MODE=='wake' else 'open mic: just talk'})")
    print("  Ctrl-C to quit.  Say 'goodbye Alex' to end by voice.")
    print("=" * 64)
    if BARGE_IN and output_looks_like_speakers():
        log("HEADS UP: output looks like speakers, not the headset. Barge-in may make Alex")
        log("          cut herself off. Put the Jabra on, or set BARGE_IN=False.")

    log(f"loading Whisper '{WHISPER_MODEL}'...")
    import whisper
    model = whisper.load_model(WHISPER_MODEL)

    wake = WakeListener() if INPUT_MODE == "wake" else None
    threshold = calibrate_threshold()
    alex = Alex()
    warm = threading.Thread(target=alex.warmup, daemon=True)  # cold start hides behind the greeting
    warm.start()

    # greet
    speak_stream(iter(["Hey Shaheen. I'm here."]), threshold)

    try:
        while True:
            if INPUT_MODE == "wake":
                log('waiting for "hey jarvis"...')
                wake.wait()
                chime("wake")
                audio = record_until_silence(threshold)
            else:
                log("listening (just talk)...")
                audio = record_until_silence(threshold, wait_s=None)  # open mic; pre-roll keeps word 1
            if audio.size < SAMPLE_RATE * MIN_SPEECH_S:
                continue
            chime("done")            # the heard-you cue: she's transcribing + thinking now
            you = transcribe(model, audio)
            if not you:
                continue
            print(f"  you: {you}")
            if re.search(r"\b(goodbye alex|quit|shut down)\b", you.lower()):
                speak_stream(iter(["Later, Shaheen. Siga siga."]), threshold)
                break
            warm.join()              # first turn only; instant no-op after that
            stop = threading.Event()
            interrupted, spoken = speak_stream(alex.ask_stream(you, stop), threshold, stop,
                                               max_sentences=VOICE_MAX_SENTENCES or None)
            if interrupted:
                print("  (you cut in)")
    except KeyboardInterrupt:
        pass
    finally:
        alex.close()
        print("\n[alex] later, Shaheen. Siga siga.")


if __name__ == "__main__":
    main()

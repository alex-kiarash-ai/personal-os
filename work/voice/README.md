# Alex Voice v2 - hands-free

Two-way, hands-free voice conversation with Alex. Built 2026-07-07 from
[[research/alex-voice-handsfree]] (research-team run 16, Option A "own the whole loop").
You just talk (open mic, no wake word by default), a chime confirms she heard you, and Alex thinks
and talks back in a natural voice, sentence by sentence, as the FULL Alex (soul.md + vault + read-only
tools, loaded once and kept alive across the conversation). English, Arabic, Swedish. Zero keyboard.

**State: ON-DEMAND - the adopted voice solution (2026-07-07).** This is `alex_voice.py`; it replaced
v1 (OpenAI TTS, push-to-talk) and the abandoned Kokoro/faster-whisper plan. Human overview:
`docs/projects/voice.md`. Registry: `work/18-recovery-layer/manifest.json` (`meta.unnumbered[0]`).

## Run it
Three ways, same loop:
- **Double-click "Alex Voice"** on the Desktop (shortcut added 2026-07-07; targets the venv python
  directly, no PowerShell needed).
- **Ctrl+Alt+A** from anywhere (the shortcut's global hotkey).
- Terminal: `work\voice\talk.ps1` (uses the venv automatically).

Deliberately NOT auto-started at login (Shaheen 2026-07-07): open-mic mode means an always-on session
would turn room noise into Claude calls. Launch on demand, end with "goodbye Alex" or Ctrl-C.
**Headset optional now.** Barge-in is OFF by default (2026-07-07): open speakers were self-triggering
it and killing every turn. With it off, she finishes each reply cleanly and speakers are fine. Only
put the Jabra on + set `BARGE_IN=True` if you specifically want to cut her off mid-sentence.

Verify the stack first (no mic needed, plays one line aloud):
```
work\voice\.venv\Scripts\python.exe work\voice\alex_voice.py --selftest
```
Pick a voice (writes samples to `outputs/voice/samples/`, then set `EDGE_VOICE`):
```
work\voice\.venv\Scripts\python.exe work\voice\alex_voice.py --voices
```

## Controls (all hands-free)
- **just talk** - open-mic is the default (`INPUT_MODE = "vad"`, set 2026-07-07). No wake word: start
  talking and she records; recording stops when you go quiet. Her name is conversational ("Alex, ...").
- **talk over Alex** - OFF by default (`BARGE_IN=False`). Turn it on only with the headset; the
  mid-turn drain in `speak_stream` keeps the brain aligned so interrupting no longer kills the next turn.
- **"goodbye Alex"** / **"quit"** - end by voice. Or Ctrl-C.
- Want a wake word instead? Set `INPUT_MODE = "wake"` at the top of `alex_voice.py`. openWakeWord ships
  no "hey alex" (only `hey_jarvis`, `alexa`, `hey_mycroft`, `hey_rhasspy`); a real "Hey Alex" needs a
  custom-trained `.onnx` (Colab, SAC-safe) - not built yet.

## The stack (all local/free, all Smart-App-Control-safe)
- **Wake word:** openWakeWord "hey_jarvis" (ONNX, runs under SAC). Or open-mic VAD.
- **Speech in:** local **openai-whisper "base"** - multilingual (EN/AR/SV), nothing leaves the box.
- **Brain:** ONE persistent `claude` process (stream-json) = the full Alex, soul.md + MCP + vault
  loaded once. `--include-partial-messages` so she starts talking on sentence 1 while still writing.
  Read-only tools only (`Read,Grep,Glob,LS`) so a misheard command can't send mail or write files.
- **Speech out (never-mute chain):** **Edge-TTS** neural voice (free, natural, multilingual) ->
  **Windows SAPI** offline floor. Any tier that fails is dropped for the session; the SAPI floor is
  local and can't die, so Alex never goes silent. (The OpenAI paid tier that v1 used was removed
  2026-07-07 - it kept dying on quota, which is what got voice parked in the first place.)
- **Barge-in:** OFF by default. When on (+headset), the mic is watched while she speaks; ~0.3s of
  sustained speech stops her and the next turn tells her she was cut off.

## Why this differs from the researched plan (the Smart App Control pivot, 2026-07-07)
The research picked local **Kokoro** TTS + **faster-whisper** STT. At build time we found this
ThinkPad runs **Smart App Control ENFORCED**, which blocks unsigned third-party native binaries:
- faster-whisper's PyAV/FFmpeg DLL -> blocked. STT stayed on openai-whisper (already proven, torch).
- Kokoro's espeak-ng phonemizer DLL -> blocked. So the natural voice became **Edge-TTS** (neural
  voices over HTTPS, no local binary). Bonus: Edge speaks **Arabic and Swedish**, which Kokoro could
  not - so Alex can now REPLY in all three languages, not just understand them.
- onnxruntime is Microsoft-signed, so the wake word runs fine.

Disabling SAC is a one-way security downgrade and is **Shaheen's call, not the build's.** If he ever
turns it off, the Kokoro fully-offline path can be swapped back in (the chain design already supports
adding a tier). Cost stayed **$0/mo**. Full record: [[research/alex-voice-handsfree]] + error-log 2026-07-07.

## Config knobs (top of `alex_voice.py`)
`INPUT_MODE` (wake/vad) · `WAKE_THRESHOLD` · `TTS_CHAIN` · `EDGE_VOICE` · `EDGE_RATE`/`EDGE_PITCH` ·
`TTS_LOOKAHEAD` · `WHISPER_MODEL` (base/small) · `SILENCE_HANG_S` · `BARGE_IN` · `BARGE_MIN_SPEECH_S` ·
`STREAM_PARTIALS` · `CLAUDE_MODEL` (sonnet; "haiku"=fastest) · `CLAUDE_PERMISSION_MODE` ·
`ALLOWED_TOOLS` · `TURN_TIMEOUT_S`.

## Conversation pass (2026-07-07, live test round 2: "she never stopped talking")
- **Voice style prompt** (`VOICE_STYLE`, via `--append-system-prompt`): every turn knows it's a SPOKEN
  conversation - 1-3 short sentences, no lists/markdown, offer the long version instead of dumping it.
  Verified: "explain everything my personal OS does" now gets 4 sentences + a question back, not a report.
- **Monologue seatbelt** (`VOICE_MAX_SENTENCES=8`): deterministic hard-stop if the model ignores the
  style prompt; the rest of the reply is drained silently so the brain stays aligned.
- **Usage note:** every voice turn draws from the same Claude plan as interactive sessions (one
  persistent session; context grows per turn). Short replies are also cheaper - the rambling was
  burning output tokens. Brain is pinned to `CLAUDE_MODEL="sonnet"`, unaffected by the CLI /model default.

## Latency pass (2026-07-07, from Shaheen's live-test feedback)
His verdict on v2.0: answers took too long, gaps between sentences too long. Fixes, all measured:
- **Sentence gaps gone:** TTS is pipelined - a producer thread synthesizes `TTS_LOOKAHEAD` sentences
  ahead while one plays, so the Edge round-trip overlaps playback instead of being dead air
  (3-sentence reply: 13.5s serial -> 9.7s, i.e. ~pure audio time).
- **First answer faster:** the brain warms up in the BACKGROUND at boot (the ~8s MCP+vault cold start
  hides behind the greeting) and is pinned to `CLAUDE_MODEL="sonnet"` for thinking speed
  (first sentence ~3s after your question, measured post-warmup).
- **The heard-you chime:** a short low chime right after you stop talking = she got it, she's thinking.
  Silence after the chime is thinking time, not a hang.
- **Recorder:** keeps a 0.4s pre-roll (your first word isn't clipped), trims leading silence
  (faster Whisper), `SILENCE_HANG_S` 0.9 -> 0.8.

## Cost model (and how it won't silently die like v1)
- **Free / local:** speech-in (openai-whisper), the wake word (openWakeWord), and the SAPI fallback
  voice all run on the ThinkPad, no key, no network, no cost.
- **Free / cloud:** Edge-TTS has no key or account; it only sends Alex's spoken REPLY text to Microsoft
  over HTTPS (never the vault, never your input). Needs internet.
- **The real cost = the brain.** Every turn is a live Claude call on the SAME plan as a Claude Code
  session. One persistent session per launch, so context (and per-turn cost) grows the longer you talk.
  Mitigations baked in: replies forced to 1-3 sentences + hard-capped (`VOICE_MAX_SENTENCES`), model
  pinned to `sonnet`, and launch-on-demand (never always-on, so room noise can't rack up calls).
- **The old failure mode is designed out.** v1 went MUTE when its paid OpenAI TTS quota died. v2's floor
  is local SAPI, which cannot die, so the voice cannot silently stop the way v1 did. What CAN degrade:
  if internet drops, Edge is skipped and you get the robotic-but-working SAPI voice (that IS the warning
  sign); if `claude` isn't on PATH or the plan is exhausted, the brain turn fails and she says so.

## Dependencies, credentials, settings
- **Credentials: NONE.** No API keys, no `.env`, no OpenAI key (removed 2026-07-07). The only external
  identity used is your existing `claude` CLI login (the brain) - nothing voice-specific to rotate.
- **On PATH:** the `claude` CLI (the persistent brain). Windows `.cmd` shim is handled.
- **Python venv** at `work/voice/.venv` (gitignored, ~342MB, `--system-site-packages`), packages:
  `edge-tts`, `openwakeword`, `onnxruntime`, `sounddevice`, `soundfile`, plus global `openai-whisper` +
  `torch`. No `openai`, `kokoro`, `faster-whisper`, or `ctranslate2` (all removed/never needed).
- **OS bits:** Windows SAPI (built in, the floor voice); a working mic + output device.
- **All config knobs** live at the top of `alex_voice.py` (see the list above).

## Verify it works (no mic needed)
```
work\voice\.venv\Scripts\python.exe work\voice\alex_voice.py --selftest
```
Four checks, all should PASS: TTS chain plays a line aloud -> STT round-trip -> wake-word model
loads -> one real streaming brain turn. Green here = the stack is healthy.

## Troubleshoot
- **No launch / window flashes shut:** run `talk.ps1` from a terminal to see the error. Usually the
  venv is missing (rebuild, see Environment) or `claude` isn't on PATH.
- **She sounds robotic:** Edge-TTS failed (no internet, or Microsoft hiccup) and she fell back to SAPI.
  Check the connection; it self-heals next launch.
- **She never hears me / doesn't start recording:** ambient threshold is off. It calibrates at boot -
  relaunch in a quiet moment, or nudge `SILENCE_HANG_S` / speak a beat louder.
- **She cuts herself off with no one talking:** you're on speakers with `BARGE_IN=True`. It's off by
  default now; if you turned it on, use the headset or set it back to `False`.
- **Long pause after the chime:** that's brain thinking time (2-10s), not a hang. The chime = heard you.
- **She rambles:** `VOICE_MAX_SENTENCES` caps it; lower it, or tighten `VOICE_STYLE`.
- **First answer slow:** the background warm-up hides the ~8s cold start behind the greeting - if you
  ask before the greeting finishes you still pay some of it. Deeper issues -> `vault/projects/error-log.md`.

### Acceptance test (you, one sitting, zero keyboard)
1. Launch (shortcut / Ctrl+Alt+A / `talk.ps1`) -> hear "Hey Shaheen. I'm here."
2. **Just talk** ("Alex, what's my runway zero-date?"), go quiet -> chime -> natural-voice answer in ~3-5s.
3. Ask a follow-up that refers back -> she remembers (proves the stateful brain).
4. Say one **Swedish** and one **Arabic** sentence -> both transcribed; she can reply in them.
5. Say **"goodbye Alex"** -> she signs off.

## Honest limits (v2)
- **2-10s brain floor** per turn (Claude thinking) - partials mask it, nothing removes it.
- **Barge-in needs the headset** (no acoustic echo cancellation built).
- Edge-TTS sends only Alex's spoken REPLY text to Microsoft (never the vault, never your input);
  needs internet (so does the brain). If Edge breaks, SAPI floor keeps her talking.
- Wake word is openWakeWord's pretrained "hey jarvis" (upstream frozen since 2024; the model works).

## Environment
Python 3.12 venv at `work/voice/.venv` (gitignored, 342MB, reuses the global torch/whisper via
`--system-site-packages`). Rebuild: `python -m venv .venv --system-site-packages` then
`pip install onnxruntime edge-tts openwakeword` (+ the global whisper/sounddevice/soundfile).

## v1 -> v2 (what changed)
v1 was push-to-talk (Enter) + Esc interrupt + OpenAI TTS (died on quota) with a robotic SAPI
fallback - parked on voice quality. v2: hands-free wake word, natural free multilingual voice with a
never-mute chain, voice barge-in, and talks-while-thinking. The persistent-brain transport and the
sentence-chunked interruptible playback carried over from v1 unchanged.

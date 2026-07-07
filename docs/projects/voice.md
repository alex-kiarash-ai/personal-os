# Voice (unnumbered, on-demand)

## What it actually does
A hands-free, two-way spoken conversation with Alex, running on the ThinkPad. You just talk (open
mic, no button, no wake word), a short chime confirms she heard you, and a few seconds later she talks
back in a warm natural voice, sentence by sentence, in Alex's personality. It is the full Alex brain
behind it, not a stripped-down assistant: soul.md, the vault, and read-only tools, loaded once and
kept alive across the whole conversation, so she remembers what you said three turns ago. She
understands and can reply in English, Arabic, and Swedish.

## Why it exists
Typing is a bottleneck for half of Shaheen's thoughts, and the Alex HQ note-drop is one-way (you leave
a note, no reply). This is the conversational lane: same brain, no keyboard, real back-and-forth.

## The tool we use (and what replaced what)
The current tool is `work/voice/alex_voice.py` (v2), built 2026-07-07. It stitches together four free/
local pieces: **openWakeWord** (optional wake word, ONNX), **openai-whisper** for speech-to-text (local,
nothing leaves the box), **one persistent `claude` process** as the brain, and **Edge-TTS** (Microsoft's
neural voices over HTTPS) for the voice, with the built-in **Windows SAPI** voice as an automatic
never-go-silent fallback.

Two earlier attempts were removed:
- **v1, the OpenAI mini-based setup** (push-to-talk + OpenAI `gpt-4o-mini-tts`): it kept dying when the
  OpenAI credits ran out, which is what got voice parked in the first place. Gone.
- **The failed Kokoro / faster-whisper install** (the researched v2 plan): blocked at runtime by Windows
  Smart App Control, which refuses to load their unsigned native audio DLLs. Abandoned mid-build and
  pivoted to Edge-TTS, which is signed-safe, free, and a bonus speaks Arabic and Swedish (Kokoro could
  not). Its only leftover, an orphaned `ctranslate2` package, was uninstalled 2026-07-07.

## What it costs
Effectively free to run, with one thing to watch:
- **Speech-in (Whisper), the wake word, and the SAPI fallback voice are 100% local and free.**
- **Edge-TTS is free** (no key, no account) but sends only Alex's spoken reply text to Microsoft over
  the internet. If it ever breaks, the local SAPI voice takes over automatically, so she never goes mute.
- **The brain is the real cost: every turn is a live Claude call on the same plan as a normal Claude Code
  session.** A long spoken conversation burns tokens like a long chat would. This is exactly why her
  replies are now forced short (1-3 sentences) and hard-capped, and why the tool is launch-on-demand,
  not always-on: an always-listening mic would quietly turn room noise into paid Claude calls.

The old failure mode is designed out: v1 went silent when a paid quota died. v2's floor (SAPI) is local
and cannot die, so the voice output cannot silently stop the way v1 did.

## Current state: ON-DEMAND (adopted 2026-07-07 as the voice solution)
Un-parked and adopted after Shaheen's live testing and a same-day tuning pass (latency, sentence gaps,
the "she never stops talking" fix, and a one-click launcher). Launch it three ways: the **"Alex Voice"
desktop shortcut**, the **Ctrl+Alt+A** global hotkey, or `work\voice\talk.ps1`. Deliberately not started
at login. Full technical spec, config knobs, verify steps, and troubleshooting live in
`work/voice/README.md`.

## Works together with
- **soul.md and the vault** - the persistent Claude process is the full Alex, not a generic assistant.
- **[Alex HQ](16-alex-hq.md)** - HQ's "Drop a note to Alex" card is the async, one-way capture lane;
  voice is the live, two-way lane. Same brain, different channel.

# Voice (unnumbered; v3 in-session since 2026-07-12)

## What it actually does
You talk to the actual Claude Code session you are working in, and it talks back. Hold
Space (with the prompt empty), speak (English or Swedish), release: your words appear in
the prompt, you read them, you press Enter. Press Ctrl+Alt+D instead to speak Arabic (or any of the three
languages) through the local Whisper model, which types the words into the prompt for you.
Either way, when the voice flag is on, Alex speaks every reply out loud in a warm neural
voice. One brain, the real session, no separate voice assistant.

## Why it exists
Typing is a bottleneck for half of Shaheen's thoughts. Two earlier voice builds ran a
SEPARATE Alex brain next to the working session; v2 also proved crash-prone (a long-lived
audio process with a fragile pipe). The 2026-07-12 research run (three agents, one
adversarial elimination) found that Anthropic had quietly shipped native voice dictation
inside Claude Code itself, which flipped the answer: stop building a voice assistant,
wire voice INTO the session.

## How v3 is put together (and why it doesn't crash)
- **Speech in (EN/SV):** Claude Code's own `/voice` in HOLD mode. Free, no tokens,
  maintained by Anthropic. Audio streams to Anthropic's servers for transcription (that
  is the one privacy trade; the Arabic lane below is fully local).
- **Speech in (AR/SV/EN, local):** the Ctrl+Alt+D dictate lane, reusing v2's proven
  Whisper code. It types the transcript and NEVER presses Enter; with auto-accept
  permissions on this machine, a misheard sentence must never be able to execute, so a
  human Enter is the law in both input lanes.
- **Speech out:** a Stop hook hands each reply to a tiny worker process that speaks it
  (Edge-TTS neural voice, Windows SAPI as the cannot-die fallback) and exits. Gated on a
  flag file: say "voice on" / "voice off" to Alex.
- The v2 crash classes are designed out by lifecycle: nothing audio-related lives longer
  than one utterance or one reply.

## What it costs
$0/month. Native dictation is free and consumes no Claude tokens; Whisper and SAPI are
local; Edge-TTS is free (sends only Alex's reply text to Microsoft). Voice turns are
normal session turns, so they cost exactly what typing the same prompt would.

## Current state
- **v3 (in-session): the voice solution.** Always armed via settings + hooks; passive
  until you hold the key or turn the speak flag on. Live gates G1-G4 (mic tests) run with
  Shaheen; everything testable headlessly passed 2026-07-12.
- **v2 (`alex_voice.py`): parked as the walk-around tool.** The only open-mic hands-free
  lane (launch on demand: "Alex Voice" shortcut / Ctrl+Alt+A). Its separate brain and its
  crash surfaces are why it is no longer the primary.
Full spec, config, troubleshooting: `work/voice/README.md`. Decision record:
`vault/research/alex-voice-in-session.md` (research-team run 22).

## Works together with
- **soul.md and the vault** - it is the real working session, so voice gets the full Alex.
- **The soul corpus** - /voice dictations arrive as typed prompts (captured by the typed-
  input hook); the dictate lane appends raw spoken lines to outputs/voice/transcripts/.
- **[Alex HQ](16-alex-hq.md)** - HQ's note-drop stays the async phone lane; v3 is the
  live at-the-desk lane.

# Alex Voice - Cheatsheet (which mode, when)

One page. Full detail in `README.md` (v3) + the v2 section. Decision record: [[research/alex-voice-in-session]] (v3, run 22), [[research/alex-voice-handsfree]] (v2, run 16).

## Which mode do I want?

```
Am I in a Claude Code session, want to talk to THIS session?
├─ YES → v3 (in-session). It's the default since 2026-07-12.
│   ├─ English or Swedish, dictate into the prompt → hold Space on an EMPTY prompt (/voice HOLD).
│   │    The transcript lands in the prompt. YOU read it and press Enter. (autoSubmit is OFF, on purpose.)
│   ├─ Arabic / any language, or per-utterance control → Ctrl+Alt+D (local whisper dictate lane).
│   │    Two-tone chime = talk now; it types the transcript in, never presses Enter.
│   └─ Want Alex to SPEAK replies back → say "voice on" (creates outputs/voice/voice-on.flag;
│        the Stop hook reads the first 8 sentences aloud, Edge-TTS → SAPI, never mutes). "voice off" stops it.
│
└─ NO, I want to walk around / hands-free, no keyboard → v2 (alex_voice.py, the on-demand loop).
     Launch: work/voice/talk.ps1 or Ctrl+Alt+A from the Desktop. Open-mic, "hey jarvis" wake or VAD,
     "goodbye Alex" to exit. Separate brain (read-only tools). $0/mo, all local + free Edge-TTS.
```

## The two things that trip people up
- **v3 never auto-submits.** You always press Enter yourself. This is the non-negotiable pairing with acceptEdits (a mishear must not execute). If that feels like friction, it's the safety, not a bug.
- **The VS Code integrated terminal swallows Space-HOLD** (and the old Ctrl+Space rebind). Use a standalone terminal (Windows Terminal) for `/voice`, or `/voice tap` instead of HOLD. Ctrl+Alt+D works anywhere.

## Cost + privacy
$0/month, both versions. Speech OUT = Edge-TTS (free, no key) with a local SAPI floor. Speech IN: `/voice` HOLD transits Anthropic's servers (native dictation); Ctrl+Alt+D + v2 use LOCAL whisper (nothing leaves the box). Spoken lines are the PRIMARY soul-corpus source (`outputs/voice/transcripts/`), tagged `[dictate:lang]` for the local lane.

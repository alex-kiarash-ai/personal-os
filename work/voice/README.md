# Alex Voice

Two-way, interruptible voice conversation with Alex. Built 2026-07-05 from [[research/alex-voice-conversation]] (research-team run 13).

Replaces the old **one-way Stop-hook** setup (`speak.ps1` + `speak-hook.ps1` + `play.ps1`) that just read the finished message aloud. Those old files are slated for deletion once Shaheen confirms this new loop works (see "Migration" below).

## Run it
```
python work/voice/alex_voice.py      # from anywhere (path is self-locating)
```
or double-run `work/voice/talk.ps1`. **Wear the headphones** (Jabra) so Alex's voice doesn't leak into the mic.

## Controls
- **Enter** - start talking. Recording auto-stops when you go quiet (~1.2s of silence).
- **Esc** - cut Alex off while she's speaking (barge-in).
- **q + Enter** (or Ctrl-C) - quit.

## How it works
- **One persistent `claude` process** in stream-json mode = the full Alex brain (soul.md persona, CLAUDE.md, MCP, vault) loaded ONCE. Measured: per-turn `claude -p` was 5-11s; keeping the process warm avoids that.
- **Local Whisper** (`base`) for speech-in. Nothing leaves the box.
- **Sentence-by-sentence TTS** so the first audio starts fast and each chunk is interruptible.

## Voice options (`TTS_BACKEND` at the top of the script)
- `"sapi"` (default) - built-in Windows voice. **Free, offline, works now, but robotic.**
- `"openai"` - the "sage" gpt-4o-mini-tts Alex voice (~$10/mo). **Needs OpenAI credits.** As of 2026-07-05 the OpenAI account is out of quota (`insufficient_quota`), which is also why the old hook died. Once topped up, flip this to `"openai"`. It auto-falls back to SAPI if the account is dry, so Alex never goes silent.
- Future: local **Kokoro** for a good offline voice (deferred - benchmark on this 15W CPU first).

## v1 honest limits (roadmap = v2)
- Barge-in is the **Esc key**, not hands-free "just start talking" voice barge-in (v2 needs a mic-monitor thread + the headphones).
- Inside one turn, Alex still **finishes generating text before speaking** (a Stop-hook-class limit). True "talks while thinking" needs the `claude -p --stream-json --include-partial-messages` partial path (Tier 2) - only worth it if the wait annoys.
- Input is **push-to-talk** (Enter), not always-listening.
- `CLAUDE_PERMISSION_MODE = "default"` - if Alex needs a tool that wants permission, the turn will time out gracefully (90s) and tell you to use the main session. Set `"bypassPermissions"` only if you want voice-Alex to run tools unattended (risky: a misheard command).

## Config knobs (top of `alex_voice.py`)
`TTS_BACKEND`, `WHISPER_MODEL` (base/small), `TTS_VOICE`, `SILENCE_HANG_S`, `MAX_RECORD_S`, `CLAUDE_PERMISSION_MODE`, `TURN_TIMEOUT_S`.

## Migration (old -> new) - DONE 2026-07-05
Shaheen confirmed the new loop ("good enough"), so the old one-way infra was deleted:
- removed `work/voice/speak.ps1`, `speak-hook.ps1`, `play.ps1`, `hook.log`
- removed the `hooks.Stop` entry in `.claude/settings.json` (Claude Code REPL no longer auto-speaks; voice is now this on-demand loop)
- reclaimed `outputs/voice/` (289MB of old mp3s)

`TTS_BACKEND` is now `"openai"` (the sage voice; Shaheen is topping up credits) with automatic SAPI fallback.

# Explainer lane (free narrated video)

Item 3 of the AI-guide upgrade plan ([[research/alex-upgrade-from-ai-guide]]). A $0 text-to-video lane: branded slide PNGs + per-slide narration in, one narrated MP4 out. Built for teaching n8n (priority 4) and Alex Kit marketing (priority 3).

**Status: a LIGHT tool, not a registered project.** Per the run-36 master call, this stays a tool at `work/voice/explainer/` until it earns repeated use; only then does it get promoted to a numbered project (`#31`) via `/new`. No manifest entry, no HQ ticket, no cron.

## What it reuses (nothing new bought)
- **Voice:** Edge-TTS, the neural voice Alex already owns, via `work/voice/v3/tts_chain.py` (`edge_tts_mp3` + `clean_for_speech`). Free, multilingual. It lives in `work/voice/.venv`, NOT the global Python.
- **Video:** `ffmpeg` + `ffprobe` (already installed).
- **Slides:** any 1920x1080 PNGs. The demo builds them as branded HTML rendered by headless Chrome; a polished public deck could come from Claude Design (DesignSync) instead. The tool does not care where the PNGs come from.
- The paid alternatives (ElevenLabs, HeyGen, Runway) are deliberately banked, see [[research/ai-tool-landscape]].

## Run it (MUST use the voice venv)
```
work/voice/.venv/Scripts/python.exe work/voice/explainer/make-explainer.py <spec.json> [--out <path.mp4>] [--keep-scratch]
```
`spec.json`:
```json
{
  "title": "alex-in-60s",
  "resolution": [1920, 1080],
  "fps": 30,
  "slides": [
    { "image": "slide-01.png", "narration": "First line. Second line." }
  ]
}
```
Image paths resolve relative to the spec file. Default output: `outputs/explainer/YYYY-MM-DD/<title>.mp4`.

## The demo (worked example)
`demo/` holds the source: `slide-01..03.html` + `spec.json` (the "Alex in about a minute" explainer). The PNGs are regenerated, not checked in. To rebuild them:
```
for n in 01 02 03; do
  "/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --hide-scrollbars \
    --force-device-scale-factor=1 --window-size=1920,1080 \
    --screenshot="<ABSOLUTE path>\work\voice\explainer\demo\slide-$n.png" \
    "file:///<ABSOLUTE path>/work/voice/explainer/demo/slide-$n.html"
done
```
(Chrome needs an ABSOLUTE Windows path for `--screenshot`; a relative path fails with Access denied.) Then run the tool on `demo/spec.json`. First proof: `outputs/explainer/2026-07-24/alex-in-60s.mp4` (48.7s, $0).

## Guardrails (from the run-36 QC)
- `clean_for_speech()` runs BEFORE synthesis, so the soul.md no-em-dash rule (em-dash to comma) reaches the audio, not just the on-screen text.
- **Fail-loud, no partial artifact.** Everything builds in a scratch dir; only the VERIFIED final MP4 is moved into `outputs/`. Any failure removes scratch and exits non-zero. (Proven on the first run: a 6.4s mux drift from `-loop 1 -shortest` overshoot was caught by the verify step and refused, then fixed by forcing each segment to its measured audio length with `-t`.)
- **Never touches the audio device.** It only streams MP3 bytes (`edge_tts_mp3`), so it cannot disturb live voice-out even if that fires at the same time. The voice module is stateless.
- Identity output: slides + narration are visual + voice, so the Brand + Soul Pre-Flight Gate applies (run it, print the line) before generating.

## Reversibility
Delete `work/voice/explainer/`. No manifest entry, no cron, no generated surface. Outputs are gitignored.

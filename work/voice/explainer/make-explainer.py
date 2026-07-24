#!/usr/bin/env python3
r"""
make-explainer.py - Alex free narrated-explainer lane (Item 3 of the AI-guide upgrade plan).

$0 text-to-video: branded slide PNGs + per-slide narration -> one narrated MP4.
Reuses the voice Alex ALREADY owns (Edge-TTS in work/voice/.venv, via work/voice/v3/tts_chain.py)
and ffmpeg/ffprobe. No paid key. The paid stack (ElevenLabs / HeyGen / Runway) is deliberately
banked, see vault/research/ai-tool-landscape.md.

RUN ON THE VOICE VENV (edge-tts is not global):
  work/voice/.venv/Scripts/python.exe work/voice/explainer/make-explainer.py <spec.json>

spec.json:
  {
    "title": "alex-in-60s",
    "resolution": [1920, 1080],          # optional, default 1920x1080
    "fps": 30,                            # optional, default 30
    "slides": [
      {"image": "slides/slide-01.png", "narration": "First line. Second line."},
      ...
    ]
  }
  Image paths are resolved relative to the spec file. Narration is spoken as-is after the
  soul.md speech sanitizer (clean_for_speech: strips markdown/URLs, em-dash -> comma).

GUARDRAILS (from the run-36 QC, work/.../05-agent3-qc-report.md):
- clean_for_speech() is called BEFORE synthesis, so the no-em-dash voice rule reaches the audio.
- Fail-loud, no partial artifact: everything is built in a scratch dir and only the VERIFIED
  final MP4 is moved into outputs/. Any failure removes scratch and exits non-zero; outputs/
  never receives a half-muxed file.
- Never touches the audio device (edge_tts_mp3 only streams bytes), so it cannot disturb
  live voice-out even if that fires concurrently.
"""

import sys
import os
import json
import shutil
import tempfile
import subprocess
import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]                     # work/voice/explainer -> repo root
V3 = HERE.parent / "v3"                     # work/voice/v3 (tts_chain.py)
sys.path.insert(0, str(V3))


def die(msg, scratch=None, keep=False):
    print(f"ERROR: {msg}", file=sys.stderr)
    if scratch and not keep:
        shutil.rmtree(scratch, ignore_errors=True)
    sys.exit(1)


def run(cmd):
    """Run a subprocess, raise with stderr on failure."""
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError(f"cmd failed ({p.returncode}): {' '.join(str(c) for c in cmd)}\n{p.stderr[-800:]}")
    return p.stdout


def ffprobe_duration(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "format=duration",
               "-of", "default=noprint_wrappers=1:nokey=1", str(path)])
    return float(out.strip())


def ffprobe_streams(path):
    out = run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type",
               "-of", "default=noprint_wrappers=1:nokey=1", str(path)])
    return [s.strip() for s in out.splitlines() if s.strip()]


def main():
    args = sys.argv[1:]
    keep = "--keep-scratch" in args
    args = [a for a in args if a != "--keep-scratch"]
    out_override = None
    if "--out" in args:
        i = args.index("--out")
        out_override = args[i + 1]
        del args[i:i + 2]
    if not args:
        die("usage: make-explainer.py <spec.json> [--out <path.mp4>] [--keep-scratch]")

    spec_path = Path(args[0]).resolve()
    if not spec_path.exists():
        die(f"spec not found: {spec_path}")
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    spec_dir = spec_path.parent

    title = spec.get("title", spec_path.stem)
    W, H = spec.get("resolution", [1920, 1080])
    fps = int(spec.get("fps", 30))
    slides = spec.get("slides", [])
    if not slides:
        die("spec has no slides")

    # reuse the voice module (imports edge_tts lazily inside edge_tts_mp3)
    try:
        from tts_chain import clean_for_speech, edge_tts_mp3
    except Exception as e:
        die(f"cannot import tts_chain from {V3} (run on work/voice/.venv): {e}")

    scratch = Path(tempfile.mkdtemp(prefix="explainer_"))
    try:
        seg_paths = []
        total_narr = 0.0
        for idx, sl in enumerate(slides, 1):
            img = (spec_dir / sl["image"]).resolve()
            if not img.exists():
                raise FileNotFoundError(f"slide {idx} image not found: {img}")
            narr = clean_for_speech(sl.get("narration", ""))
            if not narr:
                raise ValueError(f"slide {idx} narration is empty after sanitizing")

            print(f"[slide {idx}/{len(slides)}] synth narration ({len(narr)} chars)...")
            mp3 = edge_tts_mp3(narr)               # <-- reuses the voice; sanitized above
            if not mp3:
                raise RuntimeError(f"slide {idx}: Edge-TTS returned no audio (network?)")
            audio = scratch / f"audio-{idx:02d}.mp3"
            audio.write_bytes(mp3)
            dur = ffprobe_duration(audio)
            total_narr += dur

            seg = scratch / f"seg-{idx:02d}.mp4"
            vf = (f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
                  f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=#001219,setsar=1,format=yuv420p")
            run(["ffmpeg", "-y", "-loop", "1", "-i", str(img), "-i", str(audio),
                 "-vf", vf, "-r", str(fps),
                 "-c:v", "libx264", "-tune", "stillimage", "-preset", "medium",
                 "-c:a", "aac", "-b:a", "192k", "-ar", "44100",
                 # force the segment to exactly the audio length: -loop 1 + -shortest
                 # can overshoot the still-image encode by a GOP, which concat-sums into drift
                 "-t", f"{dur:.3f}", "-shortest", "-movflags", "+faststart", str(seg)])
            seg_paths.append(seg)
            print(f"[slide {idx}/{len(slides)}] {dur:.1f}s -> {seg.name}")

        # concat (identical codec params across segments -> stream copy is safe)
        listf = scratch / "concat.txt"
        listf.write_text("".join(f"file '{p.as_posix()}'\n" for p in seg_paths), encoding="utf-8")
        final = scratch / f"{title}.mp4"
        run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(listf),
             "-c", "copy", "-movflags", "+faststart", str(final)])

        # verify before it is allowed anywhere near outputs/
        streams = ffprobe_streams(final)
        fdur = ffprobe_duration(final)
        if "video" not in streams or "audio" not in streams:
            raise RuntimeError(f"final missing a stream: {streams}")
        if abs(fdur - total_narr) > 1.5:
            raise RuntimeError(f"final duration {fdur:.1f}s != narration total {total_narr:.1f}s (mux drift)")
        print(f"[verify] final ok: {fdur:.1f}s, streams={streams}")

        if out_override:
            out = Path(out_override).resolve()
        else:
            day = datetime.date.today().isoformat()
            out = REPO / "outputs" / "explainer" / day / f"{title}.mp4"
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(final), str(out))
        print(f"DONE: {out}  ({fdur:.1f}s, {len(slides)} slides, $0)")
    except Exception as e:
        die(str(e), scratch=scratch, keep=keep)
    else:
        if not keep:
            shutil.rmtree(scratch, ignore_errors=True)


if __name__ == "__main__":
    main()

const MAX_BYTES = 15 * 1024 * 1024; // ~2 min of audio with headroom

export async function POST(req: Request) {
  const base = process.env.HQ_WEBHOOK_BASE;
  const token = process.env.ALEX_HQ_TOKEN;
  if (!base || !token) {
    return Response.json({ ok: false, error: "not configured" }, { status: 500 });
  }
  let audio: Blob | null = null;
  try {
    const form = await req.formData();
    const f = form.get("audio");
    if (f instanceof Blob) audio = f;
  } catch {
    // fall through to the missing-audio check
  }
  if (!audio || audio.size === 0) {
    return Response.json({ ok: false, error: "no audio" }, { status: 400 });
  }
  if (audio.size > MAX_BYTES) {
    return Response.json({ ok: false, error: "audio too large" }, { status: 413 });
  }
  try {
    const fwd = new FormData();
    const name = audio instanceof File && audio.name ? audio.name : "note.webm";
    fwd.append("audio", audio, name);
    const res = await fetch(`${base}/alex-note-voice`, {
      method: "POST",
      headers: { "X-Alex-Token": token },
      body: fwd,
    });
    const data = await res.json().catch(() => ({ ok: res.ok }));
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ ok: false, error: "backend unreachable" }, { status: 502 });
  }
}

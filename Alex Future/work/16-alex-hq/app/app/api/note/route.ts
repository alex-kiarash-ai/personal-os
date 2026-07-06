export async function POST(req: Request) {
  const base = process.env.HQ_WEBHOOK_BASE;
  const token = process.env.ALEX_HQ_TOKEN;
  if (!base || !token) {
    return Response.json({ ok: false, error: "not configured" }, { status: 500 });
  }
  let text = "";
  try {
    const body = await req.json();
    text = String(body?.text ?? "").trim();
  } catch {
    // fall through to the empty-note check
  }
  if (!text) return Response.json({ ok: false, error: "empty note" }, { status: 400 });
  try {
    const res = await fetch(`${base}/alex-note`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Alex-Token": token },
      body: JSON.stringify({ text: text.slice(0, 4000) }),
    });
    const data = await res.json().catch(() => ({ ok: res.ok }));
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ ok: false, error: "backend unreachable" }, { status: 502 });
  }
}

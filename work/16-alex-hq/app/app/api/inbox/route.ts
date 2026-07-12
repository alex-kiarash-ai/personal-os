// Thin GET proxy to the n8n inbox list, mirroring /api/note's token-holding pattern:
// HQ_WEBHOOK_BASE + ALEX_HQ_TOKEN stay server-side, the browser never sees the token.
// notes.tsx polls this (visibilitychange + 60s while visible) so voice/typed rows close
// their loop; server rows are truth and merge over optimistic local ones once they arrive.
// Fail-calm: an unreachable backend returns a non-200 the client keeps its current list on.
export async function GET() {
  const base = process.env.HQ_WEBHOOK_BASE;
  const token = process.env.ALEX_HQ_TOKEN;
  if (!base || !token) {
    return Response.json({ ok: false, error: "not configured" }, { status: 500 });
  }
  try {
    const res = await fetch(`${base}/alex-inbox`, {
      headers: { "X-Alex-Token": token },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({ ok: res.ok }));
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ ok: false, error: "backend unreachable" }, { status: 502 });
  }
}

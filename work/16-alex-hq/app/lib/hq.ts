import type { Summary, Metric, Inbox } from "./types";

export async function getSummary(): Promise<Summary | null> {
  const url = process.env.HQ_SUMMARY_URL;
  const token = process.env.ALEX_HQ_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(url, {
      headers: { "X-Alex-Token": token },
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    return (await res.json()) as Summary;
  } catch {
    return null;
  }
}

export function metric(s: Summary | null, project: string, key: string): Metric | null {
  return s?.projects?.[project]?.metrics?.[key] ?? null;
}

export async function getInbox(): Promise<Inbox | null> {
  const base = process.env.HQ_WEBHOOK_BASE;
  const token = process.env.ALEX_HQ_TOKEN;
  if (!base || !token) return null;
  try {
    const res = await fetch(`${base}/alex-inbox`, {
      headers: { "X-Alex-Token": token },
      next: { revalidate: 30 },
    });
    if (!res.ok) return null;
    return (await res.json()) as Inbox;
  } catch {
    return null;
  }
}

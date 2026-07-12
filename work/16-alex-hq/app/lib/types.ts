export type Status = "green" | "amber" | "red";

export type Metric = {
  value_num: number | null;
  value_text: string;
  headline: string;
  status: Status;
  ts: string;
  history: { ts: string; value_num: number | null }[];
};

export type Project = {
  project: string;
  metrics: Record<string, Metric>;
  last_ts: string | null;
  status: Status;
};

export type Summary = {
  generated_at: string;
  row_count: number;
  projects: Record<string, Project>;
};

/* static /data JSON shapes (producers: n8n_liveness.py, build-todos.mjs, build-life.mjs).
   Moved out of dashboard.tsx in the P9 component extraction - same shapes, relocated. */
export type N8nList = {
  generated_at: string;
  active_count: number;
  workflows: { name: string; id: string; last_exec: string | null; status: string; broken_reason: string | null }[];
};
export type TodosData = {
  generated_at: string;
  snapshot_date: string;
  items: { task: string; status: string; since: string }[];
};
export type LifeData = {
  generated_at: string;
  gym: { start_date: string; interval_days: number; label: string; as_of: string | null };
  plants: { as_of: string | null; items: { name: string; every_days: number; last_watered: string }[] };
};
/* projects.json (build-projects.mjs, from the project registry): the full roster so the health
   board shows EVERY registered project, not just the ones pushing telemetry. hq_slug links a
   project to its live metrics; null = it pushes none (renders as an honest idle ticket). */
export type RegProject = {
  name: string;
  num: number | null;
  title: string;
  state: string;
  trigger: string;
  one_liner: string;
  hq_slug: string | null;
  /* cadence-as-data (upgrade P4, 2026-07-12): the registry's cadence object + first-fire proof.
     Nullable so a stale projects.json (pre-P4) degrades to the old 48h fallback, never crashes. */
  cadence?: Cadence | null;
  first_fire?: string | null;
  first_fire_kind?: "live" | "drill" | null;
};
export type ProjectsData = { generated_at: string; count: number; projects: RegProject[] };

export type InboxNote = {
  id: number;
  note: string;
  source: string;
  status: string;
  filed_to: string;
  ts: string;
  audio: string;
};

export type Inbox = {
  generated_at: string;
  count_new: number;
  new: InboxNote[];
  recent: InboxNote[];
};

export function ageLabel(ts: string | null | undefined, now: number): string {
  if (!ts) return "never";
  const ms = now - new Date(ts).getTime();
  if (ms < 0) return "just now";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Deterministic absolute stamp, Europe/Stockholm: "2026-07-06 14:28".
// formatToParts + manual assembly (raw toLocaleString risks locale-data drift between
// node and browser) — pure function of the ts string, no `now`, hydration-safe.
const DT_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function fmtDateTime(ts: string | null | undefined): string {
  if (!ts) return "never";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "–";
  const p: Record<string, string> = {};
  for (const part of DT_PARTS.formatToParts(d)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// Short day stamp, Europe/Stockholm: "Mon 06 Jul" - for the weekly-cadence tile stamps
// (design 4.2 "weekly · last Mon DD"). Same formatToParts discipline as fmtDateTime.
const DAY_STAMP_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  weekday: "short",
  day: "2-digit",
  month: "short",
});
export function fmtDay(ts: string | null | undefined): string {
  if (!ts) return "never";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "–";
  const p: Record<string, string> = {};
  for (const part of DAY_STAMP_PARTS.formatToParts(d)) p[part.type] = part.value;
  return `${p.weekday} ${p.day} ${p.month}`;
}

// Whole days between a YYYY-MM-DD date and `now`'s Stockholm calendar day (positive = past).
// `now` comes from the server prop, so server and client compute the same value.
const DAY_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function daysSinceStockholm(dateStr: string, now: number): number {
  const p: Record<string, string> = {};
  for (const part of DAY_PARTS.formatToParts(new Date(now))) p[part.type] = part.value;
  const today = Date.UTC(+p.year, +p.month - 1, +p.day);
  const [y, m, d] = dateStr.split("-").map(Number);
  return Math.round((today - Date.UTC(y, m - 1, d)) / 86400000);
}

// Some producers pushed middots with broken encoding; never render the replacement char.
// Null-safe: the contract says value_text/headline are optional, one bad row must never blank the page.
export function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/�/g, "·");
}

// Deterministic formatter (same output on server and client, thin no-break space)
export function fmtNum(n: number | null): string {
  if (n === null || n === undefined) return "–";
  const neg = n < 0;
  const abs = Math.abs(n);
  const rounded = Number.isInteger(n) ? abs : Math.round(abs * 100) / 100;
  const [int, dec] = String(rounded).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return (neg ? "-" : "") + grouped + (dec ? "," + dec.padEnd(2, "0").slice(0, 2) : "");
}

// One-liners for the health-board drill-down: what each automation does.
export const DESCRIPTIONS: Record<string, string> = {
  "morning-brief": "Daily 08:00 brief: unread mail, calendar, life ops and context, filtered to what matters.",
  "app-engine-bi": "The BI job engine. Daily 07:00 on the Hetzner box: sources Power BI roles, scores fit, writes a tailored CV + cover letter, renders PDFs to Drive. Never auto-submits.",
  "app-engine-ai": "The AI-role twin of the BI engine. Daily 07:30, same box, same gates, targets AI and automation roles with the AI CV.",
  "email-triage": "Three times a day: classifies unread mail into Act Now / Read Later / Archive and drafts replies in Shaheen's voice behind a hard gate.",
  "linkedin-series": "Building Alex, the LinkedIn series. Episodes drafted from real project history, approval gate, Tue/Thu staging to Drive. Posting stays manual.",
  airbnb: "Tracks an Airbnb hosting operation from the Gmail feed: bookings, arrivals, payouts, income.",
  radar: "Weekly Monday sweep of new AI tools, models and opportunities, matched against real friction in this system.",
  crm: "The relationship engine: scores contacts, builds the Monday follow-up list, stages voice-matched drafts. Never sends.",
  expenses: "Receipt capture into Notion plus a branded Excel with real formulas. Monthly close on the last day.",
  sprint: "Weekday 09:00 standup from the Notion build board: what moved, velocity, stale rows.",
  "meeting-intel": "Pre-meeting dossiers and post-meeting processing of any dropped file into notes, action items and follow-ups.",
  "content-machine": "Three-agent content pipeline: research, write, edit. Platform-native posts in Shaheen's voice.",
  "whatsapp-harvest": "Read-only WhatsApp harvest via the official desktop client: voice corpus and people context.",
  "weekly-exec": "Friday 16:00 capstone: aggregates every automation into a branded weekly report.",
  infra: "The local harvest: MCP tool count, vault size, scheduled jobs, brain graph sync from the ThinkPad.",
  "alex-hq": "This dashboard. Metrics ingest, summary API and the notes inbox, all on the Hetzner box.",
  health: "Apple Watch sleep and steps off the iPhone: a nightly Alex Sleep Score (0-100, from sleep stages) and yesterday's step count, pushed daily by a native iOS Shortcut to the box.",
};

// The stack Alex runs on — rendered in the Alex Brain drill-down.
export const STACK: { name: string; what: string }[] = [
  { name: "Claude Code", what: "the engine: runs the whole OS from the terminal, every automation is a session" },
  { name: "Vault (Obsidian)", what: "the brain: a wiki of linked pages, the permanent memory everything writes to" },
  { name: "n8n on Hetzner", what: "the night shift: live workflows for both job engines, HQ backend, life ops write-back" },
  { name: "MCP servers", what: "the hands: Gmail, Calendar, Drive, Notion, Power BI, browser, all as callable tools" },
  { name: "Task Scheduler", what: "Windows jobs that fire the daily automations, with retry ladders" },
  { name: "Whisper, local", what: "voice notes transcribed on the ThinkPad, zero cloud, zero cost" },
  { name: "Next.js PWA", what: "this dashboard: Docker beside n8n, Caddy TLS, basic auth, installable on the phone" },
  { name: "Cloudflare", what: "DNS for shaheenkiarash.com and the hq subdomain" },
  { name: "GitHub", what: "nightly 21:30 backup of the whole OS to a private repo, secrets excluded" },
  { name: "Bright Data", what: "LinkedIn job sourcing for both engines" },
  { name: "Google Workspace", what: "Sheets ledgers, Drive PDFs, the Gmail feeds everything reads" },
  { name: "Gotenberg", what: "HTML to PDF rendering inside the pipeline" },
  { name: "Postgres + Caddy", what: "n8n's database and the TLS front door on the box" },
];

/* ---------- cadence model (upgrade P4, 2026-07-12) ----------
   The CADENCE_HOURS hand map is DELETED: cadence is registry data now. Every projects.json row
   (build-projects.mjs, from system/manifest.json) carries
   { cadence: { expected_hours, label, note? }, first_fire, first_fire_kind } and the render
   rules per class live in design 4.2:
   - daily / weekdays / always-on: fresh = "today HH:MM"; amber past expected_hours
     (weekdays skip Stockholm weekends); red only when the producer itself pushed red.
   - weekly: "weekly · last {day}"; amber only past 8 days.
   - monthly: "monthly · {note}"; NEVER amber mid-cycle.
   - on-demand / event / dormant / parked / retired (expected_hours null): never stale by age;
     "never fired" when a LIVE/EVENT project has first_fire null. */
export type Cadence = { expected_hours: number | null; label: string; note?: string | null };

// Age in hours with weekend hours removed (for weekdays-cadence producers): a Friday-morning run
// read on Monday morning is on schedule, not ~71h stale. UTC day boundaries are used (Stockholm
// wobbles ±2h around them - irrelevant at 26h staleness granularity); pure function of (ts, now),
// hydration-safe. Windows past 90 days skip the subtraction (stale is stale).
export function weekdayAgeHours(ts: string, now: number): number {
  const from = new Date(ts).getTime();
  if (Number.isNaN(from)) return Infinity;
  const DAY = 86400000;
  const raw = (now - from) / 3600000;
  if (now - from > 90 * DAY || now <= from) return raw;
  let weekendMs = 0;
  for (let t = Math.floor(from / DAY) * DAY; t < now; t += DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) {
      const overlap = Math.min(t + DAY, now) - Math.max(t, from);
      if (overlap > 0) weekendMs += overlap;
    }
  }
  return (now - from - weekendMs) / 3600000;
}

// The one staleness rule (design 4.2), shared by tiles and the health board. No cadence data
// (registry not synced, or an unclaimed live slug) falls back to the pre-registry 48h rule.
export function cadenceStale(cad: Cadence | null | undefined, ts: string | null | undefined, now: number): boolean {
  const ageH = ts ? (now - new Date(ts).getTime()) / 3600000 : Infinity;
  if (!cad) return ageH > 48;
  if (cad.expected_hours == null) return false; // on-demand/event/dormant/parked/retired: never stale by age
  if (cad.label === "monthly") return false; // never amber mid-cycle
  if (cad.label === "weekly") return ageH > 8 * 24; // amber only past 8 days
  if (!ts) return true; // a producing cadence with no event at all is stale
  const eff = cad.label === "weekdays" ? weekdayAgeHours(ts, now) : ageH;
  return eff > cad.expected_hours;
}

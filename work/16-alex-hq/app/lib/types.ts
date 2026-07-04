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

export const CADENCE_HOURS: Record<string, number> = {
  "morning-brief": 26,
  "app-engine-bi": 26,
  "app-engine-ai": 26,
  "email-triage": 12,
  "linkedin-series": 96,
  airbnb: 26,
  radar: 192,
  crm: 192,
  expenses: 800,
  sprint: 80,
  infra: 26,
  "alex-hq": 800,
  me: 100000,
};

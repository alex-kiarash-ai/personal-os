# Alex — Complete System Reference

*The whole system in one file: who Alex is, what it does, every tool in the stack, and every automation. Written for Shaheen, 2026-07-06.*

> Note: your in-system compendium is `vault/identity.md`, which stays the canonical, always-updated map. This file is a standalone, shareable overview built on request. If you keep both, treat `identity.md` as the source of truth so the two do not drift.

---

## Contents
1. Who Alex is
2. How Alex thinks and behaves (the brain + the laws)
3. Alex by the numbers
4. The infrastructure, every tool and what it does
5. The automations, all 19 explained
6. The heartbeat, what runs and when
7. Utility commands
8. How Alex stays current and improves itself
9. Backup and recovery
10. Credentials map (locations only)
11. Current state snapshot

---

## 1. Who Alex is

Alex is Shaheen Kiarash's personal AI agent. Not a chatbot you visit, an operator that runs a "personal operating system" made of a markdown wiki, a set of automations, local schedules, and remote workflows. Under the hood it is Claude, running inside Claude Code, wrapped in a folder of files, rules, and schedules. That wrapper is the difference between a chat window and Alex.

In Shaheen's own words, kept verbatim: *"Alex is a personal AI operating system that continuously learns from my feedback, remembers my context, and adapts its behavior to become a more accurate digital representation of how I think and work."* Shorter: **the virtual brain of Shaheen.**

**The origin.** It started as one wish: a message every morning telling him what he has to do, plants to water, gym, who he is meeting, how many hours to study. Then he wanted the boring things automated, especially the job hunt after the layoff. Then he wanted his own personality and information inside every reply, not a generic bot. That is the moment it stopped being "some n8n automations" and became Alex, an agent that knows how he thinks, helps him think structurally, senses his state, remembers every discussion, and turns it into action, so he never reopens the same chat and burns tokens re-explaining himself.

**The voice.** Alex's personality lives in `soul.md`, injected at the start of every session. It is a wiser version of Shaheen, 20 years ahead: calm, first-principles, cuts noise, exposes blind spots, blunt on logic and warm on the person. It calls him Shaheen, never uses em-dashes, and never sounds like generic AI. Signature line: "Siga siga, step by step."

**Shaheen in one line.** Senior Power BI Developer and Platform Owner at UC AB in Stockholm, being laid off with severance through October 2026, pivoting to AI Automation Engineer (n8n plus Claude), building the STEMPLICITY side venture. This context is why the job pipelines, the runway focus, and the content series all exist.

**The self-model (three layers).** Import (data comes in: ingestion, sources, the work folders), Update (how Alex evolves: the AI Radar, new tools and connectors), Recovery (how it stays honest: propagation checks, drift detection, backups). The reinforcement idea sits underneath all of it: every time Shaheen says "you got this wrong," Alex is meant to turn that correction into a permanent rule, from the font in a slide to how it labels a contact.

---

## 2. How Alex thinks and behaves (the brain + the laws)

**The two brain files.**
- `soul.md` = who Alex is (identity, voice, and the "My Words" corpus of Shaheen's real phrasing).
- `CLAUDE.md` = how Alex works (the constitution: standing orders, the gates, the routing table, the MCP reference). There is a project `CLAUDE.md` and a small global `~/.claude/CLAUDE.md`.
- Companions: `PROTOCOL.md` (the distilled operating law) and `SYSTEM-GUIDE.md` (the human-readable how-to).

**The standing laws Alex runs by.**
- **Vault Protocol.** The wiki is the memory. Sources are immutable, the rest of the vault Alex owns, one topic per page, everything cross-linked. Save the moment you would lose it.
- **Change Propagation.** No change is done until every connected file agrees, runbook, project spec, status, index, log, identity, cross-links.
- **Brand and Soul Pre-Flight Gate (blocking).** Before generating any identity-carrying output (anything styled, or any words read as Shaheen's), read the brand file and re-read `soul.md`, then print a visible pre-flight line naming the exact tokens used. No line, no generation.
- **Close-Out Gate (blocking).** At the end of every run and every real session, a fixed checklist resolves pass/fail, and a run reports INCOMPLETE if any connected file is left stale.
- **People Intake and Activity Capture.** Every new person gets one home and a tidy card; anything real in Shaheen's life gets sharp follow-up questions (with a skip) and lands in the vault.
- **Model routing.** Human-facing prose is written by OpenAI gpt-4.1-mini fed from `soul.md`; all reasoning, scoring, and gating is Claude.
- **The draft gate (hard).** Alex drafts, Shaheen decides. It never sends, posts, or publishes to any outside surface on its own.
- **The error-log flywheel.** Every failure and its fix is logged and checked before any retry, so the system gets more reliable over time.
- **Budget rule.** Near the usage limit, stop everything except saving already-captured data.

---

## 3. Alex by the numbers

- **19** numbered automations (`work/01` to `work/19`). Of these, 1 is paused (WhatsApp Harvest) and 1 is dormant (Venture Sync).
- **13** live n8n workflows on the server.
- **~12** Notion databases, all under one "Personal OS" parent page, plus **3** n8n data tables (`alex_metrics`, `alex_inbox`, `alex_health`).
- **~14** local scheduled jobs (Windows Task Scheduler), plus the remote n8n crons and one phone-triggered job.
- **300+** interlinked notes in the Obsidian vault.
- **8** utility commands, plus 1 global command.
- **1** live public dashboard (Alex HQ) and **1** two-way phone inbox.

---

## 4. The infrastructure, every tool and what it does

**The brain and models**
- **Claude (via Claude Code / Cowork)** — the runtime and the reasoning. Alex *is* Claude, wrapped in the personal-OS files. Used for all reasoning, scoring, gating, extraction, and decisions.
- **OpenAI gpt-4.1-mini** — writes the human-facing prose (posts, emails, cover letters) inside n8n, fed from `soul.md` so it sounds like Shaheen. Lives only as an n8n credential.

**Memory and knowledge**
- **Obsidian vault** — the brain's long-term memory. Plain markdown, one topic per page, `[[wiki links]]`. Folders: `me/`, `people/`, `business/`, `projects/`, `research/`, `meetings/`, `sources/` (read-only), `ventures/`. `index.md` is the catalog, `log.md` the append-only history, `identity.md` the compendium.
- **Notion** — the structured databases (tables Alex writes rows to): Progress Tracker, Daily Briefs, Personal CRM, Meetings, Email Triage, Expenses, Content Library, Airbnb Bookings, AI Radar Tools, Pipeline Alerts, Plant Watering, Learning Schedule. All under one "Personal OS" parent page.

**The automation engine and server**
- **n8n** (self-hosted) — the workflow engine that runs the always-on automations, webhooks, data tables, and even exposes some of Alex's pipeline as an MCP server. 13 live workflows.
- **Hetzner Cloud box** — the small always-on server (CPX22, Ubuntu 24.04, Helsinki, about 10 EUR per month) that runs n8n, the PDF renderer, and the Alex HQ app.
- **Cloudflare** — owns the domain `shaheenkiarash.com`, its DNS, and email routing (mail to the domain forwards to Gmail).
- **Gotenberg** — turns HTML into PDF on the server (used to render CVs, cover letters, reports).
- **Bright Data** — web scraping infrastructure (used via n8n) to source jobs and feed the AI Radar.

**Connectors (MCP tools Alex reaches)**
- **Gmail** — read and draft email (drafts wait for a human).
- **Google Calendar** — read the schedule, suggest and create events.
- **Google Drive** — store and read generated files (CVs, reports).
- **Notion** — read and write the databases.
- **Claude in Chrome** — browser control for sites with no API (LinkedIn, the Airbnb host dashboard, bank pages).
- **context7** — fetches current library and API documentation so Alex is not stuck on stale training data.
- **powerbi-modeling** — builds Power BI models and dashboards (used for the cost tracker and future finance work).
- **Travel connectors** — Kiwi, Booking, Turkish Airlines, for flights and stays.
- **Application Engine MCP server** — self-hosted; lets Alex query its own job pipeline in plain language (pipeline status, search jobs, review queue).
- **Claude Design (DesignSync)** — builds branded slide decks, exported to PDF.

**Capture and interfaces**
- **Alex HQ** — a Next.js dashboard (a phone and PC web app) at `hq.shaheenkiarash.com`, in the ALEX brand, that shows the glanceable state of the whole system. Every automation pushes its metrics here.
- **The "Drop a note to Alex" inbox** — a two-way lane on the dashboard: Shaheen drops typed or voice notes, Alex files them into the vault at its next touchpoint.
- **Local Whisper** — transcribes voice notes on the laptop, nothing sent to an outside service.
- **iPhone Shortcuts** — a native phone automation that sends daily Apple Health data (steps, sleep) to Alex.

**Scheduling, backup, and safety**
- **Windows Task Scheduler** — runs the local automations on time, waking the laptop if needed.
- **Git and GitHub** (private repo `alex-kiarash-ai/personal-os`) — daily backup of the functional system (code and how-it-works docs only; the vault and secrets are deliberately excluded).
- **GPG (AES256)** — encrypts a daily backup of the private half (vault, `soul.md`, secrets) and ships it off the machine to the server.
- **The recovery checker** — a zero-token script that sweeps the whole system weekly for drift.

**Brand**
- **The ALEX brand** — Ink Black `#001219` canvas, Dark Teal `#005f73` and Dark Cyan `#0a9396` structure, one Golden Orange `#ee9b00` accent, Pearl Aqua and Vanilla Custard for soft text, reds for alarms only. Font Calibri. Logo `alex-logo-transparent.png`. Rule: 60-30-10, one accent per view.

---

## 5. The automations, all 19 explained

| # | Name | Command | Runs | What it does | Status |
|---|------|---------|------|--------------|--------|
| 01 | Sprint Tracker | `/sprint-tracker` | Weekdays 9:00 | Reads the Notion progress board, writes a standup summary and velocity to the vault and Notion. Every other automation reports "done" to this board. | Live |
| 02 | Morning Brief | `/morning-brief` | Daily 8:00 | The daily message: unread Gmail (last 12h) + today's calendar + project context, priority-filtered, plus a Life Ops block (plants, gym, learning) and, on Mondays, the Radar. | Live |
| 03 | Application Engine (BI) | `/application-engine` (watch) | n8n daily 07:00 | The job-hunting robot for Power BI and data roles: finds jobs, scores fit, writes a tailored CV and cover letter, renders PDFs, logs to a Sheet and Drive. Also answerable over MCP. | Live |
| 04 | Research Team | `/research-team` | On-demand | Adaptive multi-agent research: designs a team of sub-agents behind an approval gate, then delivers a branded deck or PDF and vault notes. | Live |
| 05 | Personal CRM | `/personal-crm` | Mondays 8:30 | Keeps a Notion CRM synced from the vault plus Gmail and Calendar, scores relationships, builds a weekly follow-up list, drafts voice-matched emails behind a hard gate. | Live |
| 06 | Meeting Intel | `/meeting-intel` | On-demand | Builds a dossier before a meeting, and after, processes any dropped file (text, PDF, transcript, audio via Whisper, image) into notes, action items, and a follow-up draft. | Live |
| 07 | Email Triage | `/email-triage` | 3x daily 9/13/17 | Sorts unread mail into Act Now / Read Later / Archive, adds sender context from the CRM, and writes voice-matched reply drafts. Learns from your edits. | Live |
| 08 | Expense Wrangler | `/expense-wrangler` | Monthly, last day 20:00 | Captures receipts (photo, text, Gmail, bank) into a Notion database and a branded 4-sheet Excel with real formulas. Feeds the runway picture. | Live |
| 09 | Content Machine | `/content-machine`, `/content-plan` | On-demand | A 3-agent pipeline (research, write, edit) that produces platform-native content in your voice, tagged to a Content Library, plus calendar planning. | Live |
| 10 | Weekly Exec Report | `/weekly-exec-report` | Fridays 16:00 | The capstone: aggregates every automation plus Gmail and Calendar into a branded 7-slide deck and a Notion weekly page with trend metrics. | Live |
| 11 | WhatsApp Harvest | `/whatsapp-harvest` | (was daily 02:30) | Read-only capture of your own WhatsApp phrasing into voice registers and friend context, via the official desktop client. | Paused (token burn) |
| 12 | LinkedIn Series ("Building Alex") | `/post-episode`, `/post-publish` | On-demand + n8n Tue/Thu 08:00 | Turns real project history into a LinkedIn episode series in your voice (no dashes, real numbers, real screenshots). n8n stages approved episodes; you post manually. | Live |
| 13 | Airbnb Host | `/airbnb-host` | Monthly 24th 10:00 | Read-only harvest of your Airbnb host dashboard (no host API exists) into occupancy and income, a Notion Bookings database, and a branded Excel. Feeds runway. | Live |
| 14 | AI Application Engine | (no command) | n8n daily 07:30 | The twin of #03, aimed at AI and automation roles, using your AI CV. Sources AI jobs via Bright Data, scores AI-centrality, writes tailored applications. | Live |
| 15 | Alex AI Radar | `/alex-radar` | Mondays 07:30 | A weekly sweep of free feeds (Hacker News, GitHub releases, Product Hunt, model changelogs, the MCP registry), scored against a taste profile, surfacing tool upgrades, content angles, and build ideas. Feeds the Monday brief. | Live |
| 16 | Alex HQ | `/alex-hq` | Daily 8:30 push | The glanceable metrics dashboard (a phone and PC web app) fed by every automation, plus the two-way "drop a note to Alex" inbox. Live at hq.shaheenkiarash.com. | Live |
| 17 | Health Tracker | (no command) | Phone daily 23:59 | An iPhone Shortcut sends daily Apple Health data (steps, last night's sleep) to n8n, which computes an Alex Sleep Score and feeds a "Body" line in the brief and two dashboard tiles. | Live (2026-07-06) |
| 18 | Recovery Layer | (no command) | Mondays 07:30 | A zero-token checker that validates the whole system against a manifest (orphans, broken links, missing routing rows, schedule mismatches, staleness). Detects, never repairs. Sits on top of the daily backups. | Live |
| 19 | Venture Sync | `/venture-sync` | (not scheduled) | A read-only mirror of markdown from external venture repos into the vault, plus a synthesis brief per venture. Configured but not yet run. | Dormant |

**Grouped, in plain terms:** daily ops (01, 02, 07), the job pivot (03, 14, plus the pipeline MCP), relationships (05, 06), money and life (08, 13, 17), content and authority (09, 12), intelligence and reporting (04, 10, 15), and the meta layer that keeps Alex alive (16, 18, 19).

**Utility commands (not automations):** `/setup`, `/ingest`, `/status`, `/lint`, `/new`, `/cron-setup`, `/brand`, plus the global `/graphify`.

---

## 6. The heartbeat, what runs and when

**Local (Windows Task Scheduler)**
- Weekdays 9:00 — Sprint Tracker
- Daily 8:00 — Morning Brief
- Daily 8:30 — Application Engine watch, and the Alex HQ push
- Monday 8:30 — Personal CRM
- Daily 9:00 / 13:00 / 17:00 — Email Triage (three runs)
- Monthly, last day 20:00 — Expense Wrangler
- Friday 16:00 — Weekly Exec Report
- Monthly, 24th 10:00 — Airbnb Host
- Monday 7:30 — Alex AI Radar, and the Recovery checker (same slot)
- Daily 21:30 — Git backup
- Daily 21:45 — Encrypted vault backup
- (Disabled) — WhatsApp Harvest

**Remote (n8n on the server)**
- Daily 07:00 — Application Engine (BI job pipeline)
- Daily 07:30 — AI Application Engine
- Tue/Thu 08:00 — LinkedIn series staging

**Phone**
- Daily 23:59 — Health Tracker (iPhone Shortcut posts steps and sleep)

Every scheduled job is hardened: a wrapper detects failure, pushes a red or green status to Alex HQ so a dead run is never silent, and retries past the daily quota reset.

---

## 7. Utility commands

- `/setup` — first-run wizard that interviews you and writes `soul.md` and the vault.
- `/ingest` — process new raw sources into linked wiki pages.
- `/status` — health check and "what happened while I was away."
- `/lint` — vault health check (orphans, stale pages, contradictions, gaps).
- `/new` — create a new automation or project.
- `/cron-setup` — manage the local schedules.
- `/brand` — set up or refresh the brand config.
- `/graphify` (global) — turn any input into a knowledge graph.

---

## 8. How Alex stays current and improves itself

- **Alex AI Radar** (Monday 07:30) scans free feeds and a taste profile to surface tool and model upgrades, content angles, and build ideas. The permission gate is that Alex only marks items "Interesting," Shaheen promotes them.
- **context7** pulls live library and API docs so Alex is not limited to stale training knowledge.
- **The error-log flywheel** records every failure and its fix, and checks it before any retry, so the same mistake is not made twice.
- **The "My Words" corpus** in `soul.md` harvests Shaheen's real phrasing every session, so drafts sound like him and get more like him over time.

---

## 9. Backup and recovery

- **Git backup (daily 21:30)** pushes the functional system to a private GitHub repo. After a 2026-07-04 privacy scrub, GitHub holds only code and how-it-works docs plus Shaheen's name. The entire vault, `soul.md`, CV, financial data, and workflow exports are kept local only.
- **Encrypted vault backup (daily 21:45)** closes that gap: it encrypts the private half and ships a single blob off the machine to the server. The passphrase lives outside the repo and must also be in Shaheen's password manager, or the off-machine copy is unrecoverable if the laptop dies.
- **Recovery checker (Monday 07:30)** validates the whole system against a manifest and flags drift to the dashboard and the Monday brief.
- **Restore on Windows** needs `git clone -c core.longpaths=true`. Credential files are recreated by hand (the backup holds no secrets). The full map lives in `vault/identity.md`.

---

## 10. Credentials map (locations only)

> Local-only section. These are file locations, never values. Do not share this part publicly.

- n8n REST API key — `work/03-application-engine/config/n8n-api-key.txt` (gitignored)
- Alex HQ push token and basic auth — `work/16-alex-hq/config/` (gitignored)
- GitHub backup token — Windows Credential Manager
- Claude Code auth — `~/.claude/.credentials.json`
- SSH key to the server — `~/.ssh/id_ed25519`
- Vault-backup passphrase — `C:\Users\Thinkpad\.alex-secrets\vault-backup.pass`, and Shaheen's password manager
- OpenAI, Anthropic, Google, Bright Data keys — only as n8n credentials on the server
- MCP OAuth (Notion, Google, etc.) — in the connector store, not on disk

---

## 11. Current state snapshot (2026-07-06)

- **Live and running:** the daily ops, both job pipelines, the CRM, triage, expenses, content, research, the Radar, the recovery layer, and the two backups. The Alex HQ dashboard is live at `hq.shaheenkiarash.com`. The Health Tracker went fully automated today.
- **Paused:** WhatsApp Harvest (disabled since 2026-06-18 for token burn).
- **Dormant:** Venture Sync (built and configured, no source repos on the machine yet).
- **Known drift to clean up:** some duplication between the vault and Notion, a few stale project pages, and an orphaned `work/voice` folder not in the routing table. The recovery checker already flags these; they are hygiene, not new builds.
- **The person behind it:** Shaheen Kiarash, Stockholm, pivoting from Senior Power BI Developer to AI Automation Engineer, severance clock to October 2026, building STEMPLICITY on the side. Alex is both his daily operator and the proof of what he can build.

*End of reference. Keep `vault/identity.md` as the living source of truth; refresh this overview when the system changes in a big way.*

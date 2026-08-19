<!-- GENERATED FILE - do not hand-edit. Source: templates/getting-started.template.md + system/manifest.json + scheduler/schedule.md + CLAUDE.md. Regenerate: node scripts/generate-alex.js. Generated 2026-08-19. -->

# Getting Started: set up and run the Personal Ops System

This is the onboarding and operations guide: what you need, how to boot Alex, what runs, and how the schedules work. For how the system is designed and how Alex behaves, read `docs/ARCHITECTURE.md`.

## 1. What you need

- **A paid Claude account** (Max recommended; Pro burns out fast). Alex *is* Claude, no subscription is no brain.
- **Claude Code** (desktop app / Cowork, or the CLI). Windows 10/11 (Mac works too).
- **A Google account** (Gmail, Calendar, Drive). **Notion** (free), optional for the base brain but required for the CRM, expenses, and meeting-intel databases (without it Alex degrades to local files, per the Bootstrap rule). **Obsidian** (free, to read the vault).
- Base install is about an hour.

## 2. Install and first boot

1. **Install Claude Code:** desktop app from claude.com/claude-code, or the CLI installer (`irm https://claude.ai/install.ps1 | iex` on Windows, `curl -fsSL https://claude.ai/install.sh | bash` on Mac; `npm install -g @anthropic-ai/claude-code` also works).
2. **Get the files:** a direct copy (USB/zip) from Shaheen, OR `git clone -c core.longpaths=true` the **public** repo (public since 2026-07-16; the long-paths flag is mandatory on Windows). **Important:** the repo is scrubbed, so a git clone gives you a **vault-less skeleton** (the entire `vault/`, `soul.md`, and `work/*/config` are gitignored and local-only). Only a direct copy from Shaheen carries personal data. Because the repo is public, anyone can clone this skeleton, so the scrub + `.gitignore` are the only things keeping personal data off it.
3. **Point Claude Code at the folder. This is the step everything else depends on, and it is the one people get wrong.** Claude Code only becomes Alex inside the folder it is *opened in*. Dragging the folder into the chat, attaching `CLAUDE.md`, or pasting a file path does **not** work: you get plain Claude, no commands, no memory, no personality. You do this once per machine and Claude Code remembers it.
   - **Desktop app (Cowork):** start a new session, and when it asks for a folder pick the `personal-os` folder you just downloaded. It stays in your recent folders from then on, so every later session is one click.
   - **Command line:** move into the folder *first*, then start Claude Code. On Windows:
     ```
     cd "C:\Users\YOURNAME\Desktop\personal-os"
     claude
     ```
     On Mac or Linux: `cd ~/Desktop/personal-os` then `claude`. Replace the path with wherever you actually saved the folder. Starting `claude` from your home folder and opening files from there is the single most common first-session mistake.
   - **Do not** open a *subfolder* (like `work/` or `docs/`) and expect the commands to work. The folder you open must be the one that directly contains `CLAUDE.md` and `soul.md`.
4. **First boot: check it worked before you do anything else.** Type `/status`.
   - If Alex answers with a status report, the folder is loaded correctly. Go to step 5.
   - If you get "unknown command" or plain-Claude chat, the folder is **not** loaded. Close the session and redo step 3. Nothing below will work until `/status` responds.
   - If you cloned the repo there is no soul.md yet, so the first reply is plain Claude even when the folder *is* loaded correctly. That is expected: `/status` still answers, and personality appears after `/setup` writes soul.md. If you *have* soul.md and still get plain Claude, the session hook needs `cat` (ships with Git for Windows).
5. **Run `/setup` as your first real prompt.** That is the whole first-session instruction: open the folder, `/status` to confirm, then type `/setup` and answer its questions. It walks you through identity, brand, and the vault one step at a time.
6. **Connect services** at claude.ai, Settings, Connectors: Gmail, Calendar, Drive (one Google sign-in), Notion (optional). The in-app `/mcp` manager inside Claude Code is an alternative path to the same connectors. These are one-time authentications; they persist across sessions. Install the "Claude in Chrome" extension for browser control. (GitHub is used only for backup via git + a token, not a connector.)
7. **Optional phone control:** pair the Claude Code Desktop app (Cowork) with the mobile app so you can send Alex tasks from your phone. The Alex HQ dashboard is a separate phone surface for reading metrics.

**The first session, in four lines.** Open the `personal-os` folder in Claude Code (not the file, the folder). Type `/status` to confirm it loaded. Type `/setup` and answer the questions. Then `/brand`. Every session after that, open the same folder and just talk.

## 3. Make it yours

- **Run `/setup` first.** It interviews you and generates `soul.md` and the vault. Then run `/brand` for the brand config.
- **Then hand-refine `soul.md`** (the biggest lever, that is your identity and voice).
- Start building automations with `/new` and the per-project `work/{n}/CLAUDE.md` specs. `/new` writes the registry entry in `system/manifest.json` FIRST, then scaffolds.

## 4. The automations (31 registered, non-retired)

The registry `system/manifest.json` is the source of truth; this list is generated from it.

- **01 Sprint Tracker** (PARKED; trigger: PAUSED (Shaheen 2026-07-16, until re-enabled)) - Standup + velocity from a local cached snapshot of the Progress Tracker (cache-mode is the accepted design since 2026-07-18, live Notion board read paused - token not restored); every automation reports Done to it.
- **02 Morning Brief** (LIVE; trigger: daily 8:00) - The 08:00 brief: inbox, calendar, radar, alerts, life ops, inbox notes, interview flags.
- **03 Application Engine (BI)** (LIVE; trigger: n8n Tue+Thu 15:00 + watch 8:30) - Job pipeline, Power BI track: source, score, gate, draft, render every Tue & Thu; also an MCP server.
- **04 Research Team** (ON-DEMAND; trigger: on-demand) - Adaptive multi-agent research squads for EXTERNAL evidence, + an evidence-anchored Adversarial Verification Mode (`verify:` a claim - refuters grounded in external facts, converge to CONFIRMED/REFUTED/UNRESOLVED, never consensus-laundered; the sanctioned way to check an Alex conclusion).
- **05 Personal CRM** (LIVE; trigger: Mon 8:30) - Relationship scoring + Monday follow-up list; reply drafts behind a hard never-send gate.
- **06 Meeting Intel** (ON-DEMAND; trigger: on-demand) - Dossiers before meetings; any dropped file becomes notes, actions, CRM updates after.
- **07 Email Triage** (LIVE; trigger: daily 05:00) - Inbox triage once each morning at 05:00 + voice-matched reply drafts; learns from Shaheen's edits.
- **08 Expense Wrangler** (LIVE; trigger: monthly last day 20:00) - Receipts to the Notion Expenses DB + an all-formula branded monthly Excel.
- **10 Weekly Exec Report** (LIVE; trigger: Fri 16:00) - The Friday capstone: every automation + mail + calendar into one branded deck + Notion page.
- **11 WhatsApp Harvest** (ON-DEMAND; trigger: on-demand (iPhone backup); its Task Scheduler job stays DISABLED by design) - Voice-corpus + people harvest. Phase 1 screen-scrape retired (dead end); Phase 2 encrypted iPhone-backup harvest proven 2026-07-10 (feeds CRM last_contact + soul corpus); Phase 3 read-only WAHA gateway built-ready, off until post-offer.
- **12 LinkedIn Series** (LIVE; trigger: on-demand + n8n staging (scheduled)) - Building Alex in public: locked ~150-word template, hard gates, real material; n8n stages text only, Shaheen makes the image and posts. Now memory-fed: /content-agent ranks hooks from what actually landed (the content outcome loop) and logs each post's engagement back so it compounds.
- **13 Airbnb Host** (LIVE; trigger: monthly 24th 10:00 + brief) - Bookings + income from a local read-only Playwright harvest of his own Airbnb dashboard (Airbnb has no host API; Gmail feed is the FALLBACK, not the primary - corrected 2026-07-28, the command file was right and this line was the stale side); feeds the brief + runway.
- **14 AI Application Engine** (LIVE; trigger: n8n Tue+Thu 15:30) - Job pipeline, AI track: clone of #03 with the AI CV + a recalibrated career-changer gate.
- **15 Alex AI Radar** (LIVE; trigger: Mon 07:30 + collector 06:00) - The staying-current engine: weekly scored sweep, taste memory, friction-first matching, daily server-side collector + urgent lane.
- **16 Alex HQ** (LIVE; trigger: always-on + push 8:45) - The glanceable dashboard + two-way note inbox at hq.shaheenkiarash.com; every automation pushes run status here.
- **17 Health Tracker** (LIVE; trigger: phone 23:59) - Daily Apple Health to the brief + HQ tiles; the Alex Sleep Score (0-100) computed server-side.
- **18 Recovery Layer** (LIVE; trigger: Mon 07:30 + nightly 21:30/21:45 + daily 08:10 n8n-active + 1st-Mon lint + 1st-Mon security sweep 07:20 + Sun auth probe) - Backups (git + encrypted, drills proven), the weekly zero-token drift checker (now 23 checks (C1-C24, C16 retired), docs-vs-facts.db), the daily n8n active-flag watcher, the gated monthly lint, the monthly security sweep, the auth probe. Now also the FIX half: the HQ Self-Heal Loop auto-repairs safe metric drift on every HQ update and proposes the rest. Hosts the Recall Spine fact ledger (system/recall/facts.db) + the soul-core injection card + the status/backup rotation caps (S1 Compiled Surfaces).
- **19 Venture Sync** (DORMANT, revisit 2026-10-01; trigger: -) - Read-only mirror of venture repos into the vault. Waiting on: the venture repos existing on this machine.
- **20 Runway** (LIVE; trigger: monthly last day 21:15) - The zero-date model: savings + burn + salary/severance/a-kassa + Airbnb income, all-formula SEK Excel.
- **21 Interview Copilot** (EVENT; trigger: brief flag + on-demand) - Carries a booked interview to the finish: dossier, prep vs the answer bank, runway-aware negotiation drafts. Never sends.
- **22 Teach-Alex** (EVENT; trigger: inbox note + on-demand) - Ten-second corrections from the phone: classified, filed, confirmed for identity files, logged for #23.
- **23 Self-Review** (LIVE; trigger: Sun 20:00) - Alex reviews Alex weekly (clusters corrections, errors, INCOMPLETE close-outs, proposes upgrades behind approval; a diagnose sub-step names the instruction behind a correction behind an 80-confidence gate and proposes a fix, never auto-editing the constitution) + on-demand /deep-audit: the adversarial whole-repo sweep that fans out one agent per project and proves every manifest claim matches ground truth.
- **24 Flight Search** (ON-DEMAND; trigger: on-demand) - Cheapest + best flights across three live sources in parallel (Kiwi, Turkish, Google Flights) + a pluggable Skyscanner slot (unwired by decision); hybrid criteria intake, dedupe to the single cheapest, rank by Shaheen's rules, 30-min follow-up memory, fresh every search.
- **25 Evolution** (LIVE; trigger: daily monitor 07:10 + weekly eval Mon 07:50) - Keeps Alex current: a zero-token daily monitor logs new Claude models, MCPs, n8n patterns AND agent skills (skills.sh/skillsmp/skillhub) to system/landscape-log.jsonl; a weekly Claude digest proposes/skips each; models/MCPs/patterns route through a human-gated integration runbook, while matching skills AUTO-INSTALL via a deterministic audited installer (git-reversible). Alex proposes; Shaheen decides, except the skills lane self-installs.
- **26 Prompting** (ON-DEMAND; trigger: on-demand) - The translator function: Shaheen speaks plain English, Alex acts as a senior prompt engineer and returns a lean CONTEXT/INPUT/OUTPUT prompt for Claude Code; overlap check vs existing automations, one gap round with a defaults skip, skills resolved + named from the bindings table, pointer-style file references, then offers to run it on the spot.
- **27 Migration Engine** (ON-DEMAND; trigger: on-demand) - Run a large code/config migration as a dynamic workflow: parallel agents, per-unit self-verification, adversarial parity check, resumable + reversible. Refuses to run without a named target + a verification harness. No target committed yet (P9 dashboard.tsx extraction = the small hand-done precedent).
- **28 Chat Gateway** (DORMANT, revisit 2026-09-15; trigger: poller-driven phone chat (planned) + phone via n8n instance MCP; build pending) - Two-way phone chat into Alex: a read-only pocket that captures notes and done:/action:/teach: commands from the phone into the existing alex_inbox pipeline, complementing the session and never replacing it. SCAFFOLDED 2026-07-17; live build pending the BotFather bot, Telegram user id, phone pairing and the RC test (all Shaheen-side).
- **29 Trip Ops** (ON-DEMAND; trigger: on-demand + rides the 05:00 email lane (not event-driven)) - Booking confirmations Shaheen forwards become trip notes, read-back-verified Google Calendar events, and brief lines; a machine-readable travel flag (system/travel-state.json) drives timezone-aware scheduling (recovery C18).
- **30 Portfolio Website** (ON-DEMAND; trigger: on-demand build sessions; GitHub Actions deploys on push to main (repo-side CI, no local cron in v1)) - shaheenkiarash.com rebuilt as a public-repo Astro static site (took number 30 from the retired modeling lane 2026-08-03; that lane was wiped whole with no successor, tombstone in meta.unnumbered). Images-as-content portfolio + the In Motion film section, docs-as-interview-artifact, zero secrets by construction. Serves from the existing Cloudflare Worker plain-block-545a, deployed by hardened GitHub Actions + wrangler with a scoped API token (amendment A1: VPS self-hosting evaluated and DEFERRED, to keep a public surface off the production n8n box whose Caddy container owns ports 80/443; the rejection is itself the interview artifact). The website repo lives at Desktop/shaheenkiarash.com, a SIBLING of personal-os, never nested. Build runs in phases B0-B5 with hard entry gates; no code before the content and design phase closes.
- **31 Portal Scanner** (LIVE; trigger: n8n Tue & Thu 15:13 (scan + bank)) - Standalone company-portal job lane, STAGE 1 of 2: detect each company ATS once, hit its free public JSON, prefilter, and BANK matching jobs to the queue that #32 drains. Split from the engine 2026-07-28 so both workflows carry their own n8n id + cron and come under V6 leg (c) and the daily active-flag watcher.
- **32 Portal Application Engine** (LIVE; trigger: n8n Tue & Thu 15:43 (drain + draft)) - Standalone company-portal job lane, STAGE 2 of 2: drains the queue #31 banks and runs its OWN cloned Match/Gate/Writer/Render pipeline to review-ready drafts. Split from the scanner 2026-07-28.
- **Voice** (EVENT; trigger: every Claude Code session (voice flag + hooks) + Ctrl+Alt+D dictate; v2 loop on-demand) - Voice v3 'ride the official surface' (research run 22, built 2026-07-12): two-way voice INSIDE the interactive Claude Code session. In: native /voice HOLD dictation (EN/SV, free, review-then-Enter - autoSubmit OFF by design vs acceptEdits) + Ctrl+Alt+D local-whisper dictate lane for AR/SV/EN (types into the prompt, never presses Enter). Out: Stop-hook Edge-TTS->SAPI never-mute speech, gated on outputs/voice/voice-on.flag ('voice on/off' to Alex). $0/mo, no long-lived audio process. v2 open-mic loop (alex_voice.py) stays the on-demand walk-around tool.

**Utility commands:** /setup, /ingest, /status, /lint, /new, /cron-setup, /brand (plus the global `/graphify`).

## 5. The tools Alex reaches (MCP)

MCP tools are deferred: load them with `ToolSearch("select:<tool>")` before calling. Prefer an MCP tool when one exists; use Chrome only for sites with no connector; never Chrome for Gmail, Calendar, or Notion. Connected surfaces named in the MCP Reference of `CLAUDE.md`:

- n8n (Hetzner box)
- Claude Design (DesignSync)
- Google Calendar
- Gmail
- Notion

## 6. Scheduling (Windows Task Scheduler)

Nothing runs until you schedule it. On this machine the scheduler is Windows Task Scheduler; `/cron-setup` builds the jobs from `scheduler/schedule.md`. The best first schedule is the morning brief, daily 8:00.

- **How a scheduled `claude -p` job works:** the scheduler fires at a time, runs `claude -p "Run /{command}" --dangerously-skip-permissions`, the work happens, the process exits, each run is a fresh session. The skip-permissions flag is required because a headless run has no TTY to approve prompts (do not carry it into interactive use). On this machine the jobs run as the logged-in user and reuse existing credentials, so no OAuth token is needed; a `claude setup-token` token is only for a truly detached cron (a headless Linux/macOS server).
- **The real jobs are hardened, not naive one-shots:** the scheduled wrappers are `.ps1` scripts that detect failure, push a RED/GREEN `run_status` to Alex HQ so a dead run is never silent, and self-schedule one-shot retries past the quota reset (Task Scheduler's RestartCount only covers launch failures, proven 2026-07-06). When you add a new scheduled automation, wrap it the same way, do not schedule a bare `claude -p`.
- **Not every job is a `claude -p` run.** Some are zero-token scripts or remote n8n: the recovery checker, the git and vault backups, the vault search index, the health ingest (n8n, phone-triggered).
- **Check a job:** `schtasks /query /fo LIST | findstr PersonalOS`, logs in `outputs/logs/{name}.log`. Pause all: `/cron-setup off`. Pause one: `/cron-setup off {name}`. Resume: `/cron-setup on`.
- On macOS/Linux the equivalent is `crontab` (detached, needs the OAuth token, all env vars inline, `cd` to the repo first, tag entries `# personal-os:{name}`).

### The scheduled jobs (from scheduler/schedule.md)

| Job | Command | Frequency |
|---|---|---|
| Health Tracker (#17) - phone-side, NOT a Windows task | none (no /command, no Task Scheduler job). | **daily 23:59, triggered ON the iPhone** by a native Shortcuts time-automation (Shaheen builds it, guide `work/17-health-tracker/IPHONE-SHORTCUT.md`). It POSTs to the n8n webhook `/webhook/alex-health-ingest`; n8n scores + stores. Nothing to add to /cron-setup on this machine. **23:59 chosen (2026-07-04) so the day's steps are complete while "is today" still captures last night's sleep - one combined row/day.** |
| Sprint Tracker | /sprint-tracker | weekdays at 9:00 AM (PAUSED, see Status above) |
| Morning Brief | /morning-brief | daily at 8:00 AM (Task Scheduler job PersonalOS-morning-brief) |
| Application Engine Watch | /application-engine | daily at 8:30 AM (Task Scheduler job PersonalOS-application-engine) |
| Personal CRM | /personal-crm | Monday at 8:30 AM |
| Email Triage | /email-triage scheduled | **daily at 5:00 AM** (changed 2026-07-16, cost cut: was 3x daily at 9/13/17). Model: claude-sonnet-4-6 (per-wrapper `--model`). |
| Expense Wrangler | /expense-wrangler | monthly, last day of each month at 8:00 PM |
| Weekly Exec Report | /weekly-exec-report | Friday at 4:00 PM |
| WhatsApp Harvest (#11) | /whatsapp-harvest | on-demand (the retired Phase 1 slot was daily at 2:30 AM, a usage-based slot that ran while Shaheen slept; kept here as history only) |
| Airbnb Host | /airbnb-host (monthly-sync) | monthly on the 24th at 10:00 AM (Task Scheduler job PersonalOS-airbnb-host, scheduled runs use **`--headless`** since 2026-07-14 so the harvest launches unattended under Task Scheduler; reuses the saved login session read-only. Manual runs you start yourself stay headed. See work/13 Data Access.) |
| Alex AI Radar (weekly sweep) | /alex-radar --weekly | Monday at 7:30 AM (Task Scheduler job PersonalOS-alex-radar; 07:30 so the output is in the vault before the 08:00 Morning Brief surfaces it as the Radar section) |
| Git Backup (Recovery Phase 0) | scripts/git-backup.ps1 (pure git, no claude call) | daily at 9:30 PM (Task Scheduler job PersonalOS-git-backup; RestartCount 2 / RestartInterval 30 min / ExecutionTimeLimit 30 min / StartWhenAvailable) |
| Vault Backup - encrypted local-only (Recovery Phase 1) | scripts/vault-backup.ps1 (pure PowerShell, no claude call) | daily at 9:45 PM (Task Scheduler job PersonalOS-vault-backup; StartWhenAvailable / ExecutionTimeLimit 30 min). Staggered 15 min after the git push. |
| Recovery Layer sweep (Recovery Phase 2) | work/18-recovery-layer/check.ps1 (pure PowerShell, no claude call, zero tokens) | Mondays at 7:30 AM (Task Scheduler job PersonalOS-recovery-check; StartWhenAvailable + WakeToRun + ExecutionTimeLimit 15 min; shares the Alex Radar Monday sweep slot). NO restart policy: exit 2 means drift-found (normal), not failure. |
| n8n active-flag watcher (Recovery Layer, BUG-01 fix) | scripts/n8n-active-check.ps1 (pure PowerShell, no claude call, zero tokens) | daily at 8:10 AM (Task Scheduler job PersonalOS-n8n-active-check; StartWhenAvailable + ExecutionTimeLimit 15 min; NO restart policy: exit 1 = a workflow is OFF, a real finding, not a transient failure). **Runs BEFORE the day's engine crons, not after** - the engines moved to Tue & Thu 15:00/15:30 on 2026-07-24, so the 08:10 watcher now reads each flag roughly seven hours ahead of the run it protects, which is the useful direction: a workflow found OFF at 08:10 can be re-activated before 15:00 rather than after a missed run. *(Corrected 2026-07-29, architecture review: this said "placed after the 07:00/07:30 engine crons so a failed activation is caught the same morning", a rationale that stopped being true at the retime.)* |
| Vault Search Index (upgrade-scan item 1) | scripts/run-vault-index.ps1 (pure Python/SQLite, no claude call, zero tokens) | daily at 9:35 PM (Task Scheduler job PersonalOS-vault-index; StartWhenAvailable + battery-safe + ExecutionTimeLimit 15 min; NO restart ladder - a missed rebuild self-heals next night and on-demand `build` always works). Placed 10 min before the 21:45 vault backup so the fresh .db ships in the encrypted blob. |
| Alex HQ Local Push | /alex-hq | daily at 8:45 AM (staggered from 8:30 on 2026-07-12, upgrade P1/c11: it shared the slot with application-engine, both spawning Claude sessions with no serialization) |
| Runway Command Center | /runway | monthly, last day of month, AFTER /expense-wrangler (reads the freshest expense + booking data) |
| Interview-to-Offer Copilot | /interview | NO dedicated schedule. Event-driven (the morning brief flags interview invites/events) + on-demand /interview. No Task Scheduler job by design. |
| Teach-Alex Button | /teach-alex | NO dedicated schedule. Event-driven (a correction note in the alex_inbox, caught at the morning-brief inbox step + other touchpoints) + on-demand. No Task Scheduler job by design. |
| Alex Reviews Alex (Self-Review) | /self-review | weekly, Sunday 20:00 (quiet slot, before the Monday brief). **REGISTERED 2026-07-06:** job PersonalOS-self-review, wrapper scripts/run-self-review.ps1, standard hardening. Also on-demand. |
| Gated Monthly Lint (Recovery Phase 3) | scripts/run-lint.ps1 (checker first, then claude -p "/lint gated") | monthly, first Monday at 10:00 AM (Task Scheduler job PersonalOS-lint-monthly; after the 07:30 recovery sweep + radar and the 08:00 brief) |
| Monthly Security Sweep (Recovery Phase 5) | work/18-recovery-layer/security-sweep.ps1 (pure PowerShell, zero tokens, detect-only) | monthly, first Monday at 7:20 AM (Task Scheduler job PersonalOS-security-sweep; ahead of the 07:30 recovery sweep, the 08:00 brief and the 10:00 lint) |
| Auth Freshness Probe | scripts/auth-check.ps1 (one micro claude -p probe, pattern detection, HQ push) | weekly, Sunday at 7:30 PM (Task Scheduler job PersonalOS-auth-check; before the 20:00 self-review, ahead of the Monday job train) |
| Landscape Monitor (#25) | scripts/run-landscape-monitor.ps1 (pure Node, no claude call, zero tokens) | daily at 7:10 AM (Task Scheduler job PersonalOS-landscape-monitor; StartWhenAvailable + WakeToRun + battery-safe + ExecutionTimeLimit 30 min; RestartCount 2 / 30 min - light class, and the close-out lib self-schedules the real retry) |
| Voice-audio orphan sweep (#16 inbox, upgrade P12) - box-side cron, NOT a Windows task | - | daily 04:17 - `find /opt/alex-inbox-audio -type f -mtime +30 -delete`. |
| Landscape Eval (#25) | scripts/run-landscape-eval.ps1 (one claude -p call per week) | Monday at 7:50 AM (Task Scheduler job PersonalOS-landscape-eval; standard hardening RestartCount 4 / 90 min / ExecutionTimeLimit 2h, WakeToRun, battery-safe) |
| Portal Scanner (#31) - box-side n8n cron, NOT a Windows task | n8n workflow `5tPXbhdpp6PfF56V` (no local wrapper, no claude call, zero local tokens) | **Tuesday & Thursday 15:13 Stockholm** (`13 15 * * 2,4`), active. 30 min ahead of #32 so the queue is filled before the drain. |
| Portal Application Engine (#32) - box-side n8n cron, NOT a Windows task | n8n workflow `sxEYRyeHH7i1mHzb` | **Tuesday & Thursday 15:43 Stockholm** (`43 15 * * 2,4`), active. |
| LinkedIn Series staging (#12) - box-side n8n cron, NOT a Windows task | n8n workflow `v1GbDYganOz9EGpM` | **Tuesday & Thursday 08:00 Stockholm** (`0 8 * * 2,4`), active. |
| Alex HQ Pipeline Stats (#16) - box-side n8n cron, NOT a Windows task | n8n workflow `y5YbDZu8TT38XZ9r` (+ manual `GET /webhook/alex-hq-stats-run`) | **daily 07:50 Stockholm** (`50 7 * * *`), active. |
| Alex Radar collector (#15) - box-side n8n cron, NOT a Windows task | n8n workflow `PYePT4Al6aPZi56M` (+ manual `GET /webhook/radar-collect`) | **daily 06:00**, active. |

## 7. Backup and recovery, in one paragraph

Git pushes the functional system (code + docs, never the vault or soul.md) to a GitHub repo (public since 2026-07-16; scrubbed, so `.gitignore` is the sole barrier keeping personal data off it) daily at 21:30. The personal half (vault, soul.md, secrets) ships daily at 21:45 as a gpg-encrypted blob to the n8n box, last 14 kept; the passphrase lives outside the repo and must also be in the password manager. A zero-token checker sweeps the whole system against `system/manifest.json` every Monday 07:30. Full detail: the Backup & Recovery section of `CLAUDE.md` and `vault/projects/recovery/` (local).

## 8. Success checklist

- `/status` runs and reports.
- After `/setup`, the folder opens with personality (soul.md hook fired).
- Services are connected (a real `/morning-brief` produces a real brief).
- A scheduled job has fired (check `outputs/logs/`).
- Backups are green (git 21:30, vault 21:45) and the vault passphrase is in your password manager.

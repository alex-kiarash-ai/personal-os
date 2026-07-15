<!-- GENERATED FILE - do not hand-edit. Source: templates/getting-started.template.md + system/manifest.json + scheduler/schedule.md + CLAUDE.md. Regenerate: node scripts/generate-alex.js. Generated 2026-07-15. -->

# Getting Started: set up and run the Personal Ops System

This is the onboarding and operations guide: what you need, how to boot Alex, what runs, and how the schedules work. For how the system is designed and how Alex behaves, read `docs/ARCHITECTURE.md`.

## 1. What you need

- **A paid Claude account** (Max recommended; Pro burns out fast). Alex *is* Claude, no subscription is no brain.
- **Claude Code** (desktop app / Cowork, or the CLI). Windows 10/11 (Mac works too).
- **A Google account** (Gmail, Calendar, Drive). **Notion** (free), optional for the base brain but required for the CRM, expenses, and meeting-intel databases (without it Alex degrades to local files, per the Bootstrap rule). **Obsidian** (free, to read the vault).
- Base install is about an hour.

## 2. Install and first boot

1. **Install Claude Code:** desktop app from claude.com/claude-code, or the CLI installer (`irm https://claude.ai/install.ps1 | iex` on Windows, `curl -fsSL https://claude.ai/install.sh | bash` on Mac; `npm install -g @anthropic-ai/claude-code` also works).
2. **Get the files:** a direct copy (USB/zip) from Shaheen, OR `git clone -c core.longpaths=true` the private repo (the long-paths flag is mandatory on Windows). **Important:** the repo is scrubbed, so a git clone gives you a **vault-less skeleton** (the entire `vault/`, `soul.md`, and `work/*/config` are gitignored and local-only). Only a direct copy from Shaheen carries personal data.
3. **First boot:** open Claude Code *inside* the personal-os folder, then run `/status`. If you cloned the repo there is no soul.md yet, so the first reply is plain Claude, that is expected; personality appears after `/setup` writes soul.md. If you *have* soul.md and still get plain Claude, the session hook needs `cat` (ships with Git for Windows).
4. **Connect services** at claude.ai, Settings, Connectors: Gmail, Calendar, Drive (one Google sign-in), Notion (optional). The in-app `/mcp` manager inside Claude Code is an alternative path to the same connectors. These are one-time authentications; they persist across sessions. Install the "Claude in Chrome" extension for browser control. (GitHub is used only for backup via git + a token, not a connector.)
5. **Optional phone control:** pair the Claude Code Desktop app (Cowork) with the mobile app so you can send Alex tasks from your phone. The Alex HQ dashboard is a separate phone surface for reading metrics.

## 3. Make it yours

- **Run `/setup` first.** It interviews you and generates `soul.md` and the vault. Then run `/brand` for the brand config.
- **Then hand-refine `soul.md`** (the biggest lever, that is your identity and voice).
- Start building automations with `/new` and the per-project `work/{n}/CLAUDE.md` specs. `/new` writes the registry entry in `system/manifest.json` FIRST, then scaffolds.

## 4. The automations (26 registered, non-retired)

The registry `system/manifest.json` is the source of truth; this list is generated from it.

- **01 Sprint Tracker** (LIVE; trigger: weekdays 9:00) - Standup + velocity from the Notion Progress Tracker board; every automation reports Done to it.
- **02 Morning Brief** (LIVE; trigger: daily 8:00) - The 08:00 brief: inbox, calendar, radar, alerts, life ops, inbox notes, interview flags.
- **03 Application Engine (BI)** (LIVE; trigger: n8n 07:00 + watch 8:30) - Job pipeline, Power BI track: source, score, gate, draft, render daily; also an MCP server.
- **04 Research Team** (ON-DEMAND; trigger: on-demand) - Adaptive multi-agent research squads for EXTERNAL evidence, + an evidence-anchored Adversarial Verification Mode (`verify:` a claim - refuters grounded in external facts, converge to CONFIRMED/REFUTED/UNRESOLVED, never consensus-laundered; the sanctioned way to check an Alex conclusion).
- **05 Personal CRM** (LIVE; trigger: Mon 8:30) - Relationship scoring + Monday follow-up list; reply drafts behind a hard never-send gate.
- **06 Meeting Intel** (ON-DEMAND; trigger: on-demand) - Dossiers before meetings; any dropped file becomes notes, actions, CRM updates after.
- **07 Email Triage** (LIVE; trigger: 9:00 / 13:00 / 17:00) - Inbox triage three times a day + voice-matched reply drafts; learns from Shaheen's edits.
- **08 Expense Wrangler** (LIVE; trigger: monthly last day 20:00) - Receipts to the Notion Expenses DB + an all-formula branded monthly Excel.
- **10 Weekly Exec Report** (LIVE; trigger: Fri 16:00) - The Friday capstone: every automation + mail + calendar into one branded deck + Notion page.
- **11 WhatsApp Harvest** (ON-DEMAND; trigger: on-demand (iPhone backup)) - Voice-corpus + people harvest. Phase 1 screen-scrape retired (dead end); Phase 2 encrypted iPhone-backup harvest proven 2026-07-10 (feeds CRM last_contact + soul corpus); Phase 3 read-only WAHA gateway built-ready, off until post-offer.
- **12 LinkedIn Series** (LIVE; trigger: on-demand + staging Tue/Thu) - Building Alex in public: locked ~150-word template, hard gates, real numbers; n8n stages, Shaheen posts.
- **13 Airbnb Host** (LIVE; trigger: monthly 24th 10:00 + brief) - Bookings + income from the Gmail feed (Airbnb has no host API); feeds the brief + runway.
- **14 AI Application Engine** (LIVE; trigger: n8n daily 07:30) - Job pipeline, AI track: clone of #03 with the AI CV + a recalibrated career-changer gate.
- **15 Alex AI Radar** (LIVE; trigger: Mon 07:30 + collector 06:00) - The staying-current engine: weekly scored sweep, taste memory, friction-first matching, daily server-side collector + urgent lane.
- **16 Alex HQ** (LIVE; trigger: always-on + push 8:45) - The glanceable dashboard + two-way note inbox at hq.shaheenkiarash.com; every automation pushes run status here.
- **17 Health Tracker** (LIVE; trigger: phone 23:59) - Daily Apple Health to the brief + HQ tiles; the Alex Sleep Score (0-100) computed server-side.
- **18 Recovery Layer** (LIVE; trigger: Mon 07:30 + nightly 21:30/21:45 + 1st-Mon lint + Sun auth probe) - Backups (git + encrypted, drills proven), the weekly zero-token drift checker, the gated monthly lint, the auth probe.
- **19 Venture Sync** (DORMANT, revisit 2026-10-01; trigger: -) - Read-only mirror of venture repos into the vault. Waiting on: the venture repos existing on this machine.
- **20 Runway** (LIVE; trigger: monthly last day 21:15) - The zero-date model: savings + burn + salary/severance/a-kassa + Airbnb income, all-formula SEK Excel.
- **21 Interview Copilot** (EVENT; trigger: brief flag + on-demand) - Carries a booked interview to the finish: dossier, prep vs the answer bank, runway-aware negotiation drafts. Never sends.
- **22 Teach-Alex** (EVENT; trigger: inbox note + on-demand) - Ten-second corrections from the phone: classified, filed, confirmed for identity files, logged for #23.
- **23 Self-Review** (LIVE; trigger: Sun 20:00) - Alex reviews Alex weekly (clusters corrections, errors, INCOMPLETE close-outs, proposes upgrades behind approval) + on-demand /deep-audit: the adversarial whole-repo sweep that fans out one agent per project and proves every manifest claim matches ground truth.
- **24 Flight Search** (ON-DEMAND; trigger: on-demand) - Cheapest + best flights across three live sources in parallel (Kiwi, Turkish, Google Flights) + a pluggable Skyscanner slot (unwired by decision); hybrid criteria intake, dedupe to the single cheapest, rank by Shaheen's rules, 30-min follow-up memory, fresh every search.
- **25 Evolution** (LIVE; trigger: daily monitor 07:10 + weekly eval Mon 07:50) - Keeps Alex current: a zero-token daily monitor logs new Claude models, MCPs, n8n patterns AND agent skills (skills.sh/skillsmp/skillhub) to system/landscape-log.jsonl; a weekly Claude digest proposes/skips each; models/MCPs/patterns route through a human-gated integration runbook, while matching skills AUTO-INSTALL via a deterministic audited installer (git-reversible). Alex proposes; Shaheen decides, except the skills lane self-installs.
- **26 Prompting** (ON-DEMAND; trigger: on-demand) - The translator function: Shaheen speaks plain English, Alex acts as a senior prompt engineer and returns a lean CONTEXT/INPUT/OUTPUT prompt for Claude Code; overlap check vs existing automations, one gap round with a defaults skip, skills resolved + named from the bindings table, pointer-style file references, then offers to run it on the spot.
- **27 Migration Engine** (ON-DEMAND; trigger: on-demand) - Run a large code/config migration as a dynamic workflow: parallel agents, per-unit self-verification, adversarial parity check, resumable + reversible. Refuses to run without a named target + a verification harness. No target committed yet (P9 dashboard.tsx extraction = the small hand-done precedent).
- **Voice** (EVENT; trigger: every Claude Code session (voice flag + hooks) + Ctrl+Alt+D dictate; v2 loop on-demand) - Voice v3 'ride the official surface' (research run 22, built 2026-07-12): two-way voice INSIDE the interactive Claude Code session. In: native /voice HOLD dictation (EN/SV, free, review-then-Enter - autoSubmit OFF by design vs acceptEdits) + Ctrl+Alt+D local-whisper dictate lane for AR/SV/EN (types into the prompt, never presses Enter). Out: Stop-hook Edge-TTS->SAPI never-mute speech, gated on outputs/voice/voice-on.flag ('voice on/off' to Alex). $0/mo, no long-lived audio process. v2 open-mic loop (alex_voice.py) stays the on-demand walk-around tool.
- **Alex Cost Tracker** (ON-DEMAND; trigger: monthly (piggybacks expense slot)) - What Alex itself costs: all-formula Excel + 3-page Power BI dashboard (~1,032 kr/mo run rate).
- **Modeling** (DORMANT, revisit 2026-08-01; trigger: -) - Modeling career run as an engineered system (shaheenkiarash.com on Cloudflare Workers). Content engine chosen 2026-07-15: self-hosted Postiz on the Hetzner box, auto-publish the approved queue, no auto-engagement. Config in work/modeling. DORMANT waiting on Shaheen: DNS, box deploy, an IG Business/Creator account. Own-n8n audience/lead-gen layers on after.

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
| Sprint Tracker | /sprint-tracker | weekdays at 9:00 AM |
| Morning Brief | /morning-brief | daily at 8:00 AM |
| Application Engine Watch | /application-engine | daily at 8:30 AM |
| Personal CRM | /personal-crm | Monday at 8:30 AM |
| Email Triage | /email-triage scheduled | 3x daily at 9:00 AM, 1:00 PM, 5:00 PM |
| Expense Wrangler | /expense-wrangler | monthly, last day of each month at 8:00 PM |
| Weekly Exec Report | /weekly-exec-report | Friday at 4:00 PM |
| WhatsApp Harvest (#11) | /whatsapp-harvest | on-demand (the retired Phase 1 slot was daily at 2:30 AM, a usage-based slot that ran while Shaheen slept; kept here as history only) |
| Airbnb Host | /airbnb-host (monthly-sync) | monthly on the 24th at 10:00 AM (Task Scheduler job PersonalOS-airbnb-host, **Interactive only** so the headed Chromium can render; reuses the saved login session) |
| Alex AI Radar (weekly sweep) | /alex-radar --weekly | Monday at 7:30 AM (Task Scheduler job PersonalOS-alex-radar; 07:30 so the output is in the vault before the 08:00 Morning Brief surfaces it as the Radar section) |
| Git Backup (Recovery Phase 0) | scripts/git-backup.ps1 (pure git, no claude call) | daily at 9:30 PM (Task Scheduler job PersonalOS-git-backup; RestartCount 2 / RestartInterval 30 min / ExecutionTimeLimit 30 min / StartWhenAvailable) |
| Vault Backup - encrypted local-only (Recovery Phase 1) | scripts/vault-backup.ps1 (pure PowerShell, no claude call) | daily at 9:45 PM (Task Scheduler job PersonalOS-vault-backup; StartWhenAvailable / ExecutionTimeLimit 30 min). Staggered 15 min after the git push. |
| Recovery Layer sweep (Recovery Phase 2) | work/18-recovery-layer/check.ps1 (pure PowerShell, no claude call, zero tokens) | Mondays at 7:30 AM (Task Scheduler job PersonalOS-recovery-check; StartWhenAvailable + WakeToRun + ExecutionTimeLimit 15 min; shares the Alex Radar Monday sweep slot). NO restart policy: exit 2 means drift-found (normal), not failure. |
| Vault Search Index (upgrade-scan item 1) | scripts/run-vault-index.ps1 (pure Python/SQLite, no claude call, zero tokens) | daily at 9:35 PM (Task Scheduler job PersonalOS-vault-index; StartWhenAvailable + battery-safe + ExecutionTimeLimit 15 min; NO restart ladder - a missed rebuild self-heals next night and on-demand `build` always works). Placed 10 min before the 21:45 vault backup so the fresh .db ships in the encrypted blob. |
| Alex HQ Local Push | /alex-hq | daily at 8:45 AM (staggered from 8:30 on 2026-07-12, upgrade P1/c11: it shared the slot with application-engine, both spawning Claude sessions with no serialization) |
| Runway Command Center | /runway | monthly, last day of month, AFTER /expense-wrangler (reads the freshest expense + booking data) |
| Interview-to-Offer Copilot | /interview | NO dedicated schedule. Event-driven (the morning brief flags interview invites/events) + on-demand /interview. No Task Scheduler job by design. |
| Teach-Alex Button | /teach-alex | NO dedicated schedule. Event-driven (a correction note in the alex_inbox, caught at the morning-brief inbox step + other touchpoints) + on-demand. No Task Scheduler job by design. |
| Alex Reviews Alex (Self-Review) | /self-review | weekly, Sunday 20:00 (quiet slot, before the Monday brief). **REGISTERED 2026-07-06:** job PersonalOS-self-review, wrapper scripts/run-self-review.ps1, standard hardening. Also on-demand. |
| Gated Monthly Lint (Recovery Phase 3) | scripts/run-lint.ps1 (checker first, then claude -p "/lint gated") | monthly, first Monday at 10:00 AM (Task Scheduler job PersonalOS-lint-monthly; after the 07:30 recovery sweep + radar and the 08:00 brief) |
| Auth Freshness Probe | scripts/auth-check.ps1 (one micro claude -p probe, pattern detection, HQ push) | weekly, Sunday at 7:30 PM (Task Scheduler job PersonalOS-auth-check; before the 20:00 self-review, ahead of the Monday job train) |
| Landscape Monitor (#25) | scripts/run-landscape-monitor.ps1 (pure Node, no claude call, zero tokens) | daily at 7:10 AM (Task Scheduler job PersonalOS-landscape-monitor; StartWhenAvailable + WakeToRun + battery-safe + ExecutionTimeLimit 30 min; RestartCount 2 / 30 min - light class, and the close-out lib self-schedules the real retry) |
| Voice-audio orphan sweep (#16 inbox, upgrade P12) - box-side cron, NOT a Windows task | - | daily 04:17 - `find /opt/alex-inbox-audio -type f -mtime +30 -delete`. |
| Landscape Eval (#25) | scripts/run-landscape-eval.ps1 (one claude -p call per week) | Monday at 7:50 AM (Task Scheduler job PersonalOS-landscape-eval; standard hardening RestartCount 4 / 90 min / ExecutionTimeLimit 2h, WakeToRun, battery-safe) |

## 7. Backup and recovery, in one paragraph

Git pushes the functional system (code + docs, never the vault or soul.md) to a private GitHub repo daily at 21:30. The personal half (vault, soul.md, secrets) ships daily at 21:45 as a gpg-encrypted blob to the n8n box, last 14 kept; the passphrase lives outside the repo and must also be in the password manager. A zero-token checker sweeps the whole system against `system/manifest.json` every Monday 07:30. Full detail: the Backup & Recovery section of `CLAUDE.md` and `vault/projects/recovery/` (local).

## 8. Success checklist

- `/status` runs and reports.
- After `/setup`, the folder opens with personality (soul.md hook fired).
- Services are connected (a real `/morning-brief` produces a real brief).
- A scheduled job has fired (check `outputs/logs/`).
- Backups are green (git 21:30, vault 21:45) and the vault passphrase is in your password manager.

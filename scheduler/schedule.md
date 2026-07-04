# Scheduled Tasks

This file is maintained by the agent. When the user asks to schedule something, add it here.

To activate these schedules: Open Cowork → Schedule sidebar → Create a local task for each entry below.

---

## Active Schedules

**Activated 2026-06-11 via Windows Task Scheduler.** Jobs: `PersonalOS-sprint-tracker` (weekdays 9:00), `PersonalOS-morning-brief` (daily 8:00), `PersonalOS-application-engine` (daily 8:30). Each runs `scripts/run-{name}.ps1` → headless `claude -p "Run /{name}"` → log in `outputs/logs/{name}.log`. No OAuth token needed; tasks run as the logged-in user and reuse existing credentials. Check: `schtasks /query /fo csv | findstr PersonalOS`.

<!-- Agent adds entries here when user requests a schedule -->
<!-- Format: -->
<!-- ### Task Name -->
<!-- - Command: /command-name -->
<!-- - Frequency: daily at 8:00 AM (or whatever) -->
<!-- - Description: what it does -->
<!-- - Added: YYYY-MM-DD -->

### Health Tracker (#17) — phone-side, NOT a Windows task
- Command: none (no /command, no Task Scheduler job).
- Frequency: **daily 23:59, triggered ON the iPhone** by a native Shortcuts time-automation (Shaheen builds it, guide `work/17-health-tracker/IPHONE-SHORTCUT.md`). It POSTs to the n8n webhook `/webhook/alex-health-ingest`; n8n scores + stores. Nothing to add to /cron-setup on this machine. **23:59 chosen (2026-07-04) so the day's steps are complete while "is today" still captures last night's sleep — one combined row/day.**
- Note: the ingest workflow (`WtOKBY00Cq1FhQ8T`) runs on the Hetzner box, always-on. Consumers (brief/HQ) read on their own schedules. If iOS skips a run, the pipeline is idempotent; optional 00:30 catch-up automation.
- Added: 2026-07-04

### Sprint Tracker
- Command: /sprint-tracker
- Frequency: weekdays at 9:00 AM
- Description: Reads the Notion Progress Tracker board, writes a standup summary to vault + Notion, appends velocity.
- Added: 2026-06-10
- **Task settings (hardened 2026-07-02, MUST survive any task re-creation):** RestartCount 4, RestartInterval 90 min, ExecutionTimeLimit 1h, StartWhenAvailable. The wrapper (scripts/run-sprint-tracker.ps1) exits 1 on login/quota/blank-output failures and pushes sprint/run_status RED to Alex HQ; the retry ladder (10:30/12:00/13:30/15:00) covers the 1pm session-limit reset. If /cron-setup re-creates this task, re-apply: `Set-ScheduledTask -TaskName "PersonalOS-sprint-tracker" -Settings (New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -WakeToRun -RestartCount 4 -RestartInterval (New-TimeSpan -Minutes 90) -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew)`

### Morning Brief
- Command: /morning-brief
- Frequency: daily at 8:00 AM
- Description: Unread Gmail (12h) + today's calendar + project context, priority-filtered. Writes vault history + Daily Briefs row in Notion.
- Added: 2026-06-10

### Application Engine Watch
- Command: /application-engine
- Frequency: daily at 8:30 AM
- Description: Reads the Job Search Pipeline sheet (run_log + needs_review) after the 07:00 pipeline run; reports drafts, costs, flags, anomalies; updates vault. Surveillance only, never modifies the workflow.
- Added: 2026-06-11

### Personal CRM
- Command: /personal-crm
- Frequency: Monday at 8:30 AM
- Description: Syncs the Notion Personal CRM from vault/people/ + Gmail/Calendar, builds the weekly follow-up list, stages voice-matched Gmail drafts behind a hard draft gate (never sends). Task Scheduler job PersonalOS-personal-crm.
- Added: 2026-06-11

### Email Triage
- Command: /email-triage scheduled
- Frequency: 3x daily at 9:00 AM, 1:00 PM, 5:00 PM
- Description: Classifies unread mail (Act Now/Read Later/Archive), pulls CRM sender context, writes voice-matched reply drafts to outputs/ (scheduled mode never stages blind). Task Scheduler jobs PersonalOS-email-triage-0900/1300/1700.
- Added: 2026-06-12

### Expense Wrangler
- Command: /expense-wrangler
- Frequency: monthly, last day of each month at 8:00 PM
- Description: Batch mode — Gmail receipts since last run + inbox files + bank cross-reference (Chrome), regenerates the branded 4-sheet Excel (all formulas) and the Notion Expenses DB. Task Scheduler job PersonalOS-expense-wrangler.
- Added: 2026-06-12

### Weekly Exec Report
- Command: /weekly-exec-report
- Frequency: Friday at 4:00 PM
- Description: Capstone. Aggregates all 9 automations + Gmail/Calendar into a branded 7-slide deck + Notion weekly page. Trend metrics to metrics-history. Task Scheduler job PersonalOS-weekly-exec-report.
- Added: 2026-06-12

### WhatsApp Harvest — PAUSED 2026-06-18 (Shaheen: eating tokens too fast)
- Status: **DISABLED** in Task Scheduler (`Disable-ScheduledTask PersonalOS-whatsapp-harvest`). Will not run until re-enabled. Re-enable with `Enable-ScheduledTask -TaskName 'PersonalOS-whatsapp-harvest'`.
- Command: /whatsapp-harvest
- Frequency (when active): daily at 2:30 AM (usage-based slot: runs while Shaheen sleeps so it never competes with his Claude limit; checkpoint-pushes each thread so consumed tokens always equal pushed data)
- Description: Reads WhatsApp through the official desktop client (read-only screen capture, zero ban risk). TEXT ONLY, never media; voice notes ignored (phase 2 decision pending). Harvests Shaheen's own lines into soul.md per-language voice registers, updates vault/people/ friend pages (context, never transcripts), flags 48h+ unanswered personal messages to the Morning Brief, writes a per-run harvest report + review queue for Shaheen's tag notes. Spec: work/11-whatsapp-harvest/CLAUDE.md.
- Added: 2026-06-12 (moved 21:30 → 02:30 same day per usage-based scheduling)

### Airbnb Host
- Command: /airbnb-host (monthly-sync)
- Frequency: monthly on the 24th at 10:00 AM (Task Scheduler job PersonalOS-airbnb-host, **Interactive only** so the headed Chromium can render; reuses the saved login session)
- Description: Read-only Playwright harvest of Shaheen's own Airbnb host dashboard. Wrapper runs scrape + ingest (rebuilds the income model Excel with real payouts), then the agent syncs the Notion Bookings DB + vault and flags new pending requests. No host API; guests stay transactional (no people pages). Spec: work/13-airbnb-host/CLAUDE.md.
- Added: 2026-06-14

---

### Alex AI Radar (weekly sweep)
- Command: /alex-radar --weekly
- Frequency: Monday at 7:30 AM (Task Scheduler job PersonalOS-alex-radar; 07:30 so the output is in the vault before the 08:00 Morning Brief surfaces it as the Radar section)
- Description: Weekly Stream B sweep on free feeds (HN, GitHub releases, Product Hunt, model changelogs, MCP registry). Scores against the taste profile, updates landscape memory, writes radars/YYYY-MM-DD.md + Notion AI Radar Tools rows (Status <= Interesting), auto deep-dives at most 2 items clearing 16/20 + 2 corroborations. Spec: work/15-alex-ai-radar/CLAUDE.md.
- Added: 2026-07-02 (Monday slot confirmed by Shaheen same day; Phase 1 live)

### Git Backup (Recovery Phase 0)
- Command: scripts/git-backup.ps1 (pure git, no claude call)
- Frequency: daily at 9:30 PM (Task Scheduler job PersonalOS-git-backup; RestartCount 2 / RestartInterval 30 min / ExecutionTimeLimit 30 min / StartWhenAvailable)
- Description: Commits the whole personal-os tree (respecting .gitignore: secrets/outputs/build artifacts excluded) and pushes to the private GitHub repo alex-kiarash-ai/personal-os. Pushes recovery/run_status GREEN to Alex HQ on success, RED with reason on failure, so a dead backup is never silent. PAT lives in Windows Credential Manager (expires ~2027-07, rotation note in the plan). Plan: vault/projects/recovery/github-backup-plan.md.
- Added: 2026-07-02

### Vault Backup — encrypted local-only (Recovery Phase 1)
- Command: scripts/vault-backup.ps1 (pure PowerShell, no claude call)
- Frequency: daily at 9:45 PM (Task Scheduler job PersonalOS-vault-backup; StartWhenAvailable / ExecutionTimeLimit 30 min). Staggered 15 min after the git push.
- Description: Closes the privacy-scrub gap. Tars everything git IGNORES (minus regenerable junk — set derived from .gitignore so it can't drift), gpg AES256-encrypts it, round-trip-verifies before shipping, scp's the single .gpg to n8n:/opt/alex-backups/ (last 14 kept), pushes recovery/vault_backup GREEN/RED to Alex HQ. Passphrase in C:\Users\Thinkpad\.alex-secrets\vault-backup.pass (OUTSIDE the repo, icacls-locked) — **must also be in Shaheen's password manager or the off-machine blob is unrecoverable if this machine dies.** Restore drill proven 2026-07-04. Plan: vault/projects/recovery/vault-backup-plan.md.
- Added: 2026-07-04

### Alex HQ Local Push
- Command: /alex-hq
- Frequency: daily at 8:30 AM
- Description: Build #16 local-side feed. Harvests the metrics only this ThinkPad can see (MCP tool count, vault page counts, scheduler health), pushes them to the Alex HQ ingest webhook, regenerates + ships the Brain graph (scp, no rebuild), then presents the health summary. Failure-tolerant; never prints the token. Spec: work/16-alex-hq/CLAUDE.md, command: .claude/commands/alex-hq.md.
- Added: 2026-07-02

---

## Task Hardening (Close-Out Gate, 2026-07-03)

Every scheduled wrapper dot-sources `scripts/lib/close-out.ps1` (shared mechanism). On a failed run (blank output, wrapper crash, not-logged-in, usage/session limit, non-zero exit) it logs `FAILED: reason`, pushes `run_status` RED to Alex HQ where a tile exists, and exits 1. No scheduled run can die silent (exit 0) anymore.

Retry ladders so a transient quota/auth fail self-heals instead of waiting a day/week/month. All tasks keep `MultipleInstances IgnoreNew`, `StartWhenAvailable`, `WakeToRun`, battery-safe.
- **Standard (daily/weekly/monthly):** RestartCount 4, RestartInterval 90 min, ExecutionTimeLimit 2h — morning-brief, application-engine, personal-crm, expense-wrangler, weekly-exec-report, airbnb-host, alex-radar, alex-hq, whatsapp-harvest (disabled).
- **Sprint Tracker:** RestartCount 4, 90 min, ExecutionTimeLimit 1h (see its entry).
- **Email Triage x3:** RestartCount 2, RestartInterval 60 min, ExecutionTimeLimit 2h — lighter because the 9/13/17 slots are only hours apart.
- **Git Backup:** RestartCount 2, 30 min, ExecutionTimeLimit 30 min.

Re-apply after any task re-creation (never `schtasks /change` — it hangs on a password prompt; use `Set-ScheduledTask`). Mutate-in-place preserves every other setting:
`$t = Get-ScheduledTask -TaskName <name>; $s = $t.Settings; $s.RestartCount = 4; $s.RestartInterval = 'PT90M'; $s.ExecutionTimeLimit = 'PT2H'; $s.WakeToRun = $true; Set-ScheduledTask -TaskName <name> -Settings $s`

Fixed 2026-07-03: alex-radar and sprint-tracker had `WakeToRun=False` (a Monday / weekday-morning laptop job that could not wake the machine = a silent miss); both flipped to True.

## How to Set Up in Cowork

For each entry above:
1. Open Claude Code Desktop (Cowork)
2. Click Schedule in the sidebar
3. Click New task → New local task
4. Name: use the task name above
5. Prompt: use the command above (e.g., "Run /morning-brief")
6. Frequency: match the frequency above
7. Enable "Keep computer awake" in Cowork Settings if you want it to run while you're away

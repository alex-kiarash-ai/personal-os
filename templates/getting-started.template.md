<!-- GENERATED FILE - do not hand-edit. Source: templates/getting-started.template.md + system/manifest.json + scheduler/schedule.md + CLAUDE.md. Regenerate: node scripts/generate-alex.js. Generated {{GENERATED_STAMP}}. -->

# Getting Started: set up and run the Personal OS

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

## 4. The automations ({{AUTOMATION_COUNT}} registered, non-retired)

The registry `system/manifest.json` is the source of truth; this list is generated from it.

{{AUTOMATION_LIST}}

**Utility commands:** {{UTILITY_COMMANDS}} (plus the global `/graphify`).

## 5. The tools Alex reaches (MCP)

MCP tools are deferred: load them with `ToolSearch("select:<tool>")` before calling. Prefer an MCP tool when one exists; use Chrome only for sites with no connector; never Chrome for Gmail, Calendar, or Notion. Connected surfaces named in the MCP Reference of `CLAUDE.md`:

{{MCP_LIST}}

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
{{SCHEDULED_JOBS}}

## 7. Backup and recovery, in one paragraph

Git pushes the functional system (code + docs, never the vault or soul.md) to a private GitHub repo daily at 21:30. The personal half (vault, soul.md, secrets) ships daily at 21:45 as a gpg-encrypted blob to the n8n box, last 14 kept; the passphrase lives outside the repo and must also be in the password manager. A zero-token checker sweeps the whole system against `system/manifest.json` every Monday 07:30. Full detail: the Backup & Recovery section of `CLAUDE.md` and `vault/projects/recovery/` (local).

## 8. Success checklist

- `/status` runs and reports.
- After `/setup`, the folder opens with personality (soul.md hook fired).
- Services are connected (a real `/morning-brief` produces a real brief).
- A scheduled job has fired (check `outputs/logs/`).
- Backups are green (git 21:30, vault 21:45) and the vault passphrase is in your password manager.

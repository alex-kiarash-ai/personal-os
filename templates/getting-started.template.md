<!-- GENERATED FILE - do not hand-edit. Source: templates/getting-started.template.md + system/manifest.json + scheduler/schedule.md + CLAUDE.md. Regenerate: node scripts/generate-alex.js. Generated {{GENERATED_STAMP}}. -->

# Getting Started: set up and run the Personal Ops System

This is the onboarding and operations guide: what you need, how to boot Alex, what runs, and how the schedules work. For how the system is designed and how Alex behaves, read `docs/ARCHITECTURE.md`.

## 1. What you need

- **A paid Claude account** (Max recommended; Pro burns out fast). Alex *is* Claude, no subscription is no brain.
- **Claude Code** (desktop app / Cowork, or the CLI). **Linux is where Alex runs** (the scheduled job train is systemd user timers); macOS works for development.
- **A Google account** (Gmail, Calendar, Drive). **Notion** (free), optional for the base brain but required for the CRM, expenses, and meeting-intel databases (without it Alex degrades to local files, per the Bootstrap rule). **Obsidian** (free, to read the vault).
- **Optional, only if you want the Alex HQ dashboard's own source:** the `alex-hq` repo. It split out of this one on 2026-08-04 and is expected to sit **beside** `personal-os`, as a sibling folder, not inside it. You do **not** need it to run the Personal Ops System: everything except the dashboard's own build works without it, and the two things that do want it (the brand-token generator and validator check V8) say so plainly and carry on. If you keep it somewhere other than a sibling folder, record that once in `system/manifest.json` → `meta.paths.alex_hq_repo`, or set an `ALEX_HQ_REPO` environment variable. Nothing needs configuring when the sibling layout holds.
- Base install is about an hour.

## 2. Install and first boot

1. **Install Claude Code:** desktop app from claude.com/claude-code, or the CLI installer (`curl -fsSL https://claude.ai/install.sh | bash` on Linux/Mac; `npm install -g @anthropic-ai/claude-code` also works).
2. **Get the files:** a direct copy (USB/zip) from Shaheen, OR `git clone` the **public** repo (public since 2026-07-16). **Important:** the repo is scrubbed, so a git clone gives you a **vault-less skeleton** (the entire `vault/`, `soul.md`, and `work/*/config` are gitignored and local-only). Only a direct copy from Shaheen carries personal data. Because the repo is public, anyone can clone this skeleton, so the scrub + `.gitignore` are the only things keeping personal data off it.
3. **Point Claude Code at the folder. This is the step everything else depends on, and it is the one people get wrong.** Claude Code only becomes Alex inside the folder it is *opened in*. Dragging the folder into the chat, attaching `CLAUDE.md`, or pasting a file path does **not** work: you get plain Claude, no commands, no memory, no personality. You do this once per machine and Claude Code remembers it.
   - **Desktop app (Cowork):** start a new session, and when it asks for a folder pick the `personal-os` folder you just downloaded. It stays in your recent folders from then on, so every later session is one click.
   - **Command line:** move into the folder *first*, then start Claude Code:
     ```
     cd ~/personal-os
     claude
     ```
     Replace the path with wherever you actually saved the folder. Starting `claude` from your home folder and opening files from there is the single most common first-session mistake.
   - **Do not** open a *subfolder* (like `work/` or `docs/`) and expect the commands to work. The folder you open must be the one that directly contains `CLAUDE.md` and `soul.md`.
4. **First boot: check it worked before you do anything else.** Type `/status`.
   - If Alex answers with a status report, the folder is loaded correctly. Go to step 5.
   - If you get "unknown command" or plain-Claude chat, the folder is **not** loaded. Close the session and redo step 3. Nothing below will work until `/status` responds.
   - If you cloned the repo there is no soul.md yet, so the first reply is plain Claude even when the folder *is* loaded correctly. That is expected: `/status` still answers, and personality appears after `/setup` writes soul.md. If you *have* soul.md and still get plain Claude, the session hook needs `cat` (present on any Linux/macOS install).
5. **Run `/setup` as your first real prompt.** That is the whole first-session instruction: open the folder, `/status` to confirm, then type `/setup` and answer its questions. It walks you through identity, brand, and the vault one step at a time.
6. **Connect services** at claude.ai, Settings, Connectors: Gmail, Calendar, Drive (one Google sign-in), Notion (optional). The in-app `/mcp` manager inside Claude Code is an alternative path to the same connectors. These are one-time authentications; they persist across sessions. Install the "Claude in Chrome" extension for browser control. (GitHub is used only for backup via git + a token, not a connector.)
7. **Optional phone control:** pair the Claude Code Desktop app (Cowork) with the mobile app so you can send Alex tasks from your phone. The Alex HQ dashboard is a separate phone surface for reading metrics.

**The first session, in four lines.** Open the `personal-os` folder in Claude Code (not the file, the folder). Type `/status` to confirm it loaded. Type `/setup` and answer the questions. Then `/brand`. Every session after that, open the same folder and just talk.

## 3. Make it yours

- **Run `/setup` first.** It interviews you and generates `soul.md` and the vault. Then run `/brand` for the brand config.
- **Then hand-refine `soul.md`** (the biggest lever, that is your identity and voice).
- Start building automations with `/new` and the per-project `work/{n}/CLAUDE.md` specs. `/new` writes the registry entry in `system/manifest.json` FIRST, then scaffolds.

## 4. The automations ({{AUTOMATION_COUNT}} registered, non-retired)

The registry `system/manifest.json` is the source of truth; this list is generated from it.

{{AUTOMATION_LIST}}

**Utility commands:** {{UTILITY_COMMANDS}}.

## 5. The tools Alex reaches (MCP)

MCP tools are deferred: load them with `ToolSearch("select:<tool>")` before calling. Prefer an MCP tool when one exists; use Chrome only for sites with no connector; never Chrome for Gmail, Calendar, or Notion. Connected surfaces named in the MCP Reference of `CLAUDE.md`:

{{MCP_LIST}}

## 6. Scheduling (systemd user timers)

Nothing runs until you schedule it. On this machine the scheduler is **systemd user timers**;
`/cron-setup` builds the jobs from `scheduler/schedule.md`, and `node scripts/generate-alex.js`
writes the unit files into `systemd/`. The best first schedule is the morning brief, daily 8:00.

- **How a scheduled `claude -p` job works:** the timer fires at a time, runs `claude -p "Run
  /{command}" --dangerously-skip-permissions`, the work happens, the process exits, each run is a
  fresh session. The skip-permissions flag is required because a headless run has no TTY to approve
  prompts (do not carry it into interactive use). The jobs run as your own user and reuse existing
  credentials, so no OAuth token is needed.
- **Run `loginctl enable-linger $USER` once.** Without it, user timers only fire while you are
  logged in, so a headless box silently runs nothing at all, with no error anywhere. This is the
  single easiest thing to forget and the hardest to diagnose after the fact.
- **The real jobs are hardened, not naive one-shots:** the scheduled wrappers are `.sh` scripts that
  detect failure, push a RED/GREEN `run_status` to Alex HQ so a dead run is never silent, and
  self-schedule one-shot retries past the quota reset. When you add a new scheduled automation, wrap
  it the same way; do not schedule a bare `claude -p`.
- **Not every job is a `claude -p` run.** Some are zero-token scripts or remote n8n: the recovery
  checker, the git and vault backups, the vault search index, the health ingest (n8n, phone-triggered).
- **Check a job:** `systemctl --user list-timers --all`, logs in `outputs/logs/{name}.log` plus
  `journalctl --user -u PersonalOS-{name}.service` for anything the wrapper never got to write.
  Pause all: `/cron-setup off`. Pause one: `/cron-setup off {name}`. Resume: `/cron-setup on`.
- **Set the machine timezone before enabling anything** (`sudo timedatectl set-timezone
  Europe/Stockholm`): every schedule is wall-clock local time.
- **On macOS none of this exists**, and that is expected: the dev machine has no systemd, so
  `systemd/` is inert there and the generator degrades to a loud skip rather than pretending.

### The scheduled jobs (from scheduler/schedule.md)

| Job | Command | Frequency |
|---|---|---|
{{SCHEDULED_JOBS}}

## 7. Backup and recovery, in one paragraph

Git pushes the functional system (code + docs, never the vault or soul.md) to a GitHub repo (public since 2026-07-16; scrubbed, so `.gitignore` is the sole barrier keeping personal data off it) daily at 21:30. The personal half (vault, soul.md, secrets) ships daily at 21:45 as a gpg-encrypted blob to the n8n box, last 14 kept; the passphrase lives outside the repo and must also be in the password manager. A zero-token checker sweeps the whole system against `system/manifest.json` every Monday 07:30. Full detail: the Backup & Recovery section of `CLAUDE.md` and `vault/projects/recovery/` (local).

## 8. Success checklist

- `/status` runs and reports.
- After `/setup`, the folder opens with personality (soul.md hook fired).
- Services are connected (a real `/morning-brief` produces a real brief).
- A scheduled job has fired (check `outputs/logs/`).
- Backups are green (git 21:30, vault 21:45) and the vault passphrase is in your password manager.

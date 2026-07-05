# How to Schedule Claude Code to Run Automatically

## What This Does

A scheduled job fires at your chosen time, runs `claude -p "Run /{command}" --dangerously-skip-permissions`, Claude does the work, the process exits. Each run is a fresh session. **On this machine the scheduler is Windows Task Scheduler** (macOS/Linux use `cron`, shown below as the alternative).

Note: not every scheduled job is a `claude -p` run. Some are **zero-token scripts or remote n8n**: the recovery checker (`check.ps1`, Mon 07:30), the git + vault backups (21:30 / 21:45), and the health ingest (n8n, phone-triggered).

## Prerequisites

1. **Claude Code CLI**: `claude --version`
2. **Auth**: on this machine the Task Scheduler jobs run **as the logged-in user and reuse the existing Claude credentials, so no OAuth token is needed.** A `claude setup-token` token (`sk-ant-oat01-...`) is only required for a truly detached cron (e.g. a headless Linux/macOS server, or a job that runs when you're logged out).
3. **Binary paths** (for a detached/cron setup): `where claude` (Windows) / `which claude python3` (Mac/Linux).

## Setup

Run `/cron-setup` in your Personal OS, it handles everything (builds the Task Scheduler jobs from `scheduler/schedule.md`). Or set up manually:

### Windows (Task Scheduler), this machine

Create a Basic Task (or via `schtasks`), Action = "Start a program", with:
```powershell
# Program:   powershell.exe
# Arguments: -NoProfile -Command "Set-Location 'C:\Users\Thinkpad\Desktop\personal-os'; claude -p 'Run /morning-brief' --dangerously-skip-permissions *>> outputs\logs\morning-brief.log"
# Run:       whether user is logged on or not = OFF for credential-reuse jobs (they run as the logged-in user)
```
The real jobs are `.ps1` wrappers (see below), not one-liners.

### macOS / Linux (crontab), alternative only

```bash
crontab -e
# weekdays at 8 AM (detached, so it needs the OAuth token)
0 8 * * 1-5 cd /path/to/personal-os && export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-YOUR_TOKEN && export PATH=/Users/you/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin && export HOME=/Users/you && claude -p "Run /morning-brief" --dangerously-skip-permissions >> outputs/logs/morning-brief.log 2>&1 # personal-os:morning-brief
```

## The real jobs are hardened, not naive one-shots

The production wrappers (`.ps1`) do more than fire once:
- **Failure detection + RED/GREEN**: the wrapper checks the run succeeded and pushes a `run_status` (RED on failure, GREEN on success) to Alex HQ, so a dead run is never silent (this is what caught the sprint-tracker blackout).
- **Retry ladder**: on a session/quota failure it retries past the daily quota reset (the sprint tracker uses a 4x90-min ladder).
- **Close-Out enforcement**: mechanical checks (vault entry written? HQ push OK? exit non-zero on a miss?) run inside the wrapper.

When you add a new scheduled automation, wrap it the same way, don't schedule a bare `claude -p`.

## Key Rules

- A scheduled job has NO shell profile: put all env vars inline (for the detached/cron path).
- Full paths for binaries in a detached setup.
- Always `Set-Location` / `cd` to the project directory first.
- Always `--dangerously-skip-permissions` (a headless run has no TTY to approve prompts; do not carry this into interactive use).
- Always redirect output to a log (`*>> log` in PowerShell, `>> log 2>&1` in bash).
- Tag entries: `# personal-os:{name}`.

## Management

- **Windows:** `schtasks /query /fo LIST | findstr PersonalOS`, or open Task Scheduler and look under the `PersonalOS-*` jobs. macOS/Linux: `crontab -l | grep personal-os`.
- Pause all: `/cron-setup off` · Pause one: `/cron-setup off morning-brief` · Resume: `/cron-setup on`.
- Check logs: open `outputs/logs/{name}.log` (each job appends its own).

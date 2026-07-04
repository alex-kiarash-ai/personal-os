# How to Schedule Claude Code to Run Automatically

## What This Does

A cron job fires at your chosen time, runs `claude -p "your prompt" --dangerously-skip-permissions`, Claude does the work, process exits. Each run is a fresh session.

## Prerequisites

1. **Claude Code CLI**: `claude --version`
2. **Auth token**: Run `claude setup-token` once. Save the token (starts with `sk-ant-oat01-...`). Valid 1 year.
3. **Binary paths**: `which claude` and `which python3`

## Setup

Run `/cron-setup` in your Personal OS. It handles everything. Or set up manually:

### macOS / Linux (crontab)

```bash
crontab -e

# Example: weekdays at 8 AM
0 8 * * 1-5 cd /path/to/personal-os && export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-YOUR_TOKEN && export PATH=/Users/you/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin && export HOME=/Users/you && claude -p "Run /morning-brief" --dangerously-skip-permissions >> outputs/logs/morning-brief.log 2>&1 # personal-os:morning-brief
```

### Windows (Task Scheduler)

```powershell
$env:CLAUDE_CODE_OAUTH_TOKEN = "sk-ant-oat01-YOUR_TOKEN"
Set-Location "C:\path\to\personal-os"
claude -p "Run /morning-brief" --dangerously-skip-permissions | Out-File -Append "outputs\logs\morning-brief.log"
```

## Key Rules

- Cron has NO shell profile. All env vars inline.
- Full paths for binaries.
- Always `cd` to project directory first.
- Always `--dangerously-skip-permissions`.
- Always redirect: `>> log 2>&1`
- Tag entries: `# personal-os:{name}`

## Management

- See all: `crontab -l | grep personal-os`
- Pause all: `/cron-setup off`
- Pause one: `/cron-setup off morning-brief`
- Resume: `/cron-setup on`
- Check logs: `cat outputs/logs/morning-brief.log`

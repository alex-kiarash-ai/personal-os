# /cron-setup - Manage System Schedules

Three modes: on, off, or update.

## Usage
- `/cron-setup` or `/cron-setup on` - Activate all schedules
- `/cron-setup off` - Turn off ALL jobs
- `/cron-setup off morning-brief` - Turn off a specific job
- `/cron-setup off morning-brief market-pulse` - Turn off multiple

## Prerequisites (smart check)

1. **Auth token**: First, check if personal-os cron entries already exist in crontab (`crontab -l | grep personal-os`). If entries exist, the token is already embedded in them. Extract it. Do NOT ask the user again.
   - Only if NO existing entries AND no token found: tell the user "Open a new terminal tab. Run `claude setup-token`. Paste the token here."
   - Save the token in vault/projects/cron-token.md (encrypted reference, not the raw token) so the agent knows it's been set up before.

2. **Binary paths**: Run `which claude` and `which python3`. Cache in vault/projects/cron-paths.md so you don't re-check every time.

3. **Log directory**: `mkdir -p outputs/logs`

## How "On" Works

1. Read scheduler/schedule.md for all active schedules
2. Detect OS (macOS/Linux/Windows)
3. Check existing crontab for personal-os entries
4. If entries exist: compare with schedule.md. Add new ones, update changed ones, skip unchanged.
5. If no entries exist: first-time setup. Need token and paths.
6. For each entry in schedule.md: create or update the cron line
7. Report what was activated

### Cron Entry Format (macOS and Linux)

Each job is one crontab line. ALL env vars inline. Full paths. No shell profile.

**CRITICAL: The `cd` MUST come first.** Cron runs from `/`. Without `cd`, claude can't find soul.md, vault/, or any project files. This is the #1 cron failure.

```
CRON_EXPRESSION cd /full/path/to/personal-os && export CLAUDE_CODE_OAUTH_TOKEN=TOKEN && export PATH=/path/to/claude/dir:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin && export HOME=/Users/username && claude -p "Run /command-name" --dangerously-skip-permissions >> outputs/logs/command-name.log 2>&1 # personal-os:command-name
```

**After writing the cron entry, verify it starts with `cd /absolute/path &&`.** If the `cd` is missing, the job WILL fail silently.

The `# personal-os:command-name` comment tags the entry so we can find/update/remove it later.

### Windows (Task Scheduler)

For each job, create a PowerShell script and register it:
```powershell
$env:CLAUDE_CODE_OAUTH_TOKEN = "TOKEN"
Set-Location "C:\path\to\personal-os"
claude -p "Run /command-name" --dangerously-skip-permissions | Out-File -Append "outputs\logs\command-name.log"
```
Register: `schtasks /create /tn "PersonalOS-command-name" /tr "powershell -File scripts\command-name.ps1" /sc daily /st 08:00`

## How "Off" Works

If `/cron-setup off` (no name):
- List all personal-os entries in crontab
- Ask: "Turn off all, or specific ones?"
- Remove matching lines from crontab
- "All schedules paused. Run /cron-setup to re-enable."

If `/cron-setup off {name}`:
- Remove only the line with `# personal-os:{name}`
- "{name} paused. Others still running."

## Mandatory Test

After adding cron entries, run a self-test:
1. Add a test entry for 2-3 minutes from now that writes `echo "CRON_TEST_OK" > outputs/logs/cron-test.txt`
2. Wait for it to fire
3. Check the file exists
4. If it fails: check PATH, auth token, cd, permissions
5. Only after test passes, confirm the permanent schedule
6. Clean up test entries and test files

## Important Notes
- Cron has NO shell profile. Every env var must be exported inline.
- Always use full paths for binaries (`which claude` to find it)
- Always `cd` to personal-os directory first
- Always include `--dangerously-skip-permissions`
- Always redirect stdout AND stderr: `>> log 2>&1`
- macOS first run may show a permission popup. Click Allow.
- Tag every entry with `# personal-os:{name}` for management

## After Setup
- Report: what jobs were created, their schedules, how to check logs
- Show: `crontab -l | grep personal-os` to see all entries
- Show: `cat outputs/logs/{name}.log` to check output
- Update vault/log.md

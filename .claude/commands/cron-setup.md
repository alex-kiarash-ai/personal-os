# /cron-setup - Manage System Schedules

Manage the local scheduled jobs. On this machine that means **Windows Task Scheduler**, one job per
entry in `scheduler/schedule.md`, named `PersonalOS-{name}`, each running a **hardened wrapper**
`scripts/run-{name}.ps1` (never a bare `claude -p`). Modes: on, off, update.

## Usage
- `/cron-setup` or `/cron-setup on` - Register/refresh every job in scheduler/schedule.md
- `/cron-setup off` - Disable ALL PersonalOS jobs
- `/cron-setup off morning-brief` - Disable one job
- `/cron-setup off morning-brief personal-crm` - Disable several
- `/cron-setup on morning-brief` - Re-enable a specific job

## Reality on this machine (read first)
- **No auth token.** Tasks run as the logged-in user and reuse the existing Claude Code login. The old
  `CLAUDE_CODE_OAUTH_TOKEN` / `claude setup-token` flow is gone - do NOT ask for a token.
- **Source of truth:** `scheduler/schedule.md` (the `### ` entries carry the job name + frequency). The
  unified generator `node scripts/generate-alex.js` CREATES MISSING tasks from it (create-missing-only,
  never touching an existing job's hardening). `/cron-setup` is for the manual on/off/enable/disable and
  for re-applying hardening after a task is re-created. Both read the same schedule.md.
- **Validation couples them:** `scripts/validate-alex.js` check V2 compares schedule.md against the live
  `schtasks` set. A job documented in schedule.md with no live task (or a live PersonalOS job absent from
  schedule.md) fails V2 and blocks commits. So schedule.md and Task Scheduler must always agree.
- **Check state:** `schtasks /query /fo csv | findstr PersonalOS`. Logs: `outputs/logs/{name}.log`.

## How "On" works
1. Read `scheduler/schedule.md` for every `### ` entry (name, command, frequency).
2. For each entry, confirm a hardened wrapper `scripts/run-{name}.ps1` exists (dot-sources
   `scripts/lib/close-out.ps1`; a wrapper that runs a real automation ends with `Invoke-CloseOutCheck`).
   If the wrapper is missing, create it from the pattern (see run-alex-radar.ps1 / run-landscape-monitor.ps1)
   BEFORE registering the task - never schedule a bare `claude -p`.
3. Register any missing task (either `node scripts/generate-alex.js` for the whole set, or
   `Register-ScheduledTask` directly for one), then apply the hardening for its class (below).
4. Report what was registered and what already existed.

### Registering one task (PowerShell, current user, no password prompt)
```powershell
$repo = "C:\Users\Thinkpad\Desktop\personal-os"
$a = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$repo\scripts\run-{name}.ps1`""
$t = New-ScheduledTaskTrigger -Daily -At 8:00am   # or -Weekly -DaysOfWeek Monday -At 7:30am, etc.
$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2) -RestartCount 4 -RestartInterval (New-TimeSpan -Minutes 90)
Register-ScheduledTask -TaskName "PersonalOS-{name}" -Action $a -Trigger $t -Settings $s -Force
```

### Hardening classes (canonical list: scheduler/schedule.md "Task Hardening")
- **Standard (daily/weekly/monthly claude jobs):** RestartCount 4 / RestartInterval 90 min / ExecutionTimeLimit 2h.
- **Light (probes + zero-token scripts, e.g. git-backup, vault-index, landscape-monitor):** RestartCount 2 / 30 min / ExecutionTimeLimit 30 min.
- All jobs: `StartWhenAvailable`, `WakeToRun`, battery-safe, `MultipleInstances IgnoreNew`.
- **The real retry is NOT RestartCount.** Task Scheduler's RestartCount only fires on a LAUNCH failure,
  not on a wrapper that runs and exits 1 (proven 2026-07-06). The working retry is the close-out lib's
  self-scheduled one-shot `PersonalOS-retry-{wrapper}-{n}` (+90 min, attempts 2-5, auto-deletes). The
  RestartCount ladders stay as belt-and-suspenders for launch failures.

## How "Off" works
- `/cron-setup off` (no name): list the live PersonalOS jobs, confirm, then
  `Disable-ScheduledTask -TaskName PersonalOS-{name}` for each. Disable, don't delete - a disabled job
  keeps its hardening and stays documented in schedule.md, so V2 still sees it (mark it disabled in
  schedule.md, as whatsapp-harvest is).
- `/cron-setup off {name}`: `Disable-ScheduledTask -TaskName PersonalOS-{name}` for that one.
- Re-enable: `Enable-ScheduledTask -TaskName PersonalOS-{name}`.

## Changing an existing task - NEVER `schtasks /change`
`schtasks /change` hangs on a password prompt in this environment. Mutate in place instead, which
preserves every other setting:
```powershell
$t = Get-ScheduledTask -TaskName "PersonalOS-{name}"; $s = $t.Settings
$s.RestartCount = 4; $s.RestartInterval = 'PT90M'; $s.ExecutionTimeLimit = 'PT2H'; $s.WakeToRun = $true
Set-ScheduledTask -TaskName "PersonalOS-{name}" -Settings $s
```

## After setup
- Report: jobs registered/enabled/disabled, their schedules, `schtasks /query /fo csv | findstr PersonalOS`.
- If schedule.md changed, run `node scripts/generate-alex.js` so the docs regenerate and V2 re-checks
  schedule.md against the live set.
- Append the change to `vault/log.md`; update `scheduler/schedule.md` if a job was added/removed/retimed.

## Other platforms (portability note)
This command is Windows-first because that is where Alex runs. On macOS/Linux the equivalent is a per-job
`crontab` line that `cd`s into the repo first and runs the same wrapper; the schedule.md contract and the
generator's create-missing behavior are the same. Do not reintroduce an OAuth token - reuse the logged-in
session.

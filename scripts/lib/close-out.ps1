# scripts/lib/close-out.ps1
# Shared Close-Out Gate mechanical checks for scheduled Personal OS wrappers.
# Canonical mechanism for the Close-Out Gate (vault/research/alex-close-out-gate.md).
#
# Implements:
#   A1 - blocked/degraded detection (blank output, wrapper crash, not-logged-in, usage/session
#        limit, non-zero claude exit) so a dead run is never silently reported as success.
#   A4 - RED run_status push to Alex HQ on failure (only when a project key is given), so a
#        failed scheduled run shows up on the health board instead of dying quiet.
# On failure it exits 1 so a task with a restart policy retries past a quota reset; on success
# it returns (the caller exits 0 naturally). The GREEN push stays inside each automation's post-run.
#
# Usage from a wrapper (after the agent run, with $out captured and $code = $LASTEXITCODE):
#   . "scripts\lib\close-out.ps1"
#   Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project 'crm'
# Project '' (or omitted) = detect + exit only, no HQ push (for wrappers with no run_status tile).

function Invoke-CloseOutCheck {
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Out,  # captured claude output
        [int]$Code = 0,                                          # claude $LASTEXITCODE
        [Parameter(Mandatory)][string]$Log,                      # log file path
        [string]$Project = '',                                   # Alex HQ project key; '' = no push
        [switch]$DryRun
    )

    # --- A1: blocked/degraded detection (the 06-26/29/30 blackout classes) ---
    # Content-pattern checks (not-logged-in / limit) only apply to SHORT output: a genuinely blocked
    # run emits nothing but the error line (<~500 chars), while a real run emits kilobytes. Without
    # the gate, a successful run whose PROSE mentions the incident ("died on the session limit")
    # false-flags itself - happened live 2026-07-06 22:03 (morning-brief catch-up brief).
    $reason = $null
    $short = ($Out -replace '\s', '').Length -lt 500
    if (($Out -replace '\s', '').Length -eq 0) {
        $reason = 'blank output (silent fail)'
    } elseif ($Out -match 'WRAPPER EXCEPTION') {
        $line = ($Out -split "`r?`n" | Where-Object { $_ -match 'WRAPPER EXCEPTION' } | Select-Object -First 1)
        $reason = if ($line) { $line.Trim() } else { 'wrapper exception' }
        if ($reason.Length -gt 140) { $reason = $reason.Substring(0, 140) }
    } elseif ($short -and $Out -match 'Not logged in|Please run /login') {
        $reason = 'not logged in - needs interactive claude /login'
    } elseif ($short -and $Out -match 'session limit|usage limit|API usage limits|reached your .{0,40}limit') {
        $line = ($Out -split "`r?`n" | Where-Object { $_ -match 'limit' } | Select-Object -First 1)
        $reason = if ($line) { $line.Trim() } else { 'usage/session limit' }
        if ($reason.Length -gt 140) { $reason = $reason.Substring(0, 140) }
    } elseif ($Code -ne 0) {
        $reason = "claude exit code $Code"
    }

    if ($null -eq $reason) {
        "OK (exit $Code)" | Out-File -Append -Encoding utf8 $Log
        return
    }

    "FAILED: $reason" | Out-File -Append -Encoding utf8 $Log

    # --- A4: RED run_status push to Alex HQ. Never log the token; never let the push crash the wrapper. ---
    if ($Project -ne '') {
        $tokenFile = "work\16-alex-hq\config\alex-hq-token.txt"
        if (Test-Path $tokenFile) {
            $token = (Get-Content $tokenFile -Raw).Trim()
            $body = @{
                project    = $Project
                metric_key = 'run_status'
                value_num  = 0
                headline   = "scheduled run failed: $reason"
                status     = 'red'
            } | ConvertTo-Json -Compress
            if ($DryRun) {
                "DRYRUN, would push: $body" | Out-File -Append -Encoding utf8 $Log
            } else {
                try {
                    Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
                        -Headers @{ 'X-Alex-Token' = $token } -ContentType 'application/json' `
                        -Body $body -TimeoutSec 10 | Out-Null
                    "HQ red push sent (project=$Project)" | Out-File -Append -Encoding utf8 $Log
                } catch {
                    "HQ push failed: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $Log
                }
            }
        } else {
            "HQ push skipped: token file missing" | Out-File -Append -Encoding utf8 $Log
        }
    } else {
        "HQ push skipped: no run_status tile for this wrapper" | Out-File -Append -Encoding utf8 $Log
    }

    # --- Self-scheduled retry (added 2026-07-06). Task Scheduler's RestartCount does NOT fire on a
    # non-zero exit code (proven 2026-07-06: four exit-1 limit failures at 07:30-09:00, RestartCount=4
    # on every task, zero restarts). So a failed wrapper schedules its OWN one-shot retry task 90 min
    # out, up to 4 retries (attempts 2-5), so a transient quota/auth window self-heals. The attempt
    # number rides $env:ALEX_RETRY_ATTEMPT; the one-shot task auto-deletes after its window passes.
    $attempt = 1
    if ($env:ALEX_RETRY_ATTEMPT -match '^\d+$') { $attempt = [int]$env:ALEX_RETRY_ATTEMPT }
    $wrapper = (Get-PSCallStack | Where-Object { $_.ScriptName -and $_.ScriptName -ne $PSCommandPath } |
                Select-Object -First 1).ScriptName
    if (-not $wrapper) {
        "retry skipped: calling wrapper path unknown" | Out-File -Append -Encoding utf8 $Log
    } elseif ($attempt -ge 5) {
        "retry chain exhausted (attempt $attempt/5), giving up until the next scheduled slot" | Out-File -Append -Encoding utf8 $Log
    } else {
        $next = $attempt + 1
        $rname = "PersonalOS-retry-$([IO.Path]::GetFileNameWithoutExtension($wrapper))-$next"
        $rat = (Get-Date).AddMinutes(90)
        if ($DryRun) {
            "DRYRUN, would register $rname at $($rat.ToString('HH:mm'))" | Out-File -Append -Encoding utf8 $Log
        } else {
            try {
                $act = New-ScheduledTaskAction -Execute 'powershell.exe' `
                    -Argument "-NoProfile -ExecutionPolicy Bypass -Command `"& { `$env:ALEX_RETRY_ATTEMPT='$next'; & '$wrapper'; exit `$LASTEXITCODE }`""
                $trg = New-ScheduledTaskTrigger -Once -At $rat
                $trg.EndBoundary = $rat.AddMinutes(60).ToString("yyyy-MM-dd'T'HH:mm:ss")
                $set = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries `
                    -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew `
                    -ExecutionTimeLimit (New-TimeSpan -Hours 2) -DeleteExpiredTaskAfter (New-TimeSpan -Hours 1)
                Register-ScheduledTask -TaskName $rname -Action $act -Trigger $trg -Settings $set -Force | Out-Null
                "retry $next/5 scheduled: $rname at $($rat.ToString('HH:mm'))" | Out-File -Append -Encoding utf8 $Log
            } catch {
                "retry registration failed: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $Log
            }
        }
    }

    exit 1
}

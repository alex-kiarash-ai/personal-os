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
    $reason = $null
    if (($Out -replace '\s', '').Length -eq 0) {
        $reason = 'blank output (silent fail)'
    } elseif ($Out -match 'WRAPPER EXCEPTION') {
        $line = ($Out -split "`r?`n" | Where-Object { $_ -match 'WRAPPER EXCEPTION' } | Select-Object -First 1)
        $reason = if ($line) { $line.Trim() } else { 'wrapper exception' }
        if ($reason.Length -gt 140) { $reason = $reason.Substring(0, 140) }
    } elseif ($Out -match 'Not logged in|Please run /login') {
        $reason = 'not logged in - needs interactive claude /login'
    } elseif ($Out -match 'session limit|usage limit|API usage limits') {
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

    # Non-zero exit -> a task with a restart policy retries (covers the 1pm quota reset).
    exit 1
}

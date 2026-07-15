# scripts/lib/close-out.ps1
# Shared Close-Out Gate mechanical checks for scheduled Personal Ops System wrappers.
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

# --- P3 quota-state writer (upgrade 2026-07-12, design 1.7.1) -----------------------------------
# One shared code path for flagging a detected cap. Kind 'plan' = the Claude subscription limit
# (auto-resets in hours; the gate's 6h TTL handles recovery). Kind 'api' = the Anthropic Console
# monthly cap (also auto-appends the Console-raise row to the human-actions queue, idempotent).
# BOM-free write - node consumers choke on PS 5.1's utf8 BOM.
function Set-AlexQuotaCapped {
    param(
        [Parameter(Mandatory)][ValidateSet('plan', 'api')][string]$Kind,
        [Parameter(Mandatory)][string]$Log
    )
    try {
        $qsPath = Join-Path (Get-Location) "system\quota-state.json"
        $qs = Get-Content $qsPath -Raw | ConvertFrom-Json
        $now = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
        if ($Kind -eq 'api') {
            # BUG-02 fix (2026-07-15): only enqueue the Console-raise row on the ok->capped TRANSITION,
            # never on every capped re-detection during a weeks-long cap. Otherwise a closed-then-recapped
            # item resurrects and poisons the "waiting on you" queue's trust.
            $wasCapped = ($qs.anthropic_api.state -eq 'capped')
            $qs.anthropic_api.state = 'capped'; $qs.anthropic_api.detected = $now
            if (-not $wasCapped) {
                & node scripts/human-actions.js add --id cap-raise-console --what "Raise the Anthropic API monthly limit in Console (cap re-detected by a wrapper)" --why "Console account access is yours alone" --severity critical 2>$null
            }
        } else {
            $qs.claude_plan.state = 'capped'; $qs.claude_plan.detected = $now
        }
        [IO.File]::WriteAllText($qsPath, (($qs | ConvertTo-Json -Depth 4) + "`n"))
        "quota-state updated: $Kind capped at $now" | Out-File -Append -Encoding utf8 $Log
    } catch { "quota-state write failed: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $Log }
}

# --- P3 quota-state disarm (FIX-01 class, 2026-07-15 /prompting item 6) --------------------------
# The mirror of Set-AlexQuotaCapped. The gate ARMED automatically (limit-detect + auth-check) but
# nothing DISARMED it, so a lifted cap left a stale 'capped' flag until cleared by hand (FIX-01,
# cleared 2 days late). One shared clear path with verify-after-write built in.
#   Kind 'plan' | 'api' | 'both'. Clears only what is actually 'capped' (idempotent no-op otherwise).
# Scope: a clean `claude -p` probe (auth-check / morning-brief) is a PLAN oracle only, so those callers
# pass -Kind plan. The api (Console monthly) cap clears on reset_date expiry (the gate); an EARLY api
# lift still needs a future n8n-side success signal - it has no local clear path (documented gap).
# On an api clear it closes the cap-raise-console human-action, the mirror of Set arming's enqueue.
# Returns $true if it cleared anything.
function Clear-AlexQuotaCapped {
    param(
        [ValidateSet('plan', 'api', 'both')][string]$Kind = 'plan',
        [Parameter(Mandatory)][string]$Log,
        [string]$Reason = 'cleared'
    )
    $cleared = $false
    try {
        $qsPath = Join-Path (Get-Location) "system\quota-state.json"
        $qs = Get-Content $qsPath -Raw | ConvertFrom-Json
        $now = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
        $doPlan = ($Kind -eq 'plan' -or $Kind -eq 'both')
        $doApi  = ($Kind -eq 'api'  -or $Kind -eq 'both')
        if ($doPlan -and $qs.claude_plan.state -eq 'capped') {
            $qs.claude_plan.state = 'ok'; $qs.claude_plan.detected = $null
            $cleared = $true
            "quota-state: claude_plan capped->ok ($Reason) at $now" | Out-File -Append -Encoding utf8 $Log
        }
        if ($doApi -and $qs.anthropic_api.state -eq 'capped') {
            $qs.anthropic_api.state = 'ok'; $qs.anthropic_api.detected = $null; $qs.anthropic_api.reset_date = $null
            $cleared = $true
            "quota-state: anthropic_api capped->ok ($Reason) at $now" | Out-File -Append -Encoding utf8 $Log
            & node scripts/human-actions.js done cap-raise-console 2>$null | Out-Null
            $global:LASTEXITCODE = 0   # the 'done' no-op exits 1 when the item isn't open; don't leak it
        }
        if ($cleared) {
            [IO.File]::WriteAllText($qsPath, (($qs | ConvertTo-Json -Depth 4) + "`n"))
            # Verify-after-write (standing order): read back the mutated field(s), log a mismatch.
            $rb = Get-Content $qsPath -Raw | ConvertFrom-Json
            $bad = (($doPlan -and $rb.claude_plan.state -ne 'ok') -or ($doApi -and $rb.anthropic_api.state -ne 'ok'))
            if ($bad) { "quota-state CLEAR VERIFY FAILED: plan='$($rb.claude_plan.state)' api='$($rb.anthropic_api.state)'" | Out-File -Append -Encoding utf8 $Log }
            else { "quota-state clear verified ($Kind, $Reason)" | Out-File -Append -Encoding utf8 $Log }
        }
    } catch { "quota-state clear failed: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $Log }
    return $cleared
}

# --- P3 quota gate (upgrade 2026-07-12, design 1.7.2 / plan Phase 3 step 1) ---------------------
# Called at the TOP of a wrapper, BEFORE spawning claude -p:
#   if (-not (Test-AlexQuotaGate -Log $log -Project 'crm')) { exit 0 }
# Returns $true  = proceed normally.
# Returns $false = the Claude PLAN is freshly capped and this project is not a budget-priority
#                  winner: the wrapper runs its deterministic core only (if it has one) and exits 0.
#                  An amber "degraded: quota" run_status has already been pushed here (PARTIAL, not
#                  RED - a degraded run is visible, never alarming, never silent).
# Fail-open by design: missing/unreadable state file, missing manifest, or a capped flag older than
# 6 hours (plan limits reset in hours; QC risk R4) all return $true.
# budget_priority comes from system/manifest.json (matched on hq_project, then name); <=1 always runs.
function Test-AlexQuotaGate {
    param(
        [Parameter(Mandatory)][string]$Log,
        [string]$Project = ''
    )
    $stateFile = "system\quota-state.json"
    if (-not (Test-Path $stateFile)) { return $true }
    try { $q = Get-Content $stateFile -Raw | ConvertFrom-Json } catch { return $true }

    # Edit 2 (FIX-01 class, 2026-07-15 /prompting item 6): date-expiry disarm, so a lapsed cap never
    # lingers 'capped'. Deterministic, zero-token, fail-open. The api (Console monthly) cap clears when
    # its recorded reset_date has passed; the plan cap clears on its >6h TTL below. This is the missing
    # DISARM half - before it, the gate ignored a stale flag but never cleared it (the FIX-01 asymmetry).
    try {
        if ($q.anthropic_api.state -eq 'capped' -and $q.anthropic_api.reset_date) {
            $rd = $null; try { $rd = [datetime]$q.anthropic_api.reset_date } catch {}
            if ($rd -and (Get-Date) -ge $rd) { Clear-AlexQuotaCapped -Kind api -Log $Log -Reason 'api reset_date passed' | Out-Null }
        }
    } catch {}

    $plan = $q.claude_plan
    if (-not $plan -or $plan.state -ne 'capped') { return $true }
    $detected = $null
    try { $detected = [datetime]$plan.detected } catch {}
    if (-not $detected -or ((Get-Date) - $detected).TotalHours -gt 6) {
        # A plan cap resets in hours, so a flag older than the 6h TTL is stale: CLEAR it, don't just
        # fail-open (the silent fail-open left the flag 'capped' forever - the FIX-01 asymmetry).
        if ($detected) { Clear-AlexQuotaCapped -Kind plan -Log $Log -Reason 'plan >6h TTL expired' | Out-Null }
        return $true
    }

    $pri = 3
    try {
        $man = Get-Content "system\manifest.json" -Raw | ConvertFrom-Json
        $row = $man.projects | Where-Object { ($Project -ne '') -and ($_.hq_project -eq $Project -or $_.name -eq $Project) } | Select-Object -First 1
        if ($row -and $row.budget_priority) { $pri = [int]$row.budget_priority }
    } catch {}
    if ($pri -le 1) {
        "quota gate: plan capped but budget_priority=$pri, proceeding" | Out-File -Append -Encoding utf8 $Log
        return $true
    }

    "quota gate: claude_plan capped (detected $($plan.detected)), DEGRADED - core-only/skip (priority $pri)" | Out-File -Append -Encoding utf8 $Log
    if ($Project -ne '') {
        $tokenFile = "work\16-alex-hq\config\alex-hq-token.txt"
        if (Test-Path $tokenFile) {
            $token = (Get-Content $tokenFile -Raw).Trim()
            $body = @{ project = $Project; metric_key = 'run_status'; value_num = 0
                       headline = 'degraded: quota (plan limit) - deterministic core only this slot'
                       status = 'amber' } | ConvertTo-Json -Compress
            try {
                Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
                    -Headers @{ 'X-Alex-Token' = $token } -ContentType 'application/json' `
                    -Body $body -TimeoutSec 10 | Out-Null
            } catch { "quota gate: amber push failed: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $Log }
        }
    }
    return $false
}

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
        # P3 quota writer (design 1.7.1): a detected limit updates the shared quota state so the
        # pre-run gate degrades the NEXT wrappers instead of letting each one die the same death.
        Set-AlexQuotaCapped -Kind $(if ($reason -match 'API usage limits') { 'api' } else { 'plan' }) -Log $Log
    } elseif ($Code -ne 0) {
        $reason = "claude exit code $Code"
    }

    # BUG-05 fix (2026-07-15): a run that streams >500 chars of real work, THEN hits the cap and exits 0,
    # escapes the short-gated limit patterns above and would be scored green ("died dark, reported green").
    # Catch it by scanning the TAIL of the output (last 400 chars) for the harness's hard-limit signature:
    # a limit notice in the tail means the run died mid-stream, whereas a limit merely *mentioned* earlier
    # in prose (the 2026-07-06 false-flag class) is not in the tail. Un-gated by total length.
    if ($null -eq $reason) {
        $tail = if ($Out.Length -gt 400) { $Out.Substring($Out.Length - 400) } else { $Out }
        if ($tail -match 'reached your .{0,40}limit|API usage limits|Please run /login') {
            $tl = ($tail -split "`r?`n" | Where-Object { $_ -match 'limit|/login' } | Select-Object -Last 1)
            $reason = if ($tl) { "mid-stream stop: " + $tl.Trim() } else { 'mid-stream usage/session limit (tail-detected, exit 0)' }
            if ($reason.Length -gt 140) { $reason = $reason.Substring(0, 140) }
            Set-AlexQuotaCapped -Kind $(if ($tail -match 'API usage limits') { 'api' } else { 'plan' }) -Log $Log
        }
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
    } elseif ($reason -match 'API usage limits' -and (Test-Path 'system\quota-state.json') -and (((Get-Content 'system\quota-state.json' -Raw | ConvertFrom-Json).anthropic_api.state) -eq 'capped')) {
        # BUG-03 fix (2026-07-15): a week-scale Anthropic API cap is still capped in 90 min, so waking
        # to re-hit it is pure battery/token drain across ~13 wrappers x 4 retries. Skip the retry; the
        # next scheduled slot covers recovery. A transient plan/auth cap is NOT matched here, so it
        # still self-heals as before.
        "retry skipped: known persistent Anthropic API cap (next scheduled slot covers recovery)" | Out-File -Append -Encoding utf8 $Log
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

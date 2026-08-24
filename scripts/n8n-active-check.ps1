# scripts/n8n-active-check.ps1  -  Recovery layer: n8n active-flag watcher.
#
# ZERO LLM tokens. Born from the 2026-07-16 diagnostic audit (BUG-01 / register): a LIVE n8n workflow
# can go active:false and NOTHING notices until a missed run is spotted hours or days later (the proven
# 2026-07-10 silent dual-engine deactivation; and n8n's activate/deactivate does NOT bump `updatedAt`,
# so drift is invisible to a timestamp check - you must read the flag itself).
#
# What it does: reads system/manifest.json, takes every LIVE project that maps to an n8n workflow id,
# GETs each workflow, and asserts active==true. Any expected-active workflow that is OFF -> RED to Alex
# HQ (recovery/n8n_active) + exit 1. A total-API-outage is amber+exit 0 (transient, not config drift),
# never a false RED. Best-effort HQ push (a bad token/network never changes the exit code).
#
# Exit 0 = all expected-active workflows are active (or API unreachable, treated as transient).
# Exit 1 = at least one expected-active workflow is OFF (real drift).
#
# --- LEG 2 added 2026-08-05 (pen-test finding P-02) -------------------------------------------
# The flag leg above answers "is it switched on". It does NOT answer "did it work", and those are
# different invariants. Proven on 2026-08-04/05: #03 and #14 both ERRORED on the live box while this
# watcher, validator V6 and the weekly sweep all read green, because every one of them inspects
# CONFIGURATION. Three greens on the same layer are not independent evidence.
#
# Leg 2 reads /executions and asserts, per governed workflow:
#   (a) the LAST execution did not error   -> a run that failed is a red, immediately; and
#   (b) a SUCCESS happened within the window its declared `n8n_cron` implies (x2 for slack)
#       -> catches the silent case: a trigger that stopped firing at all, which (a) cannot see
#          because there is no failed execution to find.
# Only projects carrying an `n8n_cron` get leg (b); webhook-driven lanes (#16, #17) have no
# expected cadence in the registry, so asserting one would invent a contract that does not exist.
# Their silence is owned by the HQ self-heal `health-source-stalled` probe instead.
#
# Deliberately NOT retried or auto-fixed here: this is the DETECT half, same as the flag leg. The
# remedy for a failed run is a person reading the error, because the causes are not interchangeable
# (2026-08-04 alone produced a Google Sheets 503, a Bright Data "Customer is not active", and an
# unparseable Sheets range - three different remedies, none of them a rerun).
#
# Exit 1 now also means: a governed workflow's last run errored, or it has gone quiet past its cadence.
#
#   n8n-active-check.ps1            run the check (scheduled daily 08:10 as PersonalOS-n8n-active-check)
#   n8n-active-check.ps1 -DryRun    run + log, but do NOT push to Alex HQ (testing)
param([switch]$DryRun)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = if ($PSScriptRoot) { (Resolve-Path (Join-Path $PSScriptRoot '..')).Path } else { (Get-Location).Path }
Set-Location $repo
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\n8n-active-check.log"
function Say($m) { "$m" | Out-File -Append -Encoding utf8 $log }
Say "=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')$(if($DryRun){' (DRYRUN)'}) ==="

$reason = $null
$inactive = @()
$failed = @()        # leg 2a: governed workflows whose LAST execution errored
$stale = @()         # leg 2b: governed workflows with no success inside their declared cadence
$unreachable = @()
$checked = 0
try {
    $manifest = Get-Content (Join-Path $repo "system\manifest.json") -Raw | ConvertFrom-Json
    # expected-active = LIVE-state projects whose `n8n` field is a workflow-id string (15-20 chars).
    $expected = @()
    foreach ($p in @($manifest.projects) + @($manifest.meta.unnumbered)) {
        if ($p.state -eq 'LIVE' -and ($p.n8n -is [string]) -and $p.n8n.Length -ge 15 -and $p.n8n.Length -le 20) {
            $expected += [pscustomobject]@{ label = $(if ($p.num) { "#$($p.num) $($p.name)" } else { $p.name }); id = $p.n8n
                                            cron  = $(if ($p.n8n_cron -is [string]) { $p.n8n_cron } else { $null }) }
        }
    }
    if ($expected.Count -eq 0) { throw "no LIVE project carries an n8n workflow id - manifest schema drift?" }

    $keyFile = "work\03-application-engine\config\n8n-api-key.txt"
    if (-not (Test-Path $keyFile)) { throw "n8n API key file missing ($keyFile)" }
    $key = (Get-Content $keyFile -Raw).Trim()
    $H = @{ "X-N8N-API-KEY" = $key }
    $base = "https://n8n.shaheenkiarash.com/api/v1"

    foreach ($w in $expected) {
        try {
            $wf = Invoke-RestMethod -Uri "$base/workflows/$($w.id)" -Headers $H -Method Get -TimeoutSec 15
            $checked++
            if ($wf.active -ne $true) { $inactive += "$($w.label) [$($w.id)]" ; Say "OFF: $($w.label) [$($w.id)] active=$($wf.active)" }
            else { Say "ok: $($w.label) active=true" }
        } catch {
            $unreachable += "$($w.label) [$($w.id)]"
            Say "unreachable: $($w.label) [$($w.id)] - $($_.Exception.Message)"
        }
    }

    # --- LEG 2: execution health (P-02). Config-green is not run-green. -------------------------
    # One /executions read for the whole set, then per-workflow verdicts. Kept to a single call so a
    # daily zero-token watcher stays cheap; 250 rows covers every governed lane's recent history.
    if ($checked -gt 0) {
        try {
            $ex = Invoke-RestMethod -Uri "$base/executions?limit=250&includeData=false" -Headers $H -Method Get -TimeoutSec 30
            $rows = @($ex.data)
            Say "executions read: $($rows.Count)"
            foreach ($w in $expected) {
                $mine = @($rows | Where-Object { $_.workflowId -eq $w.id } |
                          Sort-Object { [datetime]$_.startedAt } -Descending)
                if ($mine.Count -eq 0) { Say "exec: $($w.label) - no executions in the window (not asserted)"; continue }

                # (a) last run errored -> red now. n8n uses 'error' and 'crashed' for real failures.
                $last = $mine[0]
                if ($last.status -in @('error', 'crashed')) {
                    $failed += "$($w.label) last run $($last.status) $(([string]$last.startedAt).Substring(0,16))"
                    Say "FAILED: $($w.label) last execution id=$($last.id) status=$($last.status) at $($last.startedAt)"
                    continue    # already red; the staleness leg would just restate it
                }

                # (b) gone quiet past its declared cadence. Only for lanes that DECLARE one.
                if (-not $w.cron) { Say "ok: $($w.label) last run $($last.status) (no n8n_cron declared, cadence not asserted)"; continue }
                $succ = @($mine | Where-Object { $_.status -eq 'success' })
                if ($succ.Count -eq 0) { $stale += "$($w.label) no success in window"; Say "STALE: $($w.label) no success in the execution window"; continue }
                $lastOk = [datetime]$succ[0].startedAt
                # Expected gap from the cron's day-of-week field: a 2-days-a-week lane may legitimately
                # be quiet for 5 days. Weekly-ish = 8d, daily = 2d, then doubled for slack. Deliberately
                # coarse: this leg exists to catch "stopped firing entirely", not to police punctuality.
                $dow  = ($w.cron -split '\s+')[4]
                $days = if ($dow -eq '*') { 2 } else { 8 }
                $ageD = [math]::Round(((Get-Date) - $lastOk).TotalDays, 1)
                if ($ageD -gt ($days * 2)) {
                    $stale += "$($w.label) last success ${ageD}d ago (cron '$($w.cron)')"
                    Say "STALE: $($w.label) last success ${ageD}d ago, window $($days*2)d, cron '$($w.cron)'"
                } else {
                    Say "ok: $($w.label) last run success, ${ageD}d ago (window $($days*2)d)"
                }
            }
        } catch {
            # Executions unreadable is NOT drift - same posture as the flag leg's API-outage case.
            Say "executions unreadable this run (leg 2 skipped): $($_.Exception.Message)"
        }
    }

    if ($inactive.Count -gt 0) {
        $reason = "OFF: " + ($inactive -join '; ')
    } elseif ($failed.Count -gt 0) {
        $reason = "FAILED RUN: " + ($failed -join '; ')
    } elseif ($stale.Count -gt 0) {
        $reason = "NO RECENT SUCCESS: " + ($stale -join '; ')
    } elseif ($checked -eq 0) {
        $reason = 'TRANSIENT-API-UNREACHABLE'   # nothing reachable = network/API blip, not config drift
    }
} catch {
    $reason = "WATCHER EXCEPTION: $($_.Exception.Message)"
}

# --- Alex HQ push (best-effort; never log the token; never let the push change the exit code). ---
$tokenFile = "work\16-alex-hq\config\alex-hq-token.txt"
if ((Test-Path $tokenFile) -and -not $DryRun) {
    $token = (Get-Content $tokenFile -Raw).Trim()
    if ($null -eq $reason) {
        # Green now means BOTH legs passed: switched on AND last run healthy. Say so, because the
        # old headline ("all N active") is exactly the reassurance that hid P-02 for two days.
        $head = "all $checked LIVE n8n workflows active + last runs healthy"
        if ($unreachable.Count -gt 0) { $head += " ($($unreachable.Count) unreachable this run)" }
        $body = @{ project='recovery'; metric_key='n8n_active'; value_num=0; headline=$head; status='green' } | ConvertTo-Json -Compress
    } elseif ($reason -eq 'TRANSIENT-API-UNREACHABLE') {
        $body = @{ project='recovery'; metric_key='n8n_active'; value_num=0
                   headline="n8n API unreachable this run (transient, not drift)"; status='amber' } | ConvertTo-Json -Compress
    } else {
        # value_num carries the total count of unhealthy lanes across both legs, not just OFF ones.
        $body = @{ project='recovery'; metric_key='n8n_active'; value_num=($inactive.Count + $failed.Count + $stale.Count)
                   headline="n8n unhealthy: $reason"; status='red' } | ConvertTo-Json -Compress
    }
    try {
        Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
            -Headers @{ 'X-Alex-Token'=$token } -ContentType 'application/json' -Body $body -TimeoutSec 10 | Out-Null
        Say "HQ push sent"
    } catch { Say "HQ push failed: $($_.Exception.Message)" }
}

if ($null -eq $reason -or $reason -eq 'TRANSIENT-API-UNREACHABLE') {
    Say "OK ($checked checked, $($unreachable.Count) unreachable)"
    exit 0
}
Say "DRIFT: $reason"
exit 1

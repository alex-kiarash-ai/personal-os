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
$unreachable = @()
$checked = 0
try {
    $manifest = Get-Content (Join-Path $repo "system\manifest.json") -Raw | ConvertFrom-Json
    # expected-active = LIVE-state projects whose `n8n` field is a workflow-id string (15-20 chars).
    $expected = @()
    foreach ($p in @($manifest.projects) + @($manifest.meta.unnumbered)) {
        if ($p.state -eq 'LIVE' -and ($p.n8n -is [string]) -and $p.n8n.Length -ge 15 -and $p.n8n.Length -le 20) {
            $expected += [pscustomobject]@{ label = $(if ($p.num) { "#$($p.num) $($p.name)" } else { $p.name }); id = $p.n8n }
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

    if ($inactive.Count -gt 0) {
        $reason = "OFF: " + ($inactive -join '; ')
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
        $head = "all $checked LIVE n8n workflows active"
        if ($unreachable.Count -gt 0) { $head += " ($($unreachable.Count) unreachable this run)" }
        $body = @{ project='recovery'; metric_key='n8n_active'; value_num=0; headline=$head; status='green' } | ConvertTo-Json -Compress
    } elseif ($reason -eq 'TRANSIENT-API-UNREACHABLE') {
        $body = @{ project='recovery'; metric_key='n8n_active'; value_num=0
                   headline="n8n API unreachable this run (transient, not drift)"; status='amber' } | ConvertTo-Json -Compress
    } else {
        $body = @{ project='recovery'; metric_key='n8n_active'; value_num=$inactive.Count
                   headline="n8n workflow(s) OFF: $reason"; status='red' } | ConvertTo-Json -Compress
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

# Weekly auth-freshness probe (audit step 2 + self-review proposal 3, live 2026-07-06). Sunday 19:30.
# The largest recorded outage class is headless-claude auth/quota dying silently between runs
# (the 06-26/29/30 sprint blackout). This probe catches login expiry SUNDAY EVENING, before the
# Monday morning job train, instead of it being discovered by a dead week.
# One micro-prompt (~zero cost), pattern-detects the failure classes, pushes infra/auth_ok to Alex HQ.
#
# EXTENDED 2026-07-07 (upgrade-scan item 3): also runs `claude mcp list` (zero tokens - a health
# probe, no LLM call) and pushes infra/mcp_ok, RED if a CRITICAL connector (Notion/Gmail/Google
# Calendar/Google Drive) is unattached - the 2026-06-16 "MCP not attached, run blocked" class,
# now caught Sunday evening before the Monday train. Optional connectors (Windsor/Microsoft 365)
# are intentionally ignored so the flag never cries wolf. This is ADDITIVE: it never changes the
# auth-probe exit code. Recovery command (run interactively when it goes red):
#     claude mcp login <name>              (opens a browser to re-authorize the connector)
#     claude mcp login <name> --no-browser (SSH/headless: prints the auth URL, paste the redirect back)
param(
    [string]$ClaudeCmd = "$env:APPDATA\npm\claude.ps1",
    [switch]$DryRun
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\auth-check.log"
"=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log

$out = ''
try {
    $out = (& $ClaudeCmd --model claude-sonnet-4-6 -p "Reply with exactly: OK" 2>&1 | Out-String)
    $code = $LASTEXITCODE
} catch {
    $out = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $code = 1
}
$out | Out-File -Append -Encoding utf8 $log

$reason = $null
if (($out -replace '\s', '').Length -eq 0)                { $reason = 'blank output (silent fail)' }
elseif ($out -match 'Not logged in|Please run /login')    { $reason = 'not logged in - needs interactive claude /login' }
elseif ($out -match 'session limit|usage limit|API usage limits|reached your .{0,40}limit') { $reason = 'usage/session limit at probe time' }
elseif ($code -ne 0)                                      { $reason = "claude exit code $code" }
elseif ($out -notmatch '\bOK\b')                          { $reason = 'unexpected probe output' }

# BUG-12 fix (2026-07-15): a limit caught Sunday evening must ARM the quota gate for the Monday train,
# not just alert. The probe's whole purpose ("catch it before the Monday train") was half-delivered -
# it turned the HQ tile RED but never primed system/quota-state.json, so Monday's wrappers each
# rediscovered the cap and each fired a retry ladder. Now it primes the shared quota state + verifies.
if ($reason -match 'limit') {
    . "scripts\lib\close-out.ps1"   # defines Set-AlexQuotaCapped/Test-AlexQuotaGate at load, no side effects
    $kind = if ($out -match 'API usage limits') { 'api' } else { 'plan' }
    Set-AlexQuotaCapped -Kind $kind -Log $log
    try {   # Verify-after-write (standing order): read the mutated field back, log a mismatch
        $qs = Get-Content 'system\quota-state.json' -Raw | ConvertFrom-Json
        $armed = if ($kind -eq 'api') { $qs.anthropic_api.state } else { $qs.claude_plan.state }
        if ($armed -ne 'capped') { "quota-state prime VERIFY FAILED: $kind state='$armed'" | Out-File -Append -Encoding utf8 $log }
        else { "quota-state primed + verified: $kind capped" | Out-File -Append -Encoding utf8 $log }
    } catch { "quota-state verify read failed: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $log }
}

# FIX-01 class (2026-07-15 /prompting item 6): the DISARM mirror of the prime above. A clean probe
# just completed a successful `claude -p` call (a PLAN oracle), so a stale plan cap is cleared here,
# verify-after-write inside Clear-AlexQuotaCapped. Before this, auth-check armed the gate on a hit but
# nothing ever cleared it, so a lifted cap stayed 'capped' until cleared by hand (FIX-01, 2 days late).
if ($null -eq $reason) {
    . "scripts\lib\close-out.ps1"
    Clear-AlexQuotaCapped -Kind plan -Log $log -Reason 'clean auth probe' | Out-Null
}

# Push infra/auth_ok to Alex HQ (green fresh / red stale). Never log the token; push failure never crashes the probe.
$tokenFile = "work\16-alex-hq\config\alex-hq-token.txt"
if (Test-Path $tokenFile) {
    $token = (Get-Content $tokenFile -Raw).Trim()
    if ($null -eq $reason) {
        $body = @{ project='infra'; metric_key='auth_ok'; value_num=1; headline='headless claude auth fresh'; status='green' } | ConvertTo-Json -Compress
    } else {
        $body = @{ project='infra'; metric_key='auth_ok'; value_num=0; headline="headless claude auth STALE: $reason"; status='red' } | ConvertTo-Json -Compress
    }
    if ($DryRun) {
        "DRYRUN, would push: $body" | Out-File -Append -Encoding utf8 $log
    } else {
        try {
            Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
                -Headers @{ 'X-Alex-Token'=$token } -ContentType 'application/json' -Body $body -TimeoutSec 10 | Out-Null
            "HQ push sent" | Out-File -Append -Encoding utf8 $log
        } catch { "HQ push failed: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $log }
    }
} else { "HQ push skipped: token file missing" | Out-File -Append -Encoding utf8 $log }

# ============================================================================
# MCP connectivity probe (upgrade-scan item 3, 2026-07-07). Runs AFTER the auth push and is
# strictly additive: best-effort, wrapped, and it NEVER changes the auth-based exit code below.
# Flags only CRITICAL connectors so the perpetually-unauthenticated optional ones don't cry red.
# ============================================================================
$criticalMcp = @('Notion', 'Gmail', 'Google Calendar', 'Google Drive')
$mcpReason = $null; $unattachedCrit = @(); $unattachedAll = @()
try {
    $mcpOut = (& $ClaudeCmd mcp list 2>&1 | Out-String)
    "--- mcp list ---" | Out-File -Append -Encoding utf8 $log
    $mcpOut.TrimEnd() | Out-File -Append -Encoding utf8 $log
    foreach ($line in ($mcpOut -split "`r?`n")) {
        if ($line -notmatch ':' -or $line -notmatch ' - ') { continue }
        $status = ($line -split ' - ')[-1].Trim()
        $name   = ($line.Substring(0, $line.IndexOf(':'))).Trim()
        if (-not $name) { continue }
        # Healthy = "Connected" with no failure/warning marker. Catches "! Connected - tools fetch
        # failed" (degraded) and "! Needs authentication" / "Failed to connect" (down) alike.
        $ok = ($status -match 'Connected') -and ($status -notmatch 'Disconnected|fail|Needs|error|unauthor')
        if ($ok) { continue }
        $unattachedAll += $name
        foreach ($c in $criticalMcp) { if ($name -match [regex]::Escape($c)) { $unattachedCrit += $name; break } }
    }
    if ($mcpOut -notmatch ':') { $mcpReason = 'mcp list produced no parseable output' }
} catch { $mcpReason = "mcp list failed: $($_.Exception.Message)" }

if (Test-Path $tokenFile) {
    $token = (Get-Content $tokenFile -Raw).Trim()
    if (($null -eq $mcpReason) -and ($unattachedCrit.Count -eq 0)) {
        $extra = if ($unattachedAll.Count) { " (optional off: $($unattachedAll -join ', '))" } else { '' }
        $mbody = @{ project='infra'; metric_key='mcp_ok'; value_num=1; headline="critical MCP connectors attached$extra"; status='green' } | ConvertTo-Json -Compress
    } else {
        $head = if ($mcpReason) { "MCP probe: $mcpReason" } else { "critical MCP UNATTACHED: $($unattachedCrit -join ', ') -> claude mcp login <name>" }
        $mbody = @{ project='infra'; metric_key='mcp_ok'; value_num=0; headline=$head; status='red' } | ConvertTo-Json -Compress
    }
    if ($DryRun) {
        "DRYRUN, would push mcp: $mbody" | Out-File -Append -Encoding utf8 $log
    } else {
        try {
            Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
                -Headers @{ 'X-Alex-Token'=$token } -ContentType 'application/json' -Body $mbody -TimeoutSec 10 | Out-Null
            "MCP HQ push sent (critical unattached: $($unattachedCrit.Count))" | Out-File -Append -Encoding utf8 $log
        } catch { "MCP HQ push failed: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $log }
    }
} else { "MCP push skipped: token file missing" | Out-File -Append -Encoding utf8 $log }

if ($null -eq $reason) { "OK" | Out-File -Append -Encoding utf8 $log; exit 0 }
"FAILED: $reason" | Out-File -Append -Encoding utf8 $log; exit 1

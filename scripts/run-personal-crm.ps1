# Personal CRM scheduled wrapper (rebuilt 2026-07-12, upgrade P3: deterministic-core-first, the
# sprint-tracker pattern). Close-Out Gate mechanism: scripts/lib/close-out.ps1.
#
# ORDER MATTERS. The zero-token core runs FIRST and is the must-succeed part: it computes the
# Monday follow-up list from vault/people frontmatter alone (channel-aware, spec-default cadences,
# state/cadence.json overrides) and pushes crm/run_status GREEN. Three straight quota-dead Mondays
# (06-26 class) can no longer take the list down.
# The Claude pass runs SECOND, behind the quota gate: scoring, Msgs 90d, Notion sync, gated drafts.
# If it is capped, the run is DEGRADED (list stands, HQ green), logged PARTIAL, exit 0.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\personal-crm.log"
"=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log

# ---- 1. Deterministic core (must succeed; writes the list + greens HQ) ----
$coreOut = ''
try {
    $coreOut = (& node scripts\personal-crm-core.js 2>&1 | Out-String)
    $coreCode = $LASTEXITCODE
} catch {
    $coreOut = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $coreCode = 1
}
"--- core ---`n$coreOut" | Out-File -Append -Encoding utf8 $log
if ($coreCode -ne 0) {
    # Core failure = real failure: RED push + retry ladder + exit 1.
    Invoke-CloseOutCheck -Out $coreOut -Code $coreCode -Log $log -Project 'crm'
}

# ---- P3 quota gate: plan freshly capped -> skip the Claude pass, list already stands ----
if (-not (Test-AlexQuotaGate -Log $log -Project 'crm')) {
    "PARTIAL: Claude pass skipped by the quota gate (plan capped). Core list written + HQ green." | Out-File -Append -Encoding utf8 $log
    exit 0
}

# ---- 2. Claude pass (scoring, enrich, Notion sync, gated drafts; non-fatal shape kept) ----
$out = ''
try {
    # Model: Sonnet-4-6 (cost cut, Shaheen 2026-07-16).
    $out = (& "$env:APPDATA\npm\claude.ps1" --model claude-sonnet-4-6 -p "Run /personal-crm" --dangerously-skip-permissions 2>&1 | Out-String)
    $code = $LASTEXITCODE
} catch {
    $out = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $code = 1
}
$out | Out-File -Append -Encoding utf8 $log

Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project 'crm'

# Success falls through: push GREEN so a stale red self-heals (P3 rider; the "full run clean" signal
# on top of the core's earlier "numbers landed" green).
try {
    $token = (Get-Content "work\16-alex-hq\config\alex-hq-token.txt" -Raw).Trim()
    $body = @{ project = 'crm'; metric_key = 'run_status'; value_num = 1
               headline = "full run clean $(Get-Date -Format 'yyyy-MM-dd')"; status = 'green' } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
        -Headers @{ 'X-Alex-Token' = $token } -ContentType 'application/json' -Body $body -TimeoutSec 10 | Out-Null
    "HQ green push sent (full run)" | Out-File -Append -Encoding utf8 $log
} catch { "HQ green push failed: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $log }

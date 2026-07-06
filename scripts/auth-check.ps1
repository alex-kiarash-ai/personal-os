# Weekly auth-freshness probe (audit step 2 + self-review proposal 3, live 2026-07-06). Sunday 19:30.
# The largest recorded outage class is headless-claude auth/quota dying silently between runs
# (the 06-26/29/30 sprint blackout). This probe catches login expiry SUNDAY EVENING, before the
# Monday morning job train, instead of it being discovered by a dead week.
# One micro-prompt (~zero cost), pattern-detects the failure classes, pushes infra/auth_ok to Alex HQ.
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
    $out = (& $ClaudeCmd -p "Reply with exactly: OK" 2>&1 | Out-String)
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

if ($null -eq $reason) { "OK" | Out-File -Append -Encoding utf8 $log; exit 0 }
"FAILED: $reason" | Out-File -Append -Encoding utf8 $log; exit 1

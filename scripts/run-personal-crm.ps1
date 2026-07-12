# Personal CRM scheduled wrapper (Close-Out Gate hardened 2026-07-03; shared mechanism scripts/lib/close-out.ps1)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\personal-crm.log"
"=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log
# P3 quota gate (upgrade 2026-07-12): plan freshly capped + not a budget-priority winner -> skip this slot as visible-PARTIAL
if (-not (Test-AlexQuotaGate -Log $log -Project 'crm')) { exit 0 }

$out = ''
try {
    $out = (& "$env:APPDATA\npm\claude.ps1" -p "Run /personal-crm" --dangerously-skip-permissions 2>&1 | Out-String)
    $code = $LASTEXITCODE
} catch {
    $out = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $code = 1
}
$out | Out-File -Append -Encoding utf8 $log

Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project 'crm'

# P3 rider (upgrade 2026-07-12, design #05 row): success falls through the check above - push GREEN
# explicitly so a stale red from a dead Monday self-heals on the next clean run instead of lingering.
try {
    $token = (Get-Content "work\16-alex-hq\config\alex-hq-token.txt" -Raw).Trim()
    $body = @{ project = 'crm'; metric_key = 'run_status'; value_num = 1
               headline = "run clean $(Get-Date -Format 'yyyy-MM-dd')"; status = 'green' } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
        -Headers @{ 'X-Alex-Token' = $token } -ContentType 'application/json' -Body $body -TimeoutSec 10 | Out-Null
    "HQ green push sent (crm self-heal)" | Out-File -Append -Encoding utf8 $log
} catch { "HQ green push failed: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $log }

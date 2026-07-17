# Weekly Exec Report scheduled wrapper (Close-Out Gate hardened 2026-07-03; shared mechanism scripts/lib/close-out.ps1)
# No confirmed run_status tile yet (Project ''); failure is still detected, logged FAILED, and exits 1.
# Follow-up: add a 'weekly' run_status tile to Alex HQ, then set -Project 'weekly' here.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\weekly-exec-report.log"
"=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log
# P3 quota gate (upgrade 2026-07-12): plan freshly capped + not a budget-priority winner -> skip this slot as visible-PARTIAL
if (-not (Test-AlexQuotaGate -Log $log -Project '')) { exit 0 }

$out = ''
try {
    # Model: Sonnet-4-6 (cost cut, Shaheen 2026-07-16).
    $out = (& "$env:APPDATA\npm\claude.ps1" --model claude-sonnet-4-6 -p "Run /weekly-exec-report" --dangerously-skip-permissions 2>&1 | Out-String)
    $code = $LASTEXITCODE
} catch {
    $out = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $code = 1
}
$out | Out-File -Append -Encoding utf8 $log

Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project ''

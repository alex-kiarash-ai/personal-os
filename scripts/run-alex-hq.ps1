# Alex HQ scheduled wrapper (Close-Out Gate hardened 2026-07-03; shared mechanism scripts/lib/close-out.ps1)
# This IS the dashboard producer; a failed run usually means HQ is unreachable, so an HQ push would fail
# anyway (Project ''). Failure is still detected, logged FAILED, and exits 1 for visibility.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\alex-hq.log"
"=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log
# P3 quota gate (upgrade 2026-07-12): plan freshly capped + not a budget-priority winner -> skip this slot as visible-PARTIAL
if (-not (Test-AlexQuotaGate -Log $log -Project 'alex-hq')) { exit 0 }

# No connector preflight needed: /alex-hq uses local files, ssh and curl only.
$out = ''
try {
    # Model: Haiku (cost cut, Shaheen 2026-07-16). HQ just formats local metrics into tiles, no reasoning.
    $out = (& "$env:APPDATA\npm\claude.ps1" --model claude-haiku-4-5-20251001 -p "Run /alex-hq" --dangerously-skip-permissions 2>&1 | Out-String)
    $code = $LASTEXITCODE
} catch {
    $out = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $code = 1
}
$out | Out-File -Append -Encoding utf8 $log

Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project ''

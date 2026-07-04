# Sprint Tracker scheduled wrapper (Close-Out Gate; folded onto shared mechanism scripts/lib/close-out.ps1 on 2026-07-03).
# Keeps -ClaudeCmd (swap the claude binary for stub-testing) and -DryRun (log the would-be HQ push instead of
# sending). The failure detection + RED sprint/run_status push + exit 1 now live in the shared lib, so there is
# ONE implementation across every wrapper. Success exits 0; the GREEN push happens inside the /sprint-tracker post-run.
param(
    [string]$ClaudeCmd = "$env:APPDATA\npm\claude.ps1",
    [switch]$DryRun
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\sprint-tracker.log"
"=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log

$out = ''
try {
    $out = (& $ClaudeCmd -p "Run /sprint-tracker" --dangerously-skip-permissions 2>&1 | Out-String)
    $code = $LASTEXITCODE
} catch {
    $out = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $code = 1
}
$out | Out-File -Append -Encoding utf8 $log

Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project 'sprint' -DryRun:$DryRun

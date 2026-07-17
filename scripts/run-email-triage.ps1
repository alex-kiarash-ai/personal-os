# Email Triage scheduled wrapper (Close-Out Gate hardened 2026-07-03; shared mechanism scripts/lib/close-out.ps1)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\email-triage.log"
"=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log
# P3 quota gate (upgrade 2026-07-12): plan freshly capped + not a budget-priority winner -> skip this slot as visible-PARTIAL
if (-not (Test-AlexQuotaGate -Log $log -Project 'email-triage')) { exit 0 }

# Preflight: claude.ai connectors load non-blocking, so a cold `claude -p` acts before
# Gmail finishes connecting. `mcp list` forces a synchronous connect + warms the token cache.
$env:MCP_TIMEOUT = "30000"
$ready = $false
for ($i = 1; $i -le 5; $i++) {
  $list = & "$env:APPDATA\npm\claude.ps1" mcp list 2>&1 | Out-String
  if ($list -match 'Gmail.*Connected') { $ready = $true; break }
  "preflight $i/5: Gmail not attached yet, waiting 8s..." | Out-File -Append -Encoding utf8 $log
  Start-Sleep -Seconds 8
}
if (-not $ready) { "WARNING: Gmail connector never attached; run may be blind." | Out-File -Append -Encoding utf8 $log }

$out = ''
try {
    # Model: Sonnet-4-6 (cost cut, Shaheen 2026-07-16).
    $out = (& "$env:APPDATA\npm\claude.ps1" --model claude-sonnet-4-6 -p "Run /email-triage scheduled" --dangerously-skip-permissions 2>&1 | Out-String)
    $code = $LASTEXITCODE
} catch {
    $out = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $code = 1
}
$out | Out-File -Append -Encoding utf8 $log

Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project 'email-triage'

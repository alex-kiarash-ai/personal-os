# Morning Brief scheduled wrapper (Close-Out Gate hardened 2026-07-03; shared mechanism scripts/lib/close-out.ps1)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"
. "scripts\lib\soul-canary.ps1"
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\morning-brief.log"
"=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log

# Preflight: claude.ai connectors load non-blocking, so a cold `claude -p` acts before
# Gmail/Calendar finish connecting. `mcp list` forces a synchronous connect + warms the token cache.
$env:MCP_TIMEOUT = "30000"
$ready = $false
for ($i = 1; $i -le 5; $i++) {
  $list = & "$env:APPDATA\npm\claude.ps1" mcp list 2>&1 | Out-String
  if (($list -match 'Gmail.*Connected') -and ($list -match 'Calendar.*Connected')) { $ready = $true; break }
  "preflight $i/5: Gmail/Calendar not attached yet, waiting 8s..." | Out-File -Append -Encoding utf8 $log
  Start-Sleep -Seconds 8
}
if (-not $ready) { "WARNING: Gmail/Calendar connectors never attached; run may be blind." | Out-File -Append -Encoding utf8 $log }

# Arm the headless soul-injection gate: a per-run nonce the model must echo with the soul token.
$nonce = New-SoulNonce
$out = ''
try {
    $prompt = "Run /morning-brief" + (Get-SoulCanaryInstruction -Nonce $nonce)
    $out = (& "$env:APPDATA\npm\claude.ps1" -p $prompt --dangerously-skip-permissions 2>&1 | Out-String)
    $code = $LASTEXITCODE
} catch {
    $out = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $code = 1
}
$out | Out-File -Append -Encoding utf8 $log

# Gate: did soul.md actually reach the model this run? Flag + RED on a miss (keep the brief).
Assert-SoulCanary -Out $out -Nonce $nonce -Log $log -Project 'morning-brief' -SoftFail
Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project 'morning-brief'

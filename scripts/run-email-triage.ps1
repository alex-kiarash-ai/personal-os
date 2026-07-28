# Email Triage scheduled wrapper (Close-Out Gate hardened 2026-07-03; shared mechanism scripts/lib/close-out.ps1)
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"
. "scripts\lib\soul-canary.ps1"
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

# Arm the headless soul-injection gate (2026-07-25, stress-test fix F-04). This lane writes REPLY
# DRAFTS in Shaheen's name, so a run where soul.md never reached the model ships off-voice prose - the
# exact silent class found 2026-07-07 (writers running on generic instructions for weeks). The gate was
# armed on morning-brief in 2026-07-09 and the identity doc has promised "email/crm next" ever since;
# this is that promise landing. A per-run nonce also defeats a replayed/cached transcript.
$nonce = New-SoulNonce
$out = ''
try {
    # Model: Sonnet-4-6 (cost cut, Shaheen 2026-07-16).
    $prompt = "Run /email-triage scheduled." + (Get-SoulCanaryInstruction -Nonce $nonce) + " $AlexVerdictInstruction"
    $out = (& "$env:APPDATA\npm\claude.ps1" --model claude-sonnet-4-6 -p $prompt --dangerously-skip-permissions 2>&1 | Out-String)
    $code = $LASTEXITCODE
} catch {
    $out = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $code = 1
}
$out | Out-File -Append -Encoding utf8 $log

# A canary miss on a voice-shipping lane is a DEGRADED run, so it is routed through the ONE existing
# degraded-run path (-Reason -> precise RED headline + the self-scheduled retry ladder + exit 1) rather
# than a parallel exit, which would have skipped both. -Project is deliberately omitted on the assert so
# exactly one HQ push happens, carrying the precise reason.
# GUARD: only when the gate is genuinely ARMED (a soul.md with no SOUL-CANARY-TOKEN reads as "not
# armed", which must stay inert - never a daily false red).
$soulReason = ''
if ((Get-SoulToken) -and -not (Assert-SoulCanary -Out $out -Nonce $nonce -Log $log -SoftFail)) {
    $soulReason = 'soul canary failed: soul.md did not reach the model this run (voice-shipping lane, drafts are written in his name)'
}
Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project 'email-triage' -DegradedReason $soulReason

# disarm.ps1 - Cancel a pending auto-run: remove the poller task and mark the box consumed.
$ErrorActionPreference = 'SilentlyContinue'
$projRoot = Split-Path -Parent $PSScriptRoot
$cfg      = Join-Path $projRoot 'config'
$token    = (Get-Content (Join-Path $cfg 'qra-token.txt') -Raw).Trim()
$base     = 'https://n8n.shaheenkiarash.com'
$headers  = @{ 'X-QRA-Token' = $token }

Unregister-ScheduledTask -TaskName 'PersonalOS-qra-poller' -Confirm:$false
Remove-Item (Join-Path $cfg 'run.lock') -Force
try {
  $body = @{ status = 'DISARMED'; output = ''; run_id = 'manual-disarm' } | ConvertTo-Json
  Invoke-RestMethod -Uri "$base/webhook/qra-result" -Headers $headers -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 20 | Out-Null
} catch {}
Write-Host "Disarmed: poller task removed, box marked consumed (gate will read go=false)."

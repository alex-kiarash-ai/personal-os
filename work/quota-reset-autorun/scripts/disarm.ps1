# disarm.ps1 - Cancel a pending auto-run: remove the poller task and mark the box consumed.
# HTTP via curl.exe (not .NET) - see vault/projects/error-log.md 2026-07-14.
$ErrorActionPreference = 'SilentlyContinue'
$projRoot = Split-Path -Parent $PSScriptRoot
$cfg      = Join-Path $projRoot 'config'
$token    = (Get-Content (Join-Path $cfg 'qra-token.txt') -Raw).Trim()
$base     = 'https://n8n.shaheenkiarash.com'

if (Get-ScheduledTask -TaskName 'PersonalOS-qra-poller' -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName 'PersonalOS-qra-poller' -Confirm:$false
}
Remove-Item (Join-Path $cfg 'run.lock') -Force

$tmp = [System.IO.Path]::GetTempFileName()
$body = @{ status = 'DISARMED'; output = ''; run_id = 'manual-disarm' } | ConvertTo-Json
[System.IO.File]::WriteAllText($tmp, $body, (New-Object System.Text.UTF8Encoding($false)))
& curl.exe -s -m 20 -H "X-QRA-Token: $token" -H "Content-Type: application/json" -X POST --data-binary "@$tmp" "$base/webhook/qra-result" | Out-Null
Remove-Item $tmp -Force -ErrorAction SilentlyContinue
Write-Host "Disarmed: poller task removed, box marked consumed (gate will read go=false)."

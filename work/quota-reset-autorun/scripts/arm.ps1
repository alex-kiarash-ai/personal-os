# arm.ps1 - Arm the one-shot quota-reset auto-run.
# Usage: .\arm.ps1 -ResetTime "15:00"          (fires at reset + 5 min today; next day if 15:00 already passed)
#        .\arm.ps1 -ResetTime "2026-07-13 15:00" -OffsetMinutes 5
# Steps: read your pasted prompt -> arm the box (fire_at = reset + offset) -> verify-after-write
#        -> register the every-minute poller task (self-removes after it fires once).
param(
  [Parameter(Mandatory=$true)][string]$ResetTime,
  [int]$OffsetMinutes = 5
)
$ErrorActionPreference = 'Stop'

$projRoot = Split-Path -Parent $PSScriptRoot
$cfg      = Join-Path $projRoot 'config'
$token    = (Get-Content (Join-Path $cfg 'qra-token.txt') -Raw).Trim()
$base     = 'https://n8n.shaheenkiarash.com'
$headers  = @{ 'X-QRA-Token' = $token }

# 1. The prompt to run - pasted into payload-prompt.txt.
$payloadFile = Join-Path $projRoot 'payload-prompt.txt'
$prompt = (Get-Content $payloadFile -Raw)
if ([string]::IsNullOrWhiteSpace($prompt) -or $prompt -match 'PASTE YOUR PROMPT HERE') {
  throw "payload-prompt.txt is empty or still the placeholder. Paste your real prompt into it first: $payloadFile"
}

# 2. fire_at = reset + offset (UTC ISO for the box).
$reset = [datetime]::Parse($ResetTime)
if ($reset -lt (Get-Date)) { $reset = $reset.AddDays(1) }   # bare HH:mm already past -> assume next day
$fire  = $reset.AddMinutes($OffsetMinutes)
$fireIso = $fire.ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

# 3. Arm the box.
$armBody = @{ fire_at = $fireIso; prompt = $prompt } | ConvertTo-Json -Depth 6
$armResp = Invoke-RestMethod -Uri "$base/webhook/qra-arm" -Headers $headers -Method POST -ContentType 'application/json' -Body $armBody -TimeoutSec 20
if (-not $armResp.ok) { throw "arm failed: $($armResp | ConvertTo-Json -Depth 6)" }
Write-Host "Armed. reset=$reset  fire_at(local)=$fire  fire_at(UTC)=$fireIso  run_id=$($armResp.run_id)"

# 4. Verify-after-write: read the gate back from the box.
Start-Sleep -Seconds 1
$gate = Invoke-RestMethod -Uri "$base/webhook/qra-gate" -Headers $headers -Method GET -TimeoutSec 20
Write-Host "Gate reads back: go=$($gate.go) fire_at=$($gate.fire_at) consumed=$($gate.consumed)  (go should be false until fire_at)"

# 5. Register the every-minute one-shot poller task.
$pollScript = Join-Path $PSScriptRoot 'poll-and-run.ps1'
$action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$pollScript`""
$trigger  = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(1)) -RepetitionInterval (New-TimeSpan -Minutes 1) -RepetitionDuration (New-TimeSpan -Days 1)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'PersonalOS-qra-poller' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Poller registered (PersonalOS-qra-poller, every 1 min, self-removes after firing). Keep the ThinkPad awake through $fire."

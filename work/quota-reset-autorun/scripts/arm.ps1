# arm.ps1 - Arm the one-shot quota-reset auto-run.
# Usage: .\arm.ps1 -ResetTime "15:00"                 (fires at reset + 5 min; next day if already passed)
#        .\arm.ps1 -ResetTime "2026-07-14 15:00" -OffsetMinutes 5
# HTTP goes through curl.exe (ships with Windows 11), NOT .NET Invoke-RestMethod, which fails on this
# machine with "The underlying connection was closed: An unexpected error occurred on a send." curl
# manages its own TLS and works. See vault/projects/error-log.md 2026-07-14.
param(
  [Parameter(Mandatory=$true)][string]$ResetTime,
  [int]$OffsetMinutes = 5
)
$ErrorActionPreference = 'Stop'

$projRoot = Split-Path -Parent $PSScriptRoot
$cfg      = Join-Path $projRoot 'config'
$token    = (Get-Content (Join-Path $cfg 'qra-token.txt') -Raw).Trim()
$base     = 'https://n8n.shaheenkiarash.com'

function Invoke-QraCurl {
  param([string]$Url, [string]$Method = 'GET', [string]$BodyJson = $null)
  $curlArgs = @('-s', '-m', '30', '-H', "X-QRA-Token: $token")
  $tmp = $null
  if ($Method -eq 'POST') {
    $curlArgs += @('-H', 'Content-Type: application/json', '-X', 'POST')
    $tmp = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tmp, [string]$BodyJson, (New-Object System.Text.UTF8Encoding($false)))
    $curlArgs += @('--data-binary', "@$tmp")
  }
  $curlArgs += $Url
  try {
    for ($attempt = 1; ; $attempt++) {
      $out = & curl.exe @curlArgs
      if ($LASTEXITCODE -eq 0 -and $out) {
        try { return ($out | ConvertFrom-Json) } catch { throw "unexpected response: $out" }
      }
      if ($attempt -ge 3) { throw "curl failed (exit $LASTEXITCODE): $out" }
      Write-Host "  (network retry $attempt ...)"
      Start-Sleep -Seconds 3
    }
  } finally {
    if ($tmp) { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
  }
}

# 1. The prompt to run - pasted into payload-prompt.txt.
# Read with .NET so $prompt is a PLAIN string. Get-Content -Raw decorates the string with hidden
# PSPath/PSDrive NoteProperties that ConvertTo-Json explodes into a ~90MB object graph, which n8n
# rejects with "There was a problem executing the workflow".
$payloadFile = Join-Path $projRoot 'payload-prompt.txt'
$prompt = [System.IO.File]::ReadAllText($payloadFile)
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
# Retry the arm POST if n8n returns a transient "problem executing the workflow" (ok missing).
$armResp = $null
for ($i = 1; $i -le 4; $i++) {
  $armResp = Invoke-QraCurl -Url "$base/webhook/qra-arm" -Method POST -BodyJson $armBody
  if ($armResp.ok) { break }
  Write-Host "  (arm attempt $i hit a transient workflow error, retrying in 3s...)"
  Start-Sleep -Seconds 3
}
if (-not $armResp.ok) { throw "arm failed after 4 tries: $($armResp | ConvertTo-Json -Depth 6)" }
Write-Host "Armed. reset=$reset  fire_at(local)=$fire  fire_at(UTC)=$fireIso  run_id=$($armResp.run_id)"

# 4. Verify-after-write: read the gate back from the box.
Start-Sleep -Seconds 1
$gate = Invoke-QraCurl -Url "$base/webhook/qra-gate" -Method GET
Write-Host "Gate reads back: go=$($gate.go) fire_at=$($gate.fire_at) consumed=$($gate.consumed)  (go should be false until fire_at)"

# 5. Register a SINGLE-FIRE task at fire time. No every-minute polling, so no repeated PowerShell
#    windows. Fires ~60s past fire_at (clock-skew cushion so the gate reads go=true). StartWhenAvailable
#    means a laptop asleep at fire time runs on wake (up to 12h later); then the task self-expires and
#    auto-deletes. On a successful run poll-and-run.ps1 also unregisters itself immediately.
$pollScript = Join-Path $PSScriptRoot 'poll-and-run.ps1'
$fireTask = $fire.AddSeconds(60)
$action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$pollScript`""
$trigger  = New-ScheduledTaskTrigger -Once -At $fireTask
$trigger.EndBoundary = $fire.AddHours(12).ToString('s')
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -DeleteExpiredTaskAfter (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'PersonalOS-qra-poller' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Write-Host "Poller registered: fires ONCE at ~$fireTask (no every-minute polling). Keep the ThinkPad awake through then."

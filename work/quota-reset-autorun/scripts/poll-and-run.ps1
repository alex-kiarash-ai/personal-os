# poll-and-run.ps1 - ONE tick of the Quota-Reset Auto-Run poller.
# Registered by arm.ps1 to run every 1 min. On the box's GO signal it runs the armed prompt via
# `claude -p` in full auto, posts the result back (marks consumed), saves a deterministic copy, then
# unregisters itself so it fires exactly once. Pull design: the laptop asks Hetzner "go yet?".
# HTTP via curl.exe (not .NET Invoke-RestMethod, which fails on this machine - see error-log 2026-07-14).
$ErrorActionPreference = 'Stop'

$projRoot = Split-Path -Parent $PSScriptRoot                       # ...\work\quota-reset-autorun
$repoRoot = Split-Path -Parent (Split-Path -Parent $projRoot)      # ...\personal-os
$cfg      = Join-Path $projRoot 'config'
$token    = (Get-Content (Join-Path $cfg 'qra-token.txt') -Raw).Trim()
$base     = 'https://n8n.shaheenkiarash.com'
$lock     = Join-Path $cfg 'run.lock'

# Guard against a second tick launching while a multi-minute run is in flight.
if (Test-Path $lock) { exit 0 }

# Ask the box: is it time?  (curl; on any network hiccup, just wait for the next tick)
$gateRaw = & curl.exe -s -m 20 -H "X-QRA-Token: $token" "$base/webhook/qra-gate"
if ($LASTEXITCODE -ne 0 -or -not $gateRaw) { exit 0 }
try { $gate = $gateRaw | ConvertFrom-Json } catch { exit 0 }
if (-not $gate.go) { exit 0 }

# GO. Claim the lock, then run the armed prompt in full auto.
New-Item -ItemType File -Path $lock -Force | Out-Null
$prompt = [string]$gate.prompt
$runId  = [string]$gate.run_id
$date   = Get-Date -Format 'yyyy-MM-dd'
$outDir = Join-Path $repoRoot "outputs\prompting-scheduled\$date"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outFile = Join-Path $outDir "$runId.txt"

# Delivery coda: the single run also emails the result (Gmail draft if hard-send is unavailable).
$delivery = "`n`n---`nWhen the task above is complete, deliver the full result to Shaheen by email: create a Gmail draft addressed to shaheen.kiarash@gmail.com with a clear subject and the result as the body (send directly if a send tool exists, otherwise a draft is fine)."
$fullPrompt = $prompt + $delivery

$claude = Join-Path $env:APPDATA 'npm\claude.ps1'
$status = 'GREEN'; $err = ''; $runOut = ''
try {
  # stdin, not a positional arg, so a long prompt never hits the Windows arg-length ceiling
  $runOut = ($fullPrompt | & $claude -p --dangerously-skip-permissions 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { $status = 'RED'; $err = "claude exit $LASTEXITCODE" }
} catch {
  $status = 'RED'; $err = $_.Exception.Message; $runOut = $err
}

Set-Content -Path $outFile -Value $runOut -Encoding utf8

# Post the result back - flips consumed=true on the box (belt to the local one-shot). curl + temp file.
try {
  $tmp = [System.IO.Path]::GetTempFileName()
  $body = @{ status = $status; output = $runOut; run_id = $runId; error = $err } | ConvertTo-Json -Depth 4
  [System.IO.File]::WriteAllText($tmp, $body, (New-Object System.Text.UTF8Encoding($false)))
  & curl.exe -s -m 30 -H "X-QRA-Token: $token" -H "Content-Type: application/json" -X POST --data-binary "@$tmp" "$base/webhook/qra-result" | Out-Null
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
} catch {}

# One-shot: remove the task so it never runs again, then drop the lock.
if (Get-ScheduledTask -TaskName 'PersonalOS-qra-poller' -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName 'PersonalOS-qra-poller' -Confirm:$false -ErrorAction SilentlyContinue
}
Remove-Item $lock -Force -ErrorAction SilentlyContinue
exit 0

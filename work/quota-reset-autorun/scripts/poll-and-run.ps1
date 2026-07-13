# poll-and-run.ps1 - ONE tick of the Quota-Reset Auto-Run poller.
# Registered by arm.ps1 to run every 1 min. On the box's GO signal it runs the armed
# prompt via `claude -p` in full auto, posts the result back (marks consumed), saves a
# deterministic copy, then unregisters itself so it fires exactly once.
# Pull design: the laptop asks Hetzner "go yet?"; Hetzner owns the schedule + go/consumed.
$ErrorActionPreference = 'Stop'

$projRoot = Split-Path -Parent $PSScriptRoot                       # ...\work\quota-reset-autorun
$repoRoot = Split-Path -Parent (Split-Path -Parent $projRoot)      # ...\personal-os
$cfg      = Join-Path $projRoot 'config'
$token    = (Get-Content (Join-Path $cfg 'qra-token.txt') -Raw).Trim()
$base     = 'https://n8n.shaheenkiarash.com'
$headers  = @{ 'X-QRA-Token' = $token }
$lock     = Join-Path $cfg 'run.lock'

# Guard against a second tick launching while a multi-minute run is in flight.
if (Test-Path $lock) { exit 0 }

# Ask the box: is it time?
try {
  $gate = Invoke-RestMethod -Uri "$base/webhook/qra-gate" -Headers $headers -Method GET -TimeoutSec 20
} catch {
  exit 0   # transient network blip - just wait for the next tick
}
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
$status = 'GREEN'; $err = ''
try {
  # stdin, not a positional arg, so a long prompt never hits the Windows arg-length ceiling
  $out = ($fullPrompt | & $claude -p --dangerously-skip-permissions 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) { $status = 'RED'; $err = "claude exit $LASTEXITCODE" }
} catch {
  $status = 'RED'; $err = $_.Exception.Message; $out = $err
}

Set-Content -Path $outFile -Value $out -Encoding utf8

# Post the result back - this flips consumed=true on the box (belt to the local one-shot).
try {
  $body = @{ status = $status; output = $out; run_id = $runId; error = $err } | ConvertTo-Json -Depth 4
  Invoke-RestMethod -Uri "$base/webhook/qra-result" -Headers $headers -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 30 | Out-Null
} catch {}

# One-shot: remove the task so it never runs again, then drop the lock.
try { Unregister-ScheduledTask -TaskName 'PersonalOS-qra-poller' -Confirm:$false } catch {}
Remove-Item $lock -Force -ErrorAction SilentlyContinue
exit 0

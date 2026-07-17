# Sprint Tracker scheduled wrapper (rebuilt 2026-07-10: deterministic-core-first architecture).
#
# ORDER MATTERS. The zero-token Node core runs FIRST and is the must-succeed part: it reads the
# board, computes counts/velocity/stale/missed/contract, writes velocity.md + board-state.json +
# decisions-pending.md + last-run.json, and pushes sprint/velocity + run_status GREEN to Alex HQ.
# Because it needs no Claude tokens, a 9:00 quota/auth blackout can no longer make the tracker dark:
# the numbers land and HQ goes green regardless. If the CORE fails, that is a real failure -> the
# shared close-out check pushes RED, schedules the retry, and exits 1 (the old behaviour, now gated
# on the core rather than on a whole LLM session).
#
# The Claude prose pass runs SECOND and is OPTIONAL. It reads last-run.json and writes the standup
# narrative + "one thing" lever + the Notion standup page. If it dies on the cap/login, the run is
# DEGRADED (no prose), never dark: numbers already written, HQ already green, so it is logged PARTIAL
# and the wrapper still exits 0.
#
# Flags: -ClaudeCmd {stub} swaps the claude binary for stub-testing; -DryRun runs the core with
# --dry-run (no writes / no HQ push) and skips the prose pass.
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

# ---- 1. Deterministic core (must succeed; greens HQ) ----
$coreArgs = @("scripts\sprint-tracker-core.js")
if ($DryRun) { $coreArgs += "--dry-run" }
$coreOut = ''
try {
    $coreOut = (& node @coreArgs 2>&1 | Out-String)
    $coreCode = $LASTEXITCODE
} catch {
    $coreOut = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $coreCode = 1
}
"--- core ---`n$coreOut" | Out-File -Append -Encoding utf8 $log

if ($coreCode -ne 0) {
    # Core failure = real failure. This pushes sprint/run_status RED, schedules the +90m retry, exits 1.
    Invoke-CloseOutCheck -Out $coreOut -Code $coreCode -Log $log -Project 'sprint' -DryRun:$DryRun
}

if ($DryRun) { "DRYRUN: core ran with --dry-run; prose pass skipped." | Out-File -Append -Encoding utf8 $log; exit 0 }

# ---- P3 quota gate (upgrade 2026-07-12): plan freshly capped -> skip the prose spawn entirely ----
if (-not (Test-AlexQuotaGate -Log $log -Project 'sprint')) {
    "PARTIAL: prose pass skipped by the quota gate (plan capped). Numbers written + HQ green by the core." | Out-File -Append -Encoding utf8 $log
    exit 0
}

# ---- 2. Optional Claude prose pass (non-fatal; numbers + HQ green already done) ----
$proseOut = ''
try {
    # Model: Sonnet-4-6 (cost cut, Shaheen 2026-07-16). (Task disabled 2026-07-16 until Shaheen re-enables.)
    $proseOut = (& $ClaudeCmd --model claude-sonnet-4-6 -p "Run /sprint-tracker --prose-only" --dangerously-skip-permissions 2>&1 | Out-String)
    $proseCode = $LASTEXITCODE
} catch {
    $proseOut = "PROSE EXCEPTION: $($_.Exception.Message)"; $proseCode = 1
}
"--- prose ---`n$proseOut" | Out-File -Append -Encoding utf8 $log

$proseShort = ($proseOut -replace '\s', '').Length -lt 500
if (($proseOut -replace '\s', '').Length -eq 0) { $proseReason = 'blank output' }
elseif ($proseOut -match 'PROSE EXCEPTION') { $proseReason = 'prose exception' }
elseif ($proseShort -and $proseOut -match 'Not logged in|Please run /login') { $proseReason = 'not logged in' }
elseif ($proseShort -and $proseOut -match 'session limit|usage limit|API usage limits') { $proseReason = 'usage/session limit' }
elseif ($proseCode -ne 0) { $proseReason = "claude exit $proseCode" }
else { $proseReason = $null }

if ($proseReason) {
    if ($proseReason -eq 'usage/session limit') { Set-AlexQuotaCapped -Kind 'plan' -Log $log }
    "PARTIAL: standup prose skipped ($proseReason). Numbers written + HQ green by the core; run is degraded, not dark." | Out-File -Append -Encoding utf8 $log
} else {
    "OK: core + prose complete." | Out-File -Append -Encoding utf8 $log
}
exit 0

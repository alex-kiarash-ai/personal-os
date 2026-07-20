# Gated monthly /lint (Recovery Phase 3, live 2026-07-06). First Monday 10:00.
# The GATE: the zero-token deterministic checker runs FIRST and nominates; the LLM judges ONLY the
# shortlist (deterministic checks are ~10,000x cheaper than judgment, so the script gates the judge).
# Detects + proposes, never auto-repairs: same invariant as the checker itself.
param(
    [string]$ClaudeCmd = "$env:APPDATA\npm\claude.ps1",
    [switch]$DryRun
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\lint-monthly.log"
"=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log
# P3 quota gate (upgrade 2026-07-12): plan freshly capped + not a budget-priority winner -> skip this slot as visible-PARTIAL
if (-not (Test-AlexQuotaGate -Log $log -Project 'recovery')) { exit 0 }

# 1. The deterministic sweep (nomination pass). Exit 0 clean / 2 drift / 1 checker error.
& powershell -NoProfile -ExecutionPolicy Bypass -File "work\18-recovery-layer\check.ps1" 2>&1 | Out-File -Append -Encoding utf8 $log
$sweepExit = $LASTEXITCODE
"checker exit: $sweepExit" | Out-File -Append -Encoding utf8 $log
if ($sweepExit -eq 1) {
    # Checker itself broke: the checker's own fail-loud path already pushed RED integrity. Judge nothing on a broken nomination pass.
    "ABORT: checker error - /lint not run (no trustworthy shortlist)" | Out-File -Append -Encoding utf8 $log
    exit 1
}

# 2. The LLM judgment pass over the nominations only.
$prompt = "Run /lint in GATED mode (Recovery Phase 3). The deterministic checker just ran with exit code $sweepExit. Read vault/projects/recovery/last-sweep.md as the nomination shortlist. Judge ONLY: (a) every item the sweep flagged, and (b) semantic drift (stale prose, superseded claims, contradictions, duplicate topics) on the specific pages those items touch, plus pages untouched for 90+ days that the sweep names. Write the findings report to vault/projects/recovery/lint-$(Get-Date -Format 'yyyy-MM').md, append vault/log.md, and PROPOSE fixes. Apply nothing without approval; identity files (soul.md, CLAUDE.md, brand) are always proposals. Run the Close-Out Gate."

$out = ''
try {
    $prompt = "$prompt $AlexVerdictInstruction"
    $out = (& $ClaudeCmd -p $prompt --dangerously-skip-permissions 2>&1 | Out-String)
    $code = $LASTEXITCODE
} catch {
    $out = "WRAPPER EXCEPTION: $($_.Exception.Message)"; $code = 1
}
$out | Out-File -Append -Encoding utf8 $log

Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project 'recovery' -DryRun:$DryRun

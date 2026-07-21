# Alex HQ scheduled wrapper (Close-Out Gate hardened 2026-07-03; shared mechanism scripts/lib/close-out.ps1)
# This IS the dashboard producer; a failed run usually means HQ is unreachable, so an HQ push would fail
# anyway (Project ''). Failure is still detected, logged FAILED, and exits 1 for visibility.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\alex-hq.log"
"=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Out-File -Append -Encoding utf8 $log
# P3 quota gate (upgrade 2026-07-12): plan freshly capped + not a budget-priority winner -> skip this slot as visible-PARTIAL
if (-not (Test-AlexQuotaGate -Log $log -Project 'alex-hq')) { exit 0 }

# No connector preflight needed: /alex-hq uses local files, ssh and curl only.
# DETERMINISTIC NUMBER PATH (2026-07-21): the metrics + the 5 data JSONs + the ship are done
# by a script, NOT the model. The old wrapper asked headless Haiku to count its MCP tools /
# scheduled jobs and to scp the files; when tools went deferred (~07-17) it pushed mcp_tools=0
# and stopped shipping (box files froze at 07-20). None of that is model work. hq_harvest_push.py
# harvests, builds, ships-with-verify, pushes, and read-back-verifies; the model call after it
# does only the HQ inbox + the narration (arg 'status' = fetch + present, no recount).
$out = ''
$harvest = (& python "scripts\hq_harvest_push.py" 2>&1 | Out-String)
$harvestCode = $LASTEXITCODE
$out += "=== hq_harvest_push (deterministic) ===`n$harvest`n"
$harvest | Out-File -Append -Encoding utf8 $log

# SELF-HEAL LOOP (Shaheen 2026-07-21): every HQ update also CHECKS + FIXES, it doesn't just display.
# Auto-safe mismatches are re-derived + read-back-verified; live-mutation fixes (workflow redeploy)
# and human-only items (phone/OAuth) are queued to the waiting-on-you list with a diagnosis. Zero-token.
$heal = (& python "scripts\hq_self_heal.py" 2>&1 | Out-String)
$out += "=== hq_self_heal ===`n$heal`n"
$heal | Out-File -Append -Encoding utf8 $log
try {
    # Model: Haiku (cost cut, Shaheen 2026-07-16). Numbers are already pushed above; the model
    # only files HQ notes + presents. 'status' arg = skip push, fetch + present + inbox check.
    $model = (& "$env:APPDATA\npm\claude.ps1" --model claude-haiku-4-5-20251001 -p "Run /alex-hq status. $AlexVerdictInstruction" --dangerously-skip-permissions 2>&1 | Out-String)
    $code = $LASTEXITCODE
    $out += $model
} catch {
    $out += "WRAPPER EXCEPTION: $($_.Exception.Message)"; $code = 1
}
# The deterministic harvest is the source of truth for run health: a stale ship or a failed
# push there fails the run even if the narration succeeded.
if ($harvestCode -ne 0) { $code = $harvestCode }
$out | Out-File -Append -Encoding utf8 $log

Invoke-CloseOutCheck -Out $out -Code $code -Log $log -Project ''

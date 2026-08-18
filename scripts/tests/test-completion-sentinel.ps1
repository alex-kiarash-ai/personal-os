# Unit test for item 1 (completion sentinel) in scripts/lib/close-out.ps1.
# Verifies the positive-completion detection: a >500-char run with no verdict line in its tail
# FAILS the sentinel (ENFORCING since 2026-07-21, audit O-01), while a run carrying the verdict
# line does not, and a limit mention that is NOT in the tail does not false-flag. Deterministic,
# zero-token. Run from repo root.
# Corrected 2026-08-18 (found stale during the bash-migration Phase 2 port, migrate/linux-bash
# commit ec2437a): this test still asserted the STAGE 1 warn-only behavior (OBSERVE, still OK)
# that close-out.ps1 itself moved off of on 2026-07-21. It had been failing against its own
# library ever since. See scripts/tests/close-out.test.mjs for the equivalent Node coverage.
Set-Location "C:\Users\Thinkpad\Desktop\personal-os"
. "scripts\lib\close-out.ps1"

$pass = 0; $fail = 0
function Check($name, $cond) {
    if ($cond) { $script:pass++; Write-Output "PASS  $name" }
    else { $script:fail++; Write-Output "FAIL  $name" }
}
function RunCase($out) {
    $log = [IO.Path]::GetTempFileName()
    Invoke-CloseOutCheck -Out $out -Code 0 -Log $log -Project '' -DryRun | Out-Null
    $txt = Get-Content $log -Raw; Remove-Item $log -Force
    return $txt
}

$pad = ("The run did real work. " * 40)   # ~920 chars, no verdict, no limit signature

# (a) >500 chars, no verdict, exit 0 -> sentinel ENFORCING logs and FAILS the run (truncation / dark stop)
$a = RunCase $pad
Check "a: no-verdict long run logs sentinel ENFORCING" ($a -match 'sentinel ENFORCING:')
Check "a: no-verdict long run is marked FAILED" ($a -match 'FAILED: no Close-Out verdict line')
Check "a: no-verdict long run is NOT reported OK" ($a -notmatch 'OK \(exit 0\)')

# (b) >500 chars ending with the verdict line -> sentinel does not fire
$b = RunCase ($pad + "`nClose-Out [session]: A1..A6 ok. Verdict: COMPLETE")
Check "b: verdict-present run does not trip the sentinel" ($b -notmatch 'sentinel ENFORCING')
Check "b: verdict-present run is OK" ($b -match 'OK \(exit 0\)')

# (c) 'session limit' mentioned EARLY (not in tail 400) but ends with the verdict -> no sentinel, no false FAIL
$c = RunCase ("Earlier the previous session limit was discussed. " + $pad + "`nVerdict: INCOMPLETE(nothing)")
Check "c: INCOMPLETE verdict counts as finished (sentinel does not fire)" ($c -notmatch 'sentinel ENFORCING')
Check "c: early limit mention does not false-flag FAILED" ($c -notmatch 'FAILED')

# (d) SHORT run (<500 chars) with no verdict -> short-gated, sentinel does not fire
$d = RunCase "tiny run, no verdict here"
Check "d: short run does not trip the sentinel (short-gated)" ($d -notmatch 'sentinel ENFORCING')
Check "d: short clean run is OK" ($d -match 'OK \(exit 0\)')

Write-Output ""
Write-Output "RESULT: $pass passed, $fail failed"
if ($fail -gt 0) { exit 1 } else { exit 0 }
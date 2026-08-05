# Unit test for the completion sentinel in scripts/lib/close-out.ps1.
# UPDATED 2026-08-05 to the Stage-2 ENFORCING semantics (flipped 2026-07-21, audit O-01): a >500-char
# run with no verdict line in its tail is now FAILED (RED + retry ladder), not merely observed. The
# original warn-only expectations sat broken-and-silent for two weeks because nothing ran this file -
# the enforcing path ends in `exit 1`, which killed the test process before its first assertion could
# print. Cases run with -DryRun (no HQ push, no task registration) + -NoExit (survive the failure
# path in-process). Deterministic, zero-token, runs from any checkout (public-repo CI runs it too).
Set-Location (Join-Path $PSScriptRoot '..\..')
. "scripts\lib\close-out.ps1"

$pass = 0; $fail = 0
function Check($name, $cond) {
    if ($cond) { $script:pass++; Write-Output "PASS  $name" }
    else { $script:fail++; Write-Output "FAIL  $name" }
}
function RunCase($out) {
    $log = [IO.Path]::GetTempFileName()
    Invoke-CloseOutCheck -Out $out -Code 0 -Log $log -Project '' -DryRun -NoExit | Out-Null
    $txt = Get-Content $log -Raw; Remove-Item $log -Force
    return $txt
}

$pad = ("The run did real work. " * 40)   # ~920 chars, no verdict, no limit signature

# (a) >500 chars, no verdict, exit 0 -> sentinel ENFORCING: FAILED, never OK
$a = RunCase $pad
Check "a: no-verdict long run is FAILED (Stage 2 enforcing)" ($a -match 'FAILED: no Close-Out verdict line')
Check "a: enforcing line logged" ($a -match 'sentinel ENFORCING')
Check "a: no-verdict long run is NOT scored OK" ($a -notmatch 'OK \(exit 0\)')
Check "a: dry-run failure path pushes nothing (no run_status tile)" ($a -match 'HQ push skipped: no run_status tile')

# (b) >500 chars ending with the verdict line -> OK, sentinel silent
$b = RunCase ($pad + "`nClose-Out [session]: A1..A6 ok. Verdict: COMPLETE")
Check "b: verdict-present run is OK" ($b -match 'OK \(exit 0\)')
Check "b: verdict-present run is not flagged" ($b -notmatch 'sentinel ENFORCING|FAILED')

# (c) 'session limit' mentioned EARLY (not in tail 400) but ends with the verdict -> no false FAIL
$c = RunCase ("Earlier the previous session limit was discussed. " + $pad + "`nVerdict: INCOMPLETE(nothing)")
Check "c: INCOMPLETE verdict counts as finished (not flagged)" ($c -notmatch 'sentinel ENFORCING')
Check "c: early limit mention does not false-flag FAILED" ($c -notmatch 'FAILED')

# (d) SHORT run (<500 chars) with no verdict -> short-gated, still OK
$d = RunCase "tiny run, no verdict here"
Check "d: short run is not flagged (short-gated)" ($d -notmatch 'sentinel ENFORCING')
Check "d: short clean run is OK" ($d -match 'OK \(exit 0\)')

Write-Output ""
Write-Output "RESULT: $pass passed, $fail failed"
if ($fail -gt 0) { exit 1 } else { exit 0 }

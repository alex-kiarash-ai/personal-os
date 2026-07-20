# Unit test for item 1 (completion sentinel, Stage 1 warn-only) in scripts/lib/close-out.ps1.
# Verifies the positive-completion detection: a >500-char run with no verdict line in its tail is
# OBSERVED (warn-only), while a run carrying the verdict line is not, and a limit mention that is
# NOT in the tail does not false-flag. Deterministic, zero-token. Run from repo root.
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

# (a) >500 chars, no verdict, exit 0 -> OBSERVE logged, still OK (warn-only, not failed)
$a = RunCase $pad
Check "a: no-verdict long run is OBSERVED" ($a -match 'OBSERVE \(sentinel warn-only\)')
Check "a: no-verdict long run still returns OK (warn-only)" ($a -match 'OK \(exit 0\)')
Check "a: no-verdict long run is NOT marked FAILED" ($a -notmatch 'FAILED')

# (b) >500 chars ending with the verdict line -> no OBSERVE
$b = RunCase ($pad + "`nClose-Out [session]: A1..A6 ok. Verdict: COMPLETE")
Check "b: verdict-present run is not observed" ($b -notmatch 'OBSERVE')
Check "b: verdict-present run is OK" ($b -match 'OK \(exit 0\)')

# (c) 'session limit' mentioned EARLY (not in tail 400) but ends with the verdict -> no OBSERVE, no false FAIL
$c = RunCase ("Earlier the previous session limit was discussed. " + $pad + "`nVerdict: INCOMPLETE(nothing)")
Check "c: INCOMPLETE verdict counts as finished (not observed)" ($c -notmatch 'OBSERVE')
Check "c: early limit mention does not false-flag FAILED" ($c -notmatch 'FAILED')

# (d) SHORT run (<500 chars) with no verdict -> short-gated, NOT observed
$d = RunCase "tiny run, no verdict here"
Check "d: short run is not observed (short-gated)" ($d -notmatch 'OBSERVE')
Check "d: short clean run is OK" ($d -match 'OK \(exit 0\)')

Write-Output ""
Write-Output "RESULT: $pass passed, $fail failed"
if ($fail -gt 0) { exit 1 } else { exit 0 }
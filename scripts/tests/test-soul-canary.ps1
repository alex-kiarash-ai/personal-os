# scripts/tests/test-soul-canary.ps1
# Offline gate-logic test for the headless soul-injection gate (feedback P0.1/P0.2).
# Proves the verdict function fails CLOSED: only a fresh token+nonce from an injected soul.md passes;
# an unarmed soul, a replayed nonce, a wrong token, a SOUL-MISSING report, or no line at all all fail.
# No network, no claude call. Run: powershell -File scripts/tests/test-soul-canary.ps1  (exit 0 = pass)

. "$PSScriptRoot\..\lib\soul-canary.ps1"

$fails = @()
function Check($name, $ok, $detail) {
    $tag = if ($ok) { 'PASS' } else { 'FAIL' }
    Write-Host ("  [{0}] {1}{2}" -f $tag, $name, $(if ($detail) { " - $detail" } else { '' }))
    if (-not $ok) { $script:fails += $name }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ("soulcanary-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $tmp | Out-Null
try {
    $token = 'a1b2c3d4e5f6a7b8'
    $armed = Join-Path $tmp 'soul.md'
    "# Soul`n`nSOUL-CANARY-TOKEN: $token`n`nrest of the soul." | Out-File -Encoding utf8 $armed
    $unarmed = Join-Path $tmp 'soul-unarmed.md'
    "# Soul`n`nno token here." | Out-File -Encoding utf8 $unarmed

    $nonce = New-SoulNonce
    $stale = New-SoulNonce

    # 1. Happy path: soul injected, model emitted the right token for THIS nonce.
    $r = Test-SoulCanary -Out "the brief...`nSOUL-OK $token $nonce" -Nonce $nonce -SoulPath $armed
    Check 'armed + correct token + fresh nonce -> PASS' ($r.Pass -eq $true) $r.Reason

    # 2. Replay attack: right token, but a stale nonce from a previous/cached run.
    $r = Test-SoulCanary -Out "SOUL-OK $token $stale" -Nonce $nonce -SoulPath $armed
    Check 'replayed nonce -> FAIL' ($r.Pass -eq $false -and $r.Reason -match 'nonce') $r.Reason

    # 3. Wrong token for the right nonce: soul.md not injected (or altered).
    $r = Test-SoulCanary -Out "SOUL-OK deadbeefdeadbeef $nonce" -Nonce $nonce -SoulPath $armed
    Check 'wrong token -> FAIL' ($r.Pass -eq $false -and $r.Reason -match 'wrong token') $r.Reason

    # 4. Model explicitly reports the soul is absent from context.
    $r = Test-SoulCanary -Out "I could not find it.`nSOUL-MISSING $nonce" -Nonce $nonce -SoulPath $armed
    Check 'SOUL-MISSING -> FAIL' ($r.Pass -eq $false -and $r.Reason -match 'SOUL-MISSING') $r.Reason

    # 5. No canary line at all (the silent-failure case the gate exists to catch).
    $r = Test-SoulCanary -Out "just a normal brief with no canary line" -Nonce $nonce -SoulPath $armed
    Check 'no SOUL-OK line -> FAIL' ($r.Pass -eq $false) $r.Reason

    # 6. Gate not armed (no token in soul.md): must fail closed, never pass by default.
    $r = Test-SoulCanary -Out "SOUL-OK whatever $nonce" -Nonce $nonce -SoulPath $unarmed
    Check 'unarmed soul -> FAIL closed' ($r.Pass -eq $false -and $r.Reason -match 'not armed') $r.Reason

    # 7. Assert-SoulCanary in -SoftFail mode returns $false (does not exit) on a miss, and logs it.
    $log = Join-Path $tmp 'gate.log'
    $res = Assert-SoulCanary -Out "no line" -Nonce $nonce -SoulPath $armed -Log $log -SoftFail
    $logged = (Test-Path $log) -and ((Get-Content $log -Raw) -match 'SOUL-CANARY FAIL')
    Check 'Assert -SoftFail returns false + logs the miss' ($res -eq $false -and $logged) ''

    # 8. Nonce freshness: two calls to New-SoulNonce differ (per-run uniqueness).
    Check 'New-SoulNonce is per-run unique' ($nonce -ne $stale) "$nonce vs $stale"

    # --- Added 2026-08-05 (pen-test P-01 fix). Regression cases for the three measured flake modes.
    # Each one reproduces a REAL line from outputs/logs/morning-brief.log, so a future refactor that
    # reintroduces the fault fails here instead of in production two weeks later.

    # 9. Correct token, nonce omitted (real line: "SOUL-OK 0b03f461338e8658"). Must still FAIL closed,
    #    but must NOT be diagnosed as "canary absent" - the token is unguessable, so soul.md arrived.
    $r = Test-SoulCanary -Out "the brief...`nSOUL-OK $token" -Nonce $nonce -SoulPath $armed
    Check 'token correct + nonce omitted -> FAIL closed' ($r.Pass -eq $false) $r.Reason
    Check 'token correct + nonce omitted -> diagnosed as malformed, NOT absent' `
        ($r.Reason -match 'nonce omitted' -and $r.Reason -notmatch 'absent') $r.Reason

    # 10. Confabulated token (real lines: "SOUL-OK eyJ-kiarash <nonce>", "SOUL-OK brkb-canary-2026 <nonce>").
    #     A guessed token must never pass, however plausible it looks.
    foreach ($fake in @('eyJ-kiarash', 'brkb-canary-2026', '<token>')) {
        $r = Test-SoulCanary -Out "SOUL-OK $fake $nonce" -Nonce $nonce -SoulPath $armed
        Check "confabulated token '$fake' -> FAIL" ($r.Pass -eq $false -and $r.Reason -match 'wrong token') $r.Reason
    }

    # 11. The instruction must SEQUENCE the verdict line and the canary line rather than both claiming
    #     the last line. The collision with $AlexVerdictInstruction was root cause (a) of the flake.
    $instr = Get-SoulCanaryInstruction -Nonce $nonce
    Check 'instruction no longer claims "the very last line"' ($instr -notmatch 'very last line') ''
    Check 'instruction sequences verdict THEN canary' `
        ($instr -match 'Verdict:\s*COMPLETE' -and $instr -match 'in this exact order') ''
    Check 'instruction names the anchor line to copy from' ($instr -match "SOUL-CANARY-TOKEN:") ''
    Check 'instruction forbids guessing the token' ($instr -match 'NEVER guess') ''
    Check 'instruction still withholds the real token' ($instr -notmatch [regex]::Escape($token)) ''
    Check 'instruction carries this run nonce' ($instr -match [regex]::Escape($nonce)) ''

    # 12. Real-file invariant (new 2026-08-05): soul.md now carries the token TWICE (top anchor +
    #     the explanatory block). Get-SoulToken takes the FIRST match, so a rotation that updates one
    #     block and not the other would leave the file disagreeing with itself, silently.
    $realSoul = Join-Path $PSScriptRoot '..\..\soul.md'
    if (Test-Path $realSoul) {
        $hits = [regex]::Matches((Get-Content $realSoul -Raw), 'SOUL-CANARY-TOKEN:\s*([0-9a-f]{12,})') |
                ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique
        Check 'live soul.md: all SOUL-CANARY-TOKEN blocks agree' ($hits.Count -eq 1) ("distinct values: " + ($hits -join ', '))
    } else {
        Write-Host '  [skip] live soul.md not present (gitignored clone) - two-block invariant unchecked'
    }
}
finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

Write-Host ''
if ($fails.Count -gt 0) {
    Write-Host ("RESULT: FAIL ({0} failing: {1})" -f $fails.Count, ($fails -join ', '))
    exit 1
}
Write-Host 'RESULT: PASS (gate fails closed; only a fresh injected-soul token passes)'
exit 0

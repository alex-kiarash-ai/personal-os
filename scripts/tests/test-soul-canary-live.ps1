# scripts/tests/test-soul-canary-live.ps1
# LIVE integration test (feedback P0.2): invoke `claude -p` headless and assert the SessionStart
# `cat soul.md` hook actually injects soul.md into the model's context. This is the test that turns
# "the headless path is reasoned about" into "confirmed from a log".
#
# How it isolates the HOOK (not the model's own file access):
#   - The sandbox lives OUTSIDE the repo (its own soul.md with a fresh high-entropy token).
#   - claude runs with a --settings file whose SessionStart hook is `cat ./soul.md` (mirrors prod).
#   - ALL file-reading tools are disabled (--disallowed-tools Read Bash Glob Grep ...), so the model
#     cannot open soul.md itself. If it can still emit the token, the token came from HOOK INJECTION.
#   - If the hook does NOT fire on the headless path, the token is nowhere in context and the model
#     emits SOUL-MISSING (or no line) -> the test FAILS loudly, which is the finding we want.
#
# Costs one small claude call. Uses a cheap model. Run on demand:
#   powershell -File scripts/tests/test-soul-canary-live.ps1
# Exit 0 = headless soul injection VERIFIED. Exit 1 = NOT verified (investigate before trusting jobs).

param(
    [string]$Model = 'claude-haiku-4-5-20251001',
    [switch]$KeepSandbox
)

. "$PSScriptRoot\..\lib\soul-canary.ps1"

$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$claude = "$env:APPDATA\npm\claude.ps1"
if (-not (Test-Path $claude)) { $claude = 'claude' }

$sandbox = Join-Path ([IO.Path]::GetTempPath()) ("soul-live-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $sandbox | Out-Null
New-Item -ItemType Directory -Force (Join-Path $sandbox '.claude') | Out-Null

$exit = 1
try {
    # Fresh token in the SANDBOX soul.md only. It exists nowhere else, so echoing it proves injection.
    $token = -join ((1..16) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
    $nonce = New-SoulNonce
    @"
# Soul (sandbox)

SOUL-CANARY-TOKEN: $token

This file exists only to test headless injection.
"@ | Out-File -Encoding utf8 (Join-Path $sandbox 'soul.md')

    # A settings file whose SessionStart hook mirrors production: cat ./soul.md into context.
    $settings = @{
        hooks = @{
            SessionStart = @(@{ hooks = @(@{ type = 'command'; command = 'cat ./soul.md' }) })
        }
    } | ConvertTo-Json -Depth 6
    $settingsPath = Join-Path $sandbox 'hook-settings.json'
    $settings | Out-File -Encoding utf8 $settingsPath

    $prompt = "Do not use any tools. Answer only from what is already in your context. " +
              "Your entire response must be exactly one line: SOUL-OK <token> $nonce " +
              "where <token> is the SOUL-CANARY-TOKEN value from soul.md. " +
              "If that token is not in your context, respond exactly: SOUL-MISSING $nonce"

    Write-Host "sandbox: $sandbox"
    Write-Host "running headless claude ($Model), file tools disabled..."
    Push-Location $sandbox
    try {
        # No --dangerously-skip-permissions: every file/exec tool is disabled below, so the model
        # has nothing to request permission for. It can only answer from injected context.
        $out = (& $claude --settings $settingsPath --model $Model `
                    --disallowed-tools Read Bash Glob Grep Edit Write WebFetch WebSearch `
                    -p $prompt 2>&1 | Out-String)
    } finally { Pop-Location }

    Write-Host "--- raw model output ---"
    Write-Host $out.Trim()
    Write-Host "------------------------"

    $r = Test-SoulCanary -Out $out -Nonce $nonce -SoulPath (Join-Path $sandbox 'soul.md')
    if ($r.Pass) {
        Write-Host "RESULT: PASS - headless SessionStart hook injected soul.md (token echoed, nonce fresh)."
        $exit = 0
    } else {
        Write-Host "RESULT: FAIL - $($r.Reason)"
        Write-Host "         Headless soul injection is NOT confirmed. Do not trust voice on scheduled jobs."
    }
}
finally {
    if (-not $KeepSandbox) { Remove-Item -Recurse -Force $sandbox -ErrorAction SilentlyContinue }
    else { Write-Host "sandbox kept: $sandbox" }
}
exit $exit

# scripts/lib/soul-canary.ps1
# Headless soul.md injection GATE (feedback P0.1 + P0.2).
#
# The problem: scheduled `claude -p` jobs are assumed to receive soul.md via the SessionStart hook,
# but nothing proved it from a run. A brief (or worse, prose in Shaheen's name) generated with
# CLAUDE.md orders present but soul.md absent looks fine and is silently off-voice.
#
# The gate, and why it can't be faked or replayed:
#   - A high-entropy token lives ONLY in soul.md prose (SOUL-CANARY-TOKEN: <hex>). It is never put
#     in the prompt. The wrapper asks the model to emit "the token from soul.md" plus a per-run
#     NONCE. The model can only produce the token if soul.md actually reached its context, and can
#     only produce THIS nonce if the line came from THIS run (a cached/replayed transcript carries
#     an old nonce). Token present + nonce fresh = soul was injected, this run. Anything else fails.
#   - On failure the gate LOGS, pushes run_status RED to Alex HQ, and exits 1. It blocks; it does
#     not just write a status line someone has to read.
#
# ARMING: the gate only fires when a SOUL-CANARY-TOKEN exists in soul.md AND a wrapper passes a
# nonce through Assert-SoulCanary. With no token / no nonce it is inert, so dot-sourcing this file
# can never disturb the existing scheduled jobs. See scripts/tests/test-soul-canary.ps1 (offline
# gate logic) and scripts/tests/test-soul-canary-live.ps1 (real `claude -p` end to end).

function New-SoulNonce {
    # 64-bit random hex, regenerated per run so a replayed/cached transcript cannot satisfy the gate.
    -join ((1..16) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
}

function Get-SoulToken {
    param([string]$SoulPath = 'soul.md')
    if (-not (Test-Path $SoulPath)) { return $null }
    $m = [regex]::Match((Get-Content $SoulPath -Raw), 'SOUL-CANARY-TOKEN:\s*([0-9a-f]{12,})')
    if ($m.Success) { return $m.Groups[1].Value }
    return $null
}

function Get-SoulCanaryInstruction {
    # Appended to the headless prompt. The token is deliberately NOT included here; the model must
    # supply it from soul.md, which is the whole proof.
    #
    # REWRITTEN 2026-08-05 after the pen-test suite measured a ~40% flake rate since 2026-07-20
    # (morning-brief 18 pass / 12 fail, email-triage 11 pass / 14 fail). Three design faults, all
    # in the ASK rather than in the injection, and the log proves it:
    #   (a) COLLIDING FINAL-LINE ORDERS. This block said "the very last line must be SOUL-OK"; the
    #       wrappers then append $AlexVerdictInstruction ("end your final message with ... Verdict:").
    #       Two instructions cannot both own the last line, so the model resolved it differently on
    #       different runs. Fixed by SEQUENCING both explicitly instead of each claiming primacy.
    #   (b) CONFABULATION. The model invented plausible tokens rather than looking one up
    #       ("SOUL-OK eyJ-kiarash <nonce>", "SOUL-OK brkb-canary-2026 <nonce>" - real log lines).
    #       An opaque 16-hex value buried in a 143KB file is a retrieval task, and an un-anchored
    #       retrieval task is where a model guesses. Fixed by naming the exact anchor line to copy
    #       from and forbidding a guess outright.
    #   (c) DROPPED NONCE. "SOUL-OK 0b03f461338e8658" with the nonce omitted (real log line). Fixed
    #       by showing the shape as two required fields with the nonce pre-filled and marked verbatim.
    # The gate still cannot be faked: the token is still never in the prompt, and the nonce is still
    # per-run. This only makes the honest answer easy to give and the guess explicitly disallowed.
    param([Parameter(Mandatory)][string]$Nonce)
    return @"


Close-out requirement (do not skip, and do not summarise it away):
End your response with these two lines, in this exact order, nothing after them:

  1. the Close-Out Report line, ending in 'Verdict: COMPLETE' or 'Verdict: INCOMPLETE(<missed>)'
  2. SOUL-OK <token> $Nonce

For line 2: <token> is copied VERBATIM from the line beginning 'SOUL-CANARY-TOKEN:' in soul.md
(near the top of the file, and again in its own block lower down). Copy the value character for
character. NEVER guess, abbreviate, or invent it, and never substitute a placeholder. Reproduce
the nonce '$Nonce' exactly as given; both fields are required.
If soul.md is genuinely not in your context and you cannot find that line, print instead:
SOUL-MISSING $Nonce
"@
}

function Test-SoulCanary {
    # Pure verdict function (no side effects) so it is unit-testable. Returns a hashtable:
    #   Pass (bool), Reason (string), Token (string or $null).
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Out,
        [Parameter(Mandatory)][string]$Nonce,
        [string]$SoulPath = 'soul.md'
    )
    $token = Get-SoulToken -SoulPath $SoulPath
    if (-not $token) {
        return @{ Pass = $false; Reason = "no SOUL-CANARY-TOKEN in $SoulPath (gate not armed)"; Token = $null }
    }
    $n = [regex]::Escape($Nonce)
    $t = [regex]::Escape($token)
    if ($Out -match "SOUL-OK\s+$t\s+$n(\s|$)") {
        return @{ Pass = $true; Reason = 'soul injected + fresh (token+nonce matched)'; Token = $token }
    }
    if ($Out -match "SOUL-MISSING\s+$n(\s|$)") {
        return @{ Pass = $false; Reason = 'model reported SOUL-MISSING (soul.md absent from context)'; Token = $token }
    }
    if ($Out -match "SOUL-OK\s+\S+\s+$n(\s|$)") {
        return @{ Pass = $false; Reason = 'wrong token for this nonce (soul.md not injected or altered)'; Token = $token }
    }
    # Correct token, nonce omitted entirely (real 2026-08-05 log line: "SOUL-OK 0b03f461338e8658").
    # Still a FAIL - without the nonce there is no freshness proof, so the gate stays closed. But the
    # DIAGNOSIS matters: the token is unguessable, so its presence proves soul.md DID reach the model
    # and only the line shape was wrong. Before this case existed the run fell through to the catch-all
    # and reported "soul canary absent", which is the opposite of what happened; that false reading is
    # what made a formatting flake look like an identity outage for two weeks. (Added 2026-08-05.)
    if ($Out -match "SOUL-OK\s+$t\s*(\r?\n|$)") {
        return @{ Pass = $false; Reason = 'token correct but nonce omitted (soul DID reach the model; canary line malformed, no freshness proof)'; Token = $token }
    }
    if ($Out -match "SOUL-OK\s+$t\s+\S+") {
        return @{ Pass = $false; Reason = 'token matched but nonce stale (possible replay/cache)'; Token = $token }
    }
    return @{ Pass = $false; Reason = 'no SOUL-OK line for this run (soul canary absent)'; Token = $token }
}

function Assert-SoulCanary {
    # The GATE. On failure: log, push run_status RED to Alex HQ, and (default) exit 1 so the run is
    # treated as the degraded run it is. Pass -SoftFail to only flag (returns $false) for a run that
    # is not shipping content in Shaheen's name.
    param(
        [Parameter(Mandatory)][AllowEmptyString()][string]$Out,
        [Parameter(Mandatory)][string]$Nonce,
        [Parameter(Mandatory)][string]$Log,
        [string]$SoulPath = 'soul.md',
        [string]$Project = '',
        [switch]$SoftFail,
        [switch]$DryRun
    )
    $r = Test-SoulCanary -Out $Out -Nonce $Nonce -SoulPath $SoulPath
    if ($r.Pass) {
        "SOUL-CANARY OK: $($r.Reason)" | Out-File -Append -Encoding utf8 $Log
        return $true
    }
    "SOUL-CANARY FAIL: $($r.Reason)" | Out-File -Append -Encoding utf8 $Log

    if ($Project -ne '') {
        $tokenFile = 'work\16-alex-hq\config\alex-hq-token.txt'
        if ((Test-Path $tokenFile) -and -not $DryRun) {
            $hqToken = (Get-Content $tokenFile -Raw).Trim()
            $body = @{ project = $Project; metric_key = 'run_status'; value_num = 0
                       headline = "soul canary failed: $($r.Reason)"; status = 'red' } | ConvertTo-Json -Compress
            try {
                Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
                    -Headers @{ 'X-Alex-Token' = $hqToken } -ContentType 'application/json' `
                    -Body $body -TimeoutSec 10 | Out-Null
                "HQ red push sent (soul canary, project=$Project)" | Out-File -Append -Encoding utf8 $Log
            } catch {
                "HQ push failed: $($_.Exception.Message)" | Out-File -Append -Encoding utf8 $Log
            }
        }
    }

    if ($DryRun -or $SoftFail) { return $false }
    exit 1
}

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
    param([Parameter(Mandatory)][string]$Nonce)
    return @"


Close-out requirement (do not skip): the very last line of your response must be exactly:
SOUL-OK <token> $Nonce
where <token> is the SOUL-CANARY-TOKEN value from soul.md. If that token is not present in your
context, print instead: SOUL-MISSING $Nonce
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

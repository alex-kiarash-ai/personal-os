# Nightly vault-search index rebuild (upgrade-scan item 1, built 2026-07-07).
# ZERO LLM tokens - pure Python/SQLite, same class as work/18-recovery-layer/check.ps1.
# Rebuilds the FTS5 keyword index over vault/**/*.md so cross-session recall scales past
# read-the-index-and-drill (2026-07-06 audit weakness 2). The .db lives in a gitignored
# in-repo dir, so the 21:45 encrypted vault backup picks it up automatically; it is also
# fully regenerable from the markdown, so a missed night is harmless.
# Scheduled: PersonalOS-vault-index nightly 21:35 (before the 21:45 vault backup).
# On failure: log + RED infra/vault_index to Alex HQ (never silent). No retry ladder
# (not a claude run; the next night rebuilds, and on-demand `build` is always available).
param([switch]$DryRun)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = "C:\Users\Thinkpad\Desktop\personal-os"
Set-Location $repo
New-Item -ItemType Directory -Force "outputs\logs" | Out-Null
$log = "outputs\logs\vault-index.log"
function Say($m) { "$m" | Out-File -Append -Encoding utf8 $log }
Say "=== run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')$(if($DryRun){' (DRYRUN)'}) ==="

# Resolve python (PATH first, then the known per-user install) so a scheduled run can't miss it.
$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) {
    $cand = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe"
    if (Test-Path $cand) { $py = $cand }
}

# --- S1 Compiled Surfaces P2 (2026-08-16): rotate over-budget status.md files BEFORE the index
# build, so tonight's index already reflects the moves (a block searched right after rotation must
# resolve to its history/ home, not a stale chunk). Best-effort + write-locked (defer = exit 2);
# an unchanged estate is a fast no-op; C24 (Monday) ambers on any file still over budget.
try {
    $rot = (& node "scripts\status-rotate.js" 2>&1 | Out-String)
    ($rot -split "`r?`n" | Where-Object { $_ -match 'status-rotate:' } | Select-Object -Last 1) |
        ForEach-Object { Say $_.Trim() }
    if ($LASTEXITCODE -eq 1) { Say "status-rotate FAILED (exit 1) - see output above" }
} catch { Say "status-rotate FAILED: $($_.Exception.Message)" }

$reason = $null
$chunks = 0
try {
    if (-not $py) { throw "python not found on PATH or in the per-user install" }
    if ($DryRun) {
        Say "DRYRUN: would run $py scripts/vault_search.py build"
    } else {
        $out = (& $py "scripts\vault_search.py" build 2>&1 | Out-String)
        $out.TrimEnd() | Out-File -Append -Encoding utf8 $log
        if ($LASTEXITCODE -ne 0) { throw "indexer exit $LASTEXITCODE" }
        if ($out -match 'indexed\s+\d+\s+files\s+->\s+(\d+)\s+chunks') { $chunks = [int]$Matches[1] }
        if ($chunks -lt 50) { throw "index suspiciously small ($chunks chunks) - refusing to report green" }
        Say "built: $chunks chunks"
    }
} catch {
    $reason = $_.Exception.Message
    Say "FAILED: $reason"
}

# --- Recall Spine bi-temporal fact ledger (2026-07-25): populate facts.db beside the vault index.
# Zero-token node/SQLite, same class as the index build. Independent of the index result: a harvest
# tripwire/failure pushes its OWN red metric but does not mark the index job red (and vice versa).
$recallReason = $null; $recallSummary = ''
try {
    $rout = (& node "system\recall\harvest.js" --quiet 2>&1 | Out-String)
    $rout.TrimEnd() | Out-File -Append -Encoding utf8 $log
    if ($LASTEXITCODE -ne 0) { throw "harvest exit $LASTEXITCODE (mass-drift tripwire or fatal - see log)" }
    $recallSummary = ($rout -split "`r?`n" | Where-Object { $_ -match 'inserted=' } | Select-Object -Last 1)
    Say "recall harvest: $recallSummary"
} catch {
    $recallReason = $_.Exception.Message
    Say "recall harvest FAILED: $recallReason"
}

# --- Recall Spine Phase 3: harvest Close-Out L-lines into the lessons table (idempotent, cursor-based).
# Best-effort: a lesson-harvest failure never fails the job (lessons are a compounding nicety, not a
# correctness gate); it logs and moves on.
try {
    $lout = (& node "scripts\lesson-harvest.js" 2>&1 | Out-String)
    ($lout -split "`r?`n" | Where-Object { $_ -match 'processed=' } | Select-Object -Last 1) |
        ForEach-Object { Say "lesson harvest: $_" }
    if ($LASTEXITCODE -ne 0) { Say "lesson harvest exit $LASTEXITCODE" }
} catch { Say "lesson harvest FAILED: $($_.Exception.Message)" }

# --- S1 Compiled Surfaces (2026-08-16): nightly soul-core.md rebuild beside the index, so a
# harvest-day corpus change reaches the injection card the same night (run-44 condition 1: without
# this the freshness story erases the win on harvest days). Best-effort: a builder failure or a
# busy write-lock (exit 2 = deferred) never fails the index job; an unchanged soul.md is a verified
# no-op; C23 (Monday sweep) + the hq-heal-map row guard real staleness.
try {
    $score = (& node "scripts\lib\build-soul-core.js" 2>&1 | Out-String)
    ($score -split "`r?`n" | Where-Object { $_ -match 'soul-core|deferred|FAILED' } | Select-Object -Last 1) |
        ForEach-Object { Say "soul-core: $($_.Trim())" }
    if ($LASTEXITCODE -eq 1) { Say "soul-core rebuild FAILED (exit 1) - existing card untouched" }
} catch { Say "soul-core rebuild FAILED: $($_.Exception.Message)" }

# --- S1 Compiled Surfaces P2 (2026-08-16): monthly n8n-backup pack (self-gates to one run per
# calendar month via system/n8n-backup-rotate-state.json, so the daily call is a no-op the rest
# of the time). Keeps newest 5 per workflow + everything <30d loose; older into verified tar.gz
# packs with MANIFEST + archive-ledger rows. Best-effort; a pack failure never fails the job.
try {
    $nbr = (& node "scripts\n8n-backup-rotate.js" 2>&1 | Out-String)
    ($nbr -split "`r?`n" | Where-Object { $_ -match 'n8n-backup-rotate' } | Select-Object -Last 1) |
        ForEach-Object { Say $_.Trim() }
} catch { Say "n8n-backup-rotate failed (non-fatal): $($_.Exception.Message)" }

# --- Alex HQ push (best-effort; never log the token, never let a push crash the job). ---
$tokenFile = "work\16-alex-hq\config\alex-hq-token.txt"
if ((Test-Path $tokenFile) -and -not $DryRun) {
    $token = (Get-Content $tokenFile -Raw).Trim()
    if ($null -eq $reason) {
        $body = @{ project='infra'; metric_key='vault_index'; value_num=$chunks
                   headline="vault index rebuilt ($chunks chunks)"; status='green' } | ConvertTo-Json -Compress
    } else {
        $body = @{ project='infra'; metric_key='vault_index'; value_num=0
                   headline="vault index FAILED: $reason"; status='red' } | ConvertTo-Json -Compress
    }
    try {
        Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
            -Headers @{ 'X-Alex-Token'=$token } -ContentType 'application/json' -Body $body -TimeoutSec 10 | Out-Null
        Say "HQ push sent"
    } catch { Say "HQ push failed: $($_.Exception.Message)" }

    # Recall ledger push (infra/recall_facts): green with the summary, red on a tripwire/failure.
    if ($null -eq $recallReason) {
        $rbody = @{ project='infra'; metric_key='recall_facts'; value_num=0
                    headline=("recall ledger ok" + $(if($recallSummary){": $recallSummary"}else{""})); status='green' } | ConvertTo-Json -Compress
    } else {
        $rbody = @{ project='infra'; metric_key='recall_facts'; value_num=0
                    headline="recall harvest FAILED: $recallReason"; status='red' } | ConvertTo-Json -Compress
    }
    try {
        Invoke-RestMethod -Method Post -Uri 'https://n8n.shaheenkiarash.com/webhook/alex-push' `
            -Headers @{ 'X-Alex-Token'=$token } -ContentType 'application/json' -Body $rbody -TimeoutSec 10 | Out-Null
        Say "recall HQ push sent"
    } catch { Say "recall HQ push failed: $($_.Exception.Message)" }
}

if ($null -eq $reason) { Say "OK ($chunks chunks)"; exit 0 }
exit 1

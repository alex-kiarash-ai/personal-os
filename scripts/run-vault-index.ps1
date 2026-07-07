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
}

if ($null -eq $reason) { Say "OK ($chunks chunks)"; exit 0 }
exit 1
